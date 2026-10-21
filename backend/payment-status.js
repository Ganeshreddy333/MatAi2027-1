"use strict";

function applyVerifiedPaymentStatus(record, status, extra) {
  if (!record) return false;

  const current = record.paymentStatus || "Pending";
  if (status === "Paid") {
    if (!["Pending", "Failed", "Cancelled"].includes(current)) return false;
  } else if (["Failed", "Cancelled"].includes(status)) {
    if (current !== "Pending") return false;
  } else {
    return false;
  }

  record.paymentStatus = status;
  Object.assign(record, extra || {});
  return true;
}

module.exports = { applyVerifiedPaymentStatus };
