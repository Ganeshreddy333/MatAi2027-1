"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isExplicitlyVerified,
  paymentMatches,
  selectTransactionCurrency
} = require("../backend/currency-policy");

test("EUR checkout requires an explicit confirmation when the attendee preferred another currency", () => {
  assert.throws(() => selectTransactionCurrency({
    currency: "EUR",
    originalSelectedCurrency: "USD",
    currencyFallbackConfirmed: "false"
  }), /Confirm the currency change/);

  assert.deepEqual(selectTransactionCurrency({
    currency: "EUR",
    originalSelectedCurrency: "USD",
    currencyFallbackConfirmed: "true"
  }), {
    preferredCurrency: "USD",
    transactionCurrency: "EUR",
    currencyFallbackConfirmed: true
  });
});

test("unsupported transaction currencies are rejected", () => {
  assert.throws(() => selectTransactionCurrency({
    currency: "USD",
    originalSelectedCurrency: "USD",
    currencyFallbackConfirmed: "false"
  }), /not available for checkout/);
});

test("provider amount and currency must both match the internal order", () => {
  assert.equal(paymentMatches(105, "EUR", 105, "EUR"), true);
  assert.equal(paymentMatches(105, "EUR", 104.99, "EUR"), false);
  assert.equal(paymentMatches(105, "EUR", 105, "USD"), false);
});

test("provider readiness requires explicit verification", () => {
  assert.equal(isExplicitlyVerified("true"), true);
  assert.equal(isExplicitlyVerified(" TRUE "), true);
  assert.equal(isExplicitlyVerified("false"), false);
  assert.equal(isExplicitlyVerified(""), false);
});
