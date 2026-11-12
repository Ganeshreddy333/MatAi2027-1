# Payment security review (source-level)

**Scope:** review of repository payment paths changed in this pass. This is not a penetration test, independent security audit, or production configuration verification.

## Controls observed or added

- Backend recalculates amounts; client totals are compared only for user-facing confirmation.
- Payment routes fail closed without MySQL; provider visibility is disabled without PDO.
- Provider order requests are preceded by internal pending record persistence and snapshot creation.
- Stripe/Razorpay callback and webhook authenticity checks exist; PayPal webhook verification uses the provider verification API.
- PayPal requires configured merchant and webhook identifiers and compares the merchant on captured orders.
- Webhook IDs are stored under a unique provider/event key; only minimal resource metadata is stored.
- Payment status mutation now protects paid state against delayed failure/cancellation.
- PHP error responses in `backend/php/index.php` are configured not to display errors to visitors; logging avoids raw payment data.
- Existing CSRF, secure-session and rate-limiting controls remain in the PHP app.

## Outstanding security/reliability risks

- No unique internal idempotency key or order lock; simultaneous submissions may create multiple pending registrations/provider orders.
- Event dedupe row and payment-state write are not atomic; out-of-order state handling is only partial.
- No order expiry, refund/reversal state model, dispute handling, reconciliation worker, or durable transaction ledger.
- Guest payment operations rely on provider IDs and registration records; there is no explicit customer ownership token or signed order-session capability.
- CORS/origin policy, CSP, deployment document root, `.env` exposure, production HTTPS/proxy, secret scanning and database least privilege have not been verified on a deployed host.
- PayPal/Razorpay/Stripe provider behavior has not been sandbox-tested; merchant ownership/currency flags are configuration claims until independently validated.
- Payment notifications are not driven by a durable exactly-once outbox.

## Decision

No known live exploitable vulnerability is asserted from this source-only review. The application is **NOT READY FOR LIVE PAYMENTS** until the high-risk lifecycle, idempotency, ledger, reconciliation and deployment verification items are addressed.
