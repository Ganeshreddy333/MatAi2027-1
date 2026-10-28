"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const mysql = require("mysql2/promise");

const DATA_DIR = path.join(__dirname, "data");
const CONTENT_FILE = path.join(DATA_DIR, "content.json");
const KINDS = ["register", "abstract", "contact", "brochure"];
const LOCKS = new Map();
const mysqlSettings = {
  host: process.env.MYSQL_HOST || "",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || ""
};
const configuredValues = [mysqlSettings.host, mysqlSettings.user, mysqlSettings.database];
const hasMySqlSettings = Boolean(
  process.env.MYSQL_HOST || process.env.MYSQL_USER || process.env.MYSQL_PASSWORD || process.env.MYSQL_DATABASE
);
if (hasMySqlSettings && configuredValues.some((value) => !value)) {
  throw new Error("MYSQL_HOST, MYSQL_USER, and MYSQL_DATABASE must all be set to enable MySQL storage.");
}
if (!Number.isInteger(mysqlSettings.port) || mysqlSettings.port < 1 || mysqlSettings.port > 65535) {
  throw new Error("MYSQL_PORT must be a valid TCP port.");
}

let pool = null;

function parseJsonColumn(value, field) {
  if (typeof value === "string") return JSON.parse(value);
  if (value == null) throw new Error("Database row is missing " + field + ".");
  return value;
}

function recordFromRow(row) {
  const record = parseJsonColumn(row.record_json, "record_json");
  for (const [column, field] of [
    ["amount_currency", "amountCurrency"],
    ["preferred_currency", "preferredCurrency"],
    ["transaction_currency", "transactionCurrency"]
  ]) {
    if (row[column] != null) record[field] = String(row[column]).trim();
  }
  return record;
}

function recordValues(record, kind) {
  if (!record || typeof record !== "object" || Array.isArray(record) ||
      typeof record.reference !== "string" || !record.reference || record.reference.length > 80) {
    throw new Error("Submission record is missing a valid reference.");
  }
  const receivedAt = String(record.receivedAt || new Date().toISOString()).slice(0, 40);
  const status = typeof record.status === "string" ? record.status : null;
  const paymentStatus = typeof record.paymentStatus === "string" ? record.paymentStatus : null;
  const amount = record.amount == null ? null : Number(record.amount);
  if (amount != null && !Number.isFinite(amount)) throw new Error("Submission has an invalid payment amount.");
  const data = record.data && typeof record.data === "object" && !Array.isArray(record.data)
    ? record.data
    : {};
  const currency = (value) => {
    if (value == null || value === "") return null;
    const normalized = String(value).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) throw new Error("Submission has an invalid currency code.");
    return normalized;
  };
  const amountCurrency = currency(record.amountCurrency || record.transactionCurrency || record.razorpayCurrency);
  const preferredCurrency = currency(record.preferredCurrency || data.originalSelectedCurrency || data.currency);
  const transactionCurrency = currency(record.transactionCurrency || record.amountCurrency || record.razorpayCurrency);
  return [
    kind, record.reference, receivedAt, status, paymentStatus, amount,
    amountCurrency, preferredCurrency, transactionCurrency, JSON.stringify(record)
  ];
}

async function insertRecord(connection, record, kind) {
  await connection.execute(
    "INSERT IGNORE INTO matai_submissions " +
      "(kind, reference, received_at, status, payment_status, amount, amount_currency, " +
      "preferred_currency, transaction_currency, record_json) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    recordValues(record, kind)
  );
}

async function persistRecords(connection, kind, existingRows, records) {
  const retained = new Set(records.map((record) => record && record.reference));
  for (const row of existingRows) {
    if (!retained.has(row.reference)) {
      await connection.execute(
        "DELETE FROM matai_submissions WHERE kind = ? AND reference = ?",
        [kind, row.reference]
      );
    }
  }
  for (const record of records) {
    await connection.execute(
      "INSERT INTO matai_submissions " +
        "(kind, reference, received_at, status, payment_status, amount, amount_currency, " +
        "preferred_currency, transaction_currency, record_json) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON DUPLICATE KEY UPDATE received_at = VALUES(received_at), status = VALUES(status), " +
        "payment_status = VALUES(payment_status), amount = VALUES(amount), " +
        "amount_currency = VALUES(amount_currency), preferred_currency = VALUES(preferred_currency), " +
        "transaction_currency = VALUES(transaction_currency), record_json = VALUES(record_json)",
      recordValues(record, kind)
    );
  }
}

