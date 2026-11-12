# Payment production audit

**Decision: NOT READY FOR LIVE PAYMENTS.** This is a repository/source audit, not a production deployment certification. No production host, MySQL instance, merchant dashboard, or payment sandbox credentials were available.

## Confirmed architecture

- Static HTML/CSS/vanilla JavaScript frontend in `frontend/`.
- Primary PHP 8.2+ API via `frontend/api.php` and `backend/php/router.php`; application dispatch is in `backend/src/Application.php`.
- PDO MySQL persistence with a private JSON mode for development/non-payment flows.
- A separate legacy Express implementation exists in `backend/server.js`; only the PHP API should be exposed as the production payment API.
- Registration pricing and validation are in `backend/src/RegistrationService.php`; provider enablement is in `backend/src/PaymentConfiguration.php`.
- Existing migrations are additive and include a unique provider/event key table, but there is no dedicated order/payment/refund ledger.

## Findings and status

| Area | Status | Evidence | Required before live payments |
|---|---|---|---|
| Server-side price calculation | IMPLEMENTED — NOT YET VERIFIED | `RegistrationService::prepare` recalculates categories, add-ons, coupons, 5% tax and currency; quote endpoint now exposes minor-unit lines. | Run PHP tests against authoritative pricing configuration; business owner must approve tax/coupon rules. |
| Date/price precision | IMPLEMENTED — NOT YET VERIFIED | Money is parsed into cents; date validation derives checkout date from check-in plus nights. | Run PHPUnit; confirm accommodation availability-window semantics. |
| Internal pending record before provider call | IMPLEMENTED — NOT YET VERIFIED | Stripe/PayPal/Razorpay flows save the registration and pricing snapshot before API order creation. | Add a dedicated transaction ledger, idempotency and recovery for ambiguous provider timeouts. |
| MySQL-only online payments | IMPLEMENTED — NOT YET VERIFIED | Provider availability is false without PDO; create/capture/verify/status/webhook operations fail closed in JSON mode. | Verify production MySQL health, migrations, backup and restore. |
| Stripe | PARTIALLY IMPLEMENTED | Server-side session and status verification, amount/currency matching, signed webhook, event-ID persistence. | No provider sandbox test; refund, reconciliation, internal idempotency and durable transaction records remain absent. |
| PayPal | PARTIALLY IMPLEMENTED | Server-side Orders API/capture; configured merchant check; official webhook verification endpoint; event-ID persistence. | No sandbox verification. Pending/denied/refund handling, reconciliation, idempotent internal checkout and transaction ledger remain absent. |
| Razorpay | PARTIALLY IMPLEMENTED | Server-side order, HMAC callback verification, fetched payment details, raw-body webhook signature verification and event-ID persistence. | No test-mode verification. Refund/reconciliation, full event-state handling and idempotent internal checkout remain absent. |
| Event deduplication | PARTIALLY IMPLEMENTED | Signed event IDs are checked and recorded in `matai_payment_events`; payment state mutation is repeat-safe. | Recording and state update are not one atomic operation; test duplicate/concurrent delivery and retry behavior. |
| Payment state transitions | PARTIALLY IMPLEMENTED | `setPayment` prevents delayed failed/cancelled events from overwriting paid status. | No formal state table, refund transitions or provider-independent reconciliation. |
| Checkout UX | PARTIALLY IMPLEMENTED | Existing JS recalculates locally; Stripe/PayPal/Razorpay now request and compare the server quote before provider initiation. | Browser/E2E responsive and accessibility testing is unavailable here; quote mismatch requires user resubmission. |
| Production configuration | BLOCKED | No host/database/provider configuration was inspected. | Staging tests, merchant configuration, HTTPS, monitoring, restore test and explicit business approval. |

## Architectural and business-rule risks

- The registration submission JSON record is still used as the internal order representation; there are no normalized `orders`, `payments`, `refunds`, or payment-attempt entities.
- No request idempotency key is stored with a unique database constraint. Browser button disabling and provider-specific request IDs are not a substitute.
- Provider order creation can time out after the provider has created an order. The internal record remains pending, but there is no automated provider lookup/reconciliation job.
- Coupon-use reservation is tied to registration storage, not a normalized atomic order ledger; concurrent requests can race on limited coupons.
- Current accommodation supports single/double occupancy and nightly pricing. There is no separate room-count, room-inventory, or room-availability model to verify.
- Tax is currently a fixed 5% of the post-discount subtotal. This must be confirmed by the business/tax owner; it must not be interpreted as legal/tax advice.
- Provider credentials, merchant account, supported currency, webhook setup, and sandbox behavior were not tested.

## Changes made in this pass

- Added the server-calculated quote route and wired online checkout flows to compare the quote before creating provider orders.
- Persisted an internal pending registration and a price-line snapshot before the provider API call.
- Required MySQL persistence for online provider operations and hid provider availability without PDO.
- Changed price/coupon calculations and amount matching to decimal-safe integer minor-unit handling.
- Validated calendar dates and derived accommodation checkout date server-side.
- Added PayPal merchant and webhook configuration requirements, signature verification using PayPal's verification API, and verified-capture checks.
- Added provider event-ID lookup/storage using the existing unique event table and protected paid state from late failure/cancellation.
