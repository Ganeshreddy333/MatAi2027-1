# Payment implementation report

## Implemented in this pass

- `POST /api/checkout/quote` calculates from server-managed content using `RegistrationService`; response amounts are in integer minor units with item, quantity, discount, tax and total fields.
- Stripe, PayPal and Razorpay checkout now persist an internal pending registration plus pricing snapshot before making a provider order request. Provider references are attached afterward.
- Online payment creation, capture, verification, status and webhook routes require a live PDO MySQL connection. JSON fallback cannot accept online-provider payments.
- Registration and accommodation amounts are converted to cents without float arithmetic; coupon percentage discount and fixed discount calculations use integer arithmetic.
- Check-in dates are validated as actual calendar dates and checkout date is derived server-side from nights.
- Stripe API order creation uses a provider idempotency key based on the internal reference; PayPal order/capture calls use `PayPal-Request-Id`.
- PayPal is disabled until credentials, verified USD configuration, merchant ID and webhook ID are configured. PayPal webhook signatures are checked through PayPal's official verification API, and captures are checked against the configured merchant and internal amount/currency.
- Stripe, Razorpay and PayPal webhook event IDs are stored in the existing unique provider/event table after signature verification. Payment transitions do not allow late failure/cancellation to replace paid.
- Frontend online flows request the server quote before provider initiation and stop when amount or currency does not match.

## Not complete / not safe to enable live payments

- No dedicated order/payment/refund ledger or normalized relationship constraints.
- No internal idempotency-key table, order expiry, safe multi-attempt retry policy, payment attempt ledger, or concurrency proof.
- Webhook event insertion and payment-state update are not committed in a single transaction.
- No verified refund/dispute/chargeback lifecycle, reconciliation job, payment-success outbox, or exactly-once receipt.
- Full PayPal pending/denied/refunded and Razorpay authorized/refunded state handling is incomplete.
- No merchant-account sandbox tests, payment API mock suite, MySQL integration test, or production-like migration/restore test was run.
- No production host, firewall, origin, CSP, backup, monitoring, or deployment rollback was verified.

**Release status: NOT READY FOR LIVE PAYMENTS.** Keep provider verification flags false until the remaining implementation and provider-side tests are complete.
