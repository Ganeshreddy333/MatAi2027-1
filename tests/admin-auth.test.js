"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { hashAdminPassword, verifyAdminPassword, safeEqual, sessionCookie } = require("../backend/admin-auth");
const { createCsrfProtection } = require("../backend/csrf-protection");

test("scrypt admin password hashes validate only the matching password", () => {
  const password = "correct horse battery staple";
  const encodedHash = hashAdminPassword(password, Buffer.alloc(16, 7));

  assert.match(encodedHash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(verifyAdminPassword(password, encodedHash), true);
  assert.equal(verifyAdminPassword("incorrect password", encodedHash), false);
  assert.equal(verifyAdminPassword(password, "plaintext-password"), false);
});

test("password hashing rejects short passwords and invalid salts", () => {
  assert.throws(() => hashAdminPassword("too-short"));
  assert.throws(() => hashAdminPassword("long enough password", Buffer.alloc(8)));
});

test("CSRF middleware accepts safe methods and rejects missing or invalid tokens", () => {
  const middleware = createCsrfProtection(
    () => ({ session: { csrf: "expected-token" } }),
    safeEqual
  );
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; }
  };
  let nextCalls = 0;
  const next = () => { nextCalls += 1; };

  middleware({ method: "GET", get: () => "" }, response, next);
  assert.equal(nextCalls, 1);

  middleware({ method: "POST", get: () => "" }, response, next);
  assert.equal(response.statusCode, 419);
  assert.equal(response.body.ok, false);
  assert.equal(nextCalls, 1);

  middleware({ method: "POST", get: () => "wrong-token" }, response, next);
  assert.equal(response.statusCode, 419);
  assert.equal(nextCalls, 1);

  middleware({ method: "POST", get: () => "expected-token" }, response, next);
  assert.equal(nextCalls, 2);
});

test("session cookies are HttpOnly and SameSite=Strict, with Secure in HTTPS deployments", () => {
  const localCookie = sessionCookie("test-token", false, 28800);
  const productionCookie = sessionCookie("test-token", true, 28800);

  assert.match(localCookie, /HttpOnly/);
  assert.match(localCookie, /SameSite=Strict/);
  assert.doesNotMatch(localCookie, /; Secure/);
  assert.match(productionCookie, /; Secure/);
});

test("CSRF token comparison is constant-time for equal-length values", () => {
  assert.equal(safeEqual("token", "token"), true);
  assert.equal(safeEqual("token", "other"), false);
  assert.equal(safeEqual("token", "longer"), false);
  assert.equal(safeEqual("token", null), false);
});
