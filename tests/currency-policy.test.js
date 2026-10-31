"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isExplicitlyVerified,
  paymentMatches,
  selectTransactionCurrency
} = require("../backend/currency-policy");

test("USD checkout requires an explicit confirmation when the attendee preferred another currency", () => {
  assert.throws(() => selectTransactionCurrency({
    currency: "USD",
    originalSelectedCurrency: "EUR",
    currencyFallbackConfirmed: "false"
  }), /Confirm the currency change/);

  assert.deepEqual(selectTransactionCurrency({
    currency: "USD",
    originalSelectedCurrency: "EUR",
    currencyFallbackConfirmed: "true"
  }), {
    preferredCurrency: "EUR",
    transactionCurrency: "USD",
    currencyFallbackConfirmed: true
  });
});

test("unsupported transaction currencies are rejected", () => {
  assert.throws(() => selectTransactionCurrency({
    currency: "INR",
    originalSelectedCurrency: "USD",
    currencyFallbackConfirmed: "false"
  }), /not available for checkout/);
});

test("provider amount and currency must both match the internal order", () => {
  assert.equal(paymentMatches(105, "USD", 105, "USD"), true);
  assert.equal(paymentMatches(105, "USD", 104.99, "USD"), false);
  assert.equal(paymentMatches(105, "USD", 105, "EUR"), false);
});

test("provider readiness requires explicit verification", () => {
  assert.equal(isExplicitlyVerified("true"), true);
  assert.equal(isExplicitlyVerified(" TRUE "), true);
  assert.equal(isExplicitlyVerified("false"), false);
  assert.equal(isExplicitlyVerified(""), false);
});
