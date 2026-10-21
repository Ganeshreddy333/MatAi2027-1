"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { applyVerifiedPaymentStatus } = require("../backend/payment-status");

test("a verified paid state is not overwritten by delayed cancellation", () => {
  const record = { paymentStatus: "Paid" };

  assert.equal(applyVerifiedPaymentStatus(record, "Cancelled"), false);
  assert.equal(record.paymentStatus, "Paid");
});

test("a verified paid state is not overwritten by delayed failure", () => {
  const record = { paymentStatus: "Paid" };

  assert.equal(applyVerifiedPaymentStatus(record, "Failed"), false);
  assert.equal(record.paymentStatus, "Paid");
});

test("late verified capture can resolve pending, failed, or cancelled payments", () => {
  for (const paymentStatus of ["Pending", "Failed", "Cancelled"]) {
    const record = { paymentStatus };

    assert.equal(applyVerifiedPaymentStatus(record, "Paid", { providerPaymentId: "pay_test" }), true);
    assert.equal(record.paymentStatus, "Paid");
    assert.equal(record.providerPaymentId, "pay_test");
  }
});

test("payment failure and cancellation only transition pending records", () => {
  for (const paymentStatus of ["Failed", "Cancelled", "Refunded"]) {
    const record = { paymentStatus };

    assert.equal(applyVerifiedPaymentStatus(record, "Failed"), false);
    assert.equal(applyVerifiedPaymentStatus(record, "Cancelled"), false);
    assert.equal(record.paymentStatus, paymentStatus);
  }
});

test("unsupported payment statuses are rejected", () => {
  const record = { paymentStatus: "Pending" };

  assert.equal(applyVerifiedPaymentStatus(record, "Refunded"), false);
  assert.equal(record.paymentStatus, "Pending");
});
