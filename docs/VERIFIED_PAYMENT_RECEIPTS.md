# Verified Razorpay payments and receipts

## Architecture

The PHP API is authoritative. Registration pricing and its immutable minor-unit snapshot are recalculated and persisted before a Razorpay order is created. Migration `004_verified_receipts.sql` adds the per-registration verification/receipt ledger. The fresh-install hPanel schema contains the same table.

Razorpay payments use one centralized `PaymentVerificationService`. A captured payment is independently fetched from Razorpay's authenticated API and must match the stored order ID, payment ID, captured status, amount, currency, captured order amount, registration reference, and original server quote. The checkout callback signature and raw-body webhook signature are verified separately. The ledger records those signals independently and is idempotent on provider payment/event IDs.

The state progression is:

`INITIATED` → `CALLBACK_VERIFIED` and/or `WEBHOOK_VERIFIED` → `FULLY_VERIFIED` → `RECEIPT_GENERATED`

The callback and webhook may arrive in either order. Both are mandatory before receipt generation. All financial/database gates and the receipt blob, receipt number, and registration Paid update are committed in one database transaction. A duplicate signal cannot downgrade a generated receipt or create another receipt. A failure signal records `FAILED`; it never marks a registration paid.

## API endpoints

| Method and path | Access | Behavior |
|---|---|---|
| `POST /api/checkout/razorpay/order` | Public checkout + CSRF | Recalculate and persist quote, create the Razorpay order, return a one-time registration access token. |
| `POST /api/checkout/razorpay/verify` | Checkout HMAC + registration access token + CSRF | Verify the callback signature, fetch payment and order from Razorpay, record the callback signal only for an exactly matched captured payment. |
| `POST /api/razorpay/webhook` | Razorpay raw-body webhook signature | Fetch current provider order/payment and record the independently verified webhook signal idempotently. |
| `GET /api/registrations/{reference}/payment-status` | `X-Registration-Access` capability | Return pending/failed/verified status; no receipt data or file path is exposed. |
| `GET /api/registrations/{reference}/receipt` | `X-Registration-Access` capability | Return the stored PDF only in `RECEIPT_GENERATED`. |
| `GET /admin/api/registrations/{reference}/payment` | Authenticated administrator | Return verification flags and verified transaction details. |
| `GET /admin/api/registrations/{reference}/receipt` | Authenticated administrator | Download the verified PDF. |

The access token is random and returned only when creating the order; only its SHA-256 hash is stored. The frontend keeps the token and callback response in the current browser session, sends the token in a header (not a URL), polls the backend, and displays the receipt button only after the backend returns both `paid: true` and `receiptReady: true`. Closing the checkout or a browser redirect is not considered proof of payment.

## Reconciliation and receipt content

Reconciliation uses the original saved pricing snapshot and integer minor units. It checks item line totals, gross subtotal, discount, the configured 5% tax after discount, final total, transaction currency, provider order amount, Razorpay captured order amount, and captured payment amount/currency. Any mismatch prevents receipt generation. The receipt is rendered from the verified stored registration/payment records and includes participant and registration details, selected items, accommodation/dates, coupon/discount/tax, exact amount/currency, payment method and Razorpay IDs, receipt number, and transaction time.

The venue page currently says the venue is still to be announced; the PDF states that rather than inventing a venue name. Conference dates/location are included as shown on the site.

## Deployment

Apply the additive migration using the existing PHP migration command (`php backend/bin/migrate.php`) after taking a database backup. For a fresh hPanel database, import `backend/migrations/hpanel-full-import.sql` instead. Configure the Razorpay webhook for `payment.captured` and `payment.failed`, and keep the checkout/webhook secrets private. Existing installations must run the incremental migration; updating application files alone is insufficient.

## Verification limits

Automated coverage includes PDF content/string escaping. Provider behavior, webhook delivery/retries, MySQL locking/rollback, concurrent delivery, browser persistence, protected downloads, and end-to-end Razorpay test-mode payments require a configured MySQL integration/staging environment and credentials. Do not treat source-level checks as sandbox evidence. Production and live-payment readiness remain unverified until those tests and deployment checks are completed.