async function readLegacyArray(kind) {
  const filename = path.join(DATA_DIR, kind + ".json");
  let raw;
  try {
    raw = await fsp.readFile(filename, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const records = JSON.parse(raw);
  if (!Array.isArray(records)) throw new Error("Legacy submission store is not an array: " + filename);
  return records;
}

async function initializeMySql(defaultContent) {
  pool = mysql.createPool({
    ...mysqlSettings,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4"
  });
  await pool.query("SELECT 1");
  await pool.query(
    "CREATE TABLE IF NOT EXISTS matai_submissions (" +
      "kind VARCHAR(24) NOT NULL," +
      "reference VARCHAR(80) NOT NULL," +
      "received_at VARCHAR(40) NOT NULL," +
      "status VARCHAR(24) NULL," +
      "payment_status VARCHAR(24) NULL," +
      "amount DECIMAL(12,2) NULL," +
      "record_json JSON NOT NULL," +
      "PRIMARY KEY (kind, reference)," +
      "KEY idx_matai_submissions_recent (kind, received_at)," +
      "KEY idx_matai_submissions_payment (kind, payment_status)" +
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
  );
  await pool.query(
    "CREATE TABLE IF NOT EXISTS matai_submission_locks (" +
      "kind VARCHAR(24) NOT NULL PRIMARY KEY" +
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
  );
  await pool.query(
    "CREATE TABLE IF NOT EXISTS matai_site_content (" +
      "content_key VARCHAR(64) NOT NULL PRIMARY KEY," +
      "content_json JSON NOT NULL," +
      "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" +
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
  );
  await pool.query(
    "CREATE TABLE IF NOT EXISTS matai_migrations (" +
      "migration_key VARCHAR(100) NOT NULL PRIMARY KEY," +
      "applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP" +
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
  );
  await applyMigrations();
  for (const kind of KINDS) {
    await pool.execute("INSERT IGNORE INTO matai_submission_locks (kind) VALUES (?)", [kind]);
  }

  async function applyMigrations() {
    const connection = await pool.getConnection();
    try {
      const [lockRows] = await connection.query("SELECT GET_LOCK('matai_schema_migration', 30) AS acquired");
      if (Number(lockRows[0] && lockRows[0].acquired) !== 1) {
        throw new Error("Could not acquire the database migration lock.");
      }
      try {
        for (const migrationKey of ["001_initial", "002_currency_audit"]) {
          const [applied] = await connection.execute(
            "SELECT migration_key FROM matai_migrations WHERE migration_key = ?",
            [migrationKey]
          );
          if (applied.length) continue;

          const migrationPath = path.join(__dirname, "migrations", migrationKey + ".sql");
          const sql = await fsp.readFile(migrationPath, "utf8");
          const statements = sql.split(";").map((statement) => statement.trim()).filter(Boolean);
          if (migrationKey === "002_currency_audit") {
            const [columns] = await connection.query(
              "SELECT COLUMN_NAME FROM information_schema.COLUMNS " +
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matai_submissions'"
            );
            const existingColumns = new Set(columns.map((column) => column.COLUMN_NAME));
            const currencyColumns = ["amount_currency", "preferred_currency", "transaction_currency"];
            const presentCount = currencyColumns.filter((column) => existingColumns.has(column)).length;
            if (presentCount !== 0 && presentCount !== currencyColumns.length) {
              throw new Error("Currency audit migration is partially applied; inspect matai_submissions before retrying.");
            }
            for (const statement of statements) {
              if (presentCount === currencyColumns.length && /^\s*ALTER\s+TABLE\b/i.test(statement)) continue;
              await connection.query(statement);
            }
          } else {
            for (const statement of statements) await connection.query(statement);
          }
          await connection.execute(
            "INSERT INTO matai_migrations (migration_key) VALUES (?)",
            [migrationKey]
          );
        }
      } finally {
        await connection.query("SELECT RELEASE_LOCK('matai_schema_migration')");
      }
    } finally {
      connection.release();
    }
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [migrationResult] = await connection.execute(
      "INSERT IGNORE INTO matai_migrations (migration_key) VALUES (?)",
      ["legacy-json-v1"]
    );
    if (migrationResult.affectedRows === 1) {
      for (const kind of KINDS) {
        for (const record of await readLegacyArray(kind)) {
          await insertRecord(connection, record, kind);
        }
      }
      let content = defaultContent;
      try {
        content = JSON.parse(await fsp.readFile(CONTENT_FILE, "utf8"));
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
      await connection.execute(
        "INSERT IGNORE INTO matai_site_content (content_key, content_json) VALUES (?, ?)",
        ["site", JSON.stringify(content)]
      );
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

async function writeFileAtomically(filename, value) {
  const temporary = filename + "." + require("crypto").randomBytes(8).toString("hex") + ".tmp";
  try {
    await fsp.writeFile(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx" });
    await fsp.rename(temporary, filename);
  } catch (err) {
    try {
      await fsp.unlink(temporary);
    } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT") console.error("Could not remove incomplete data file:", cleanupError);
    }
    throw err;
  }
}

async function initialize(defaultContent) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (hasMySqlSettings) {
    await initializeMySql(defaultContent);
    return "mysql";
  }
  try {
    await fsp.access(CONTENT_FILE, fs.constants.R_OK);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    await writeFileAtomically(CONTENT_FILE, defaultContent);
  }
  return "json";
}

async function loadContent() {
  if (pool) {
    const [rows] = await pool.execute(
      "SELECT content_json FROM matai_site_content WHERE content_key = ?",
      ["site"]
    );
    if (!rows.length) throw new Error("Website content is not initialized in MySQL.");
    return parseJsonColumn(rows[0].content_json, "content_json");
  }
  try {
    return JSON.parse(await fsp.readFile(CONTENT_FILE, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") throw new Error("Website content file is missing.");
    throw err;
  }
}

async function saveContent(content) {
  if (pool) {
    await pool.execute(
      "INSERT INTO matai_site_content (content_key, content_json) VALUES (?, ?) " +
        "ON DUPLICATE KEY UPDATE content_json = VALUES(content_json)",
      ["site", JSON.stringify(content)]
    );
    return;
  }
  await writeFileAtomically(CONTENT_FILE, content);
}

async function readArr(kind) {
  if (pool) {
    const [rows] = await pool.execute(
      "SELECT record_json, amount_currency, preferred_currency, transaction_currency " +
        "FROM matai_submissions WHERE kind = ? ORDER BY received_at, reference",
      [kind]
    );
    return rows.map(recordFromRow);
  }
  try {
    const records = JSON.parse(await fsp.readFile(path.join(DATA_DIR, kind + ".json"), "utf8"));
    if (!Array.isArray(records)) throw new Error("Submission store is not an array: " + kind);
    return records;
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeArr(kind, records) {
  if (!Array.isArray(records)) throw new Error("Submission store must be an array: " + kind);
  if (pool) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute("INSERT IGNORE INTO matai_submission_locks (kind) VALUES (?)", [kind]);
      await connection.execute("SELECT kind FROM matai_submission_locks WHERE kind = ? FOR UPDATE", [kind]);
      const [existingRows] = await connection.execute(
        "SELECT reference FROM matai_submissions WHERE kind = ? FOR UPDATE",
        [kind]
      );
      await persistRecords(connection, kind, existingRows, records);
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
    return;
  }
  await writeFileAtomically(path.join(DATA_DIR, kind + ".json"), records);
}

async function updateArr(kind, update) {
  const previous = LOCKS.get(kind) || Promise.resolve();
  let release;
  const lock = new Promise((resolve) => { release = resolve; });
  LOCKS.set(kind, lock);
  await previous;
  try {
    if (pool) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute("INSERT IGNORE INTO matai_submission_locks (kind) VALUES (?)", [kind]);
        await connection.execute("SELECT kind FROM matai_submission_locks WHERE kind = ? FOR UPDATE", [kind]);
        const [rows] = await connection.execute(
          "SELECT reference, record_json, amount_currency, preferred_currency, transaction_currency " +
            "FROM matai_submissions WHERE kind = ? FOR UPDATE",
          [kind]
        );
        const records = rows.map(recordFromRow);
        const result = await update(records);
        await persistRecords(connection, kind, rows, records);
        await connection.commit();
        return result;
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    }
    const records = await readArr(kind);
    const result = await update(records);
    await writeArr(kind, records);
    return result;
  } finally {
    release();
    if (LOCKS.get(kind) === lock) LOCKS.delete(kind);
  }
}

async function close() {
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}

module.exports = {
  close,
  initialize,
  loadContent,
  readArr,
  saveContent,
  updateArr,
  writeArr
};
