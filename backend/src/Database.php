<?php

declare(strict_types=1);

namespace MatAi;

use PDO;
use RuntimeException;

final class Database
{
    private ?PDO $pdo = null;

    public function __construct(private readonly Config $config)
    {
    }

    public function connect(): ?PDO
    {
        if (!$this->config->mysqlConfigured()) {
            return null;
        }
        if ($this->pdo !== null) {
            return $this->pdo;
        }

        foreach (['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER'] as $key) {
            if ($this->config->get($key) === '') {
                throw new RuntimeException($key . ' must be set when MySQL is configured.');
            }
        }
        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
            $this->config->get('MYSQL_HOST'),
            $this->config->get('MYSQL_PORT', '3306'),
            $this->config->get('MYSQL_DATABASE')
        );
        $this->pdo = new PDO($dsn, $this->config->get('MYSQL_USER'), $this->config->get('MYSQL_PASSWORD'), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        return $this->pdo;
    }

    public function applyMigrations(string $root): void
    {
        $pdo = $this->connect();
        if ($pdo === null) {
            throw new RuntimeException('Configure MySQL before running database migrations.');
        }
        $pdo->exec(
            'CREATE TABLE IF NOT EXISTS matai_migrations (' .
            'migration_key VARCHAR(100) NOT NULL PRIMARY KEY,' .
            'applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP' .
            ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
        );
        $lock = $pdo->query("SELECT GET_LOCK('matai_schema_migration', 30)");
        if ($lock === false || (int) $lock->fetchColumn() !== 1) {
            throw new RuntimeException('Could not acquire the database migration lock.');
        }
        try {
            foreach (['001_initial', '002_currency_audit'] as $migrationKey) {
                $migration = $root . '/backend/migrations/' . $migrationKey . '.sql';
                if (!is_file($migration)) {
                    throw new RuntimeException('Required database migration is missing: ' . $migrationKey . '.sql');
                }
                $stmt = $pdo->prepare('SELECT migration_key FROM matai_migrations WHERE migration_key = ?');
                $stmt->execute([$migrationKey]);
                if (!$stmt->fetch()) {
                    if ($migrationKey === '002_currency_audit') {
                        $columns = $pdo->query(
                            "SELECT COLUMN_NAME FROM information_schema.COLUMNS " .
                            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matai_submissions'"
                        );
                        $existingColumns = $columns === false ? [] : $columns->fetchAll(PDO::FETCH_COLUMN);
                        $currencyColumns = ['amount_currency', 'preferred_currency', 'transaction_currency'];
                        $presentColumns = array_intersect($currencyColumns, $existingColumns);
                        if ($presentColumns !== [] && count($presentColumns) !== count($currencyColumns)) {
                            throw new RuntimeException('Currency audit migration is partially applied; inspect matai_submissions before retrying.');
                        }
                        if ($presentColumns === []) {
                            $sql = file_get_contents($migration);
                            if ($sql === false) {
                                throw new RuntimeException('Could not read database migration ' . $migrationKey . '.sql.');
                            }
                            foreach (array_filter(array_map('trim', explode(';', $sql))) as $statement) {
                                $pdo->exec($statement);
                            }
                        }
                    } else {
                        $sql = file_get_contents($migration);
                        if ($sql === false) {
                            throw new RuntimeException('Could not read database migration ' . $migrationKey . '.sql.');
                        }
                        foreach (array_filter(array_map('trim', explode(';', $sql))) as $statement) {
                            $pdo->exec($statement);
                        }
                    }
                    $insert = $pdo->prepare('INSERT INTO matai_migrations (migration_key) VALUES (?)');
                    $insert->execute([$migrationKey]);
                }
            }
            $this->importLegacyData($root);
        } finally {
            $pdo->query("SELECT RELEASE_LOCK('matai_schema_migration')");
        }
    }

    private function importLegacyData(string $root): void
    {
        $pdo = $this->connect();
        if ($pdo === null) {
            throw new RuntimeException('MySQL connection was not initialized.');
        }
        $pdo->beginTransaction();
        try {
            $check = $pdo->prepare('SELECT migration_key FROM matai_migrations WHERE migration_key = ?');
            $check->execute(['legacy-json-v1']);
            if (!$check->fetch()) {
                foreach (['register', 'abstract', 'contact', 'brochure'] as $kind) {
                    $file = $root . '/backend/data/' . $kind . '.json';
                    if (!is_file($file)) {
                        continue;
                    }
                    $records = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
                    if (!is_array($records)) {
                        throw new RuntimeException('Legacy submission file is not a JSON array: ' . $kind);
                    }
                    $insert = $pdo->prepare(
                        'INSERT IGNORE INTO matai_submissions ' .
                        '(kind, reference, received_at, status, payment_status, amount, amount_currency, ' .
                        'preferred_currency, transaction_currency, record_json) ' .
                        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                    );
                    foreach ($records as $record) {
                        if (!is_array($record) || !isset($record['reference'])) {
                            throw new RuntimeException('Legacy record is missing its reference: ' . $kind);
                        }
                        $data = is_array($record['data'] ?? null) ? $record['data'] : [];
                        $insert->execute([
                            $kind,
                            (string) $record['reference'],
                            (string) ($record['receivedAt'] ?? gmdate(DATE_ATOM)),
                            $record['status'] ?? null,
                            $record['paymentStatus'] ?? null,
                            isset($record['amount']) ? (float) $record['amount'] : null,
                            $record['amountCurrency'] ?? $record['transactionCurrency'] ?? $record['razorpayCurrency'] ?? null,
                            $record['preferredCurrency'] ?? $data['originalSelectedCurrency'] ?? $data['currency'] ?? null,
                            $record['transactionCurrency'] ?? $record['amountCurrency'] ?? $record['razorpayCurrency'] ?? null,
                            json_encode($record, JSON_THROW_ON_ERROR),
                        ]);
                    }
                }
                $contentFile = $root . '/backend/data/content.json';
                if (is_file($contentFile)) {
                    $content = file_get_contents($contentFile);
                    if ($content === false || !is_array(json_decode($content, true))) {
                        throw new RuntimeException('Legacy website content is invalid JSON.');
                    }
                    $contentStmt = $pdo->prepare(
                        'INSERT IGNORE INTO matai_site_content (content_key, content_json) VALUES (?, ?)'
                    );
                    $contentStmt->execute(['site', $content]);
                }
                $mark = $pdo->prepare('INSERT INTO matai_migrations (migration_key) VALUES (?)');
                $mark->execute(['legacy-json-v1']);
            }
            $pdo->commit();
        } catch (\Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
    }
}
