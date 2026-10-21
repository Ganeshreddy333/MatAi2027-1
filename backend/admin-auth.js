"use strict";

const crypto = require("crypto");

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function hashAdminPassword(password, salt) {
  if (typeof password !== "string" || password.length < 12) {
    throw new Error("Administrator passwords must contain at least 12 characters.");
  }
  const saltBytes = salt || crypto.randomBytes(SALT_LENGTH);
  if (!Buffer.isBuffer(saltBytes) || saltBytes.length !== SALT_LENGTH) {
    throw new Error("Password salt must be exactly 16 bytes.");
  }
  const digest = crypto.scryptSync(password, saltBytes, KEY_LENGTH, SCRYPT_OPTIONS);
  return "scrypt$16384$8$1$" + saltBytes.toString("hex") + "$" + digest.toString("hex");
}

function verifyAdminPassword(password, encodedHash) {
  if (typeof password !== "string" || typeof encodedHash !== "string") return false;
  const match = /^scrypt\$16384\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/i.exec(encodedHash);
  if (!match) return false;
  const salt = Buffer.from(match[1], "hex");
  const expected = Buffer.from(match[2], "hex");
  const actual = crypto.scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return crypto.timingSafeEqual(actual, expected);
}

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function sessionCookie(token, secure, maxAgeSeconds) {
  return "matai_admin=" + encodeURIComponent(token) + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" +
    String(maxAgeSeconds) + (secure ? "; Secure" : "");
}

module.exports = { hashAdminPassword, verifyAdminPassword, safeEqual, sessionCookie };
