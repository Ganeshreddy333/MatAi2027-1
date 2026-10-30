"use strict";

const BASE_CURRENCY = "EUR";
const TRANSACTION_CURRENCIES = new Set([BASE_CURRENCY]);
const SELECTABLE_CURRENCIES = new Set(["EUR", "USD", "GBP", "INR"]);

function currencyError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function isExplicitlyVerified(value) {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

function selectTransactionCurrency(input) {
  const selectedCurrency = String(input && input.currency || "").trim().toUpperCase();
  const originalSelectedCurrency = String(input && input.originalSelectedCurrency || "").trim().toUpperCase();
  const fallbackConfirmed = input && [true, "true", "1", "on"].includes(input.currencyFallbackConfirmed);

  if (!TRANSACTION_CURRENCIES.has(selectedCurrency)) {
    throw currencyError("The selected currency is not available for checkout. Confirm the EUR fallback or choose EUR.");
  }
  if (!SELECTABLE_CURRENCIES.has(originalSelectedCurrency)) {
    throw currencyError("Select a valid preferred currency.");
  }
  if (originalSelectedCurrency !== selectedCurrency && !fallbackConfirmed) {
    throw currencyError("Confirm the currency change before continuing to checkout.");
  }
  if (originalSelectedCurrency === selectedCurrency && fallbackConfirmed) {
    throw currencyError("The currency fallback confirmation is not applicable to the selected currency.");
  }

  return {
    preferredCurrency: originalSelectedCurrency,
    transactionCurrency: selectedCurrency,
    currencyFallbackConfirmed: Boolean(fallbackConfirmed)
  };
}

function moneyInMinorUnits(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round((amount + Number.EPSILON) * 100);
}

function paymentMatches(expectedAmount, expectedCurrency, actualAmount, actualCurrency) {
  const expectedMinor = moneyInMinorUnits(expectedAmount);
  const actualMinor = moneyInMinorUnits(actualAmount);
  return expectedMinor !== null &&
    actualMinor !== null &&
    typeof expectedCurrency === "string" &&
    expectedCurrency === actualCurrency &&
    actualMinor === expectedMinor;
}

module.exports = {
  BASE_CURRENCY,
  isExplicitlyVerified,
  paymentMatches,
  selectTransactionCurrency
};
