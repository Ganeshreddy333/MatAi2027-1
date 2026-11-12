# Production go-live checklist (175 items)

**Current decision: NOT READY FOR LIVE PAYMENTS.** Statuses are evidence-based as of this source-only pass. A section's evidence, files, test performed and remaining action apply to every item in that section. `VERIFIED` means locally verified only; it does not imply production verification.

## 1. Repository and architecture verification (9)

Evidence/files: `README.md`, `backend/php/router.php`, `frontend/api.php`, `backend/server.js`, `.gitignore`, `composer.lock`, `backend/php/index.php`. Tests: source inspection; PHP runtime/deployment unavailable. Action: confirm production host/version/document root, install locked dependencies, inspect deployment and secret scan.

- [BLOCKED] Confirm PHP 8.2+ is used in production.
- [IMPLEMENTED — NOT YET VERIFIED] Confirm the PHP router is the active API entry point.
- [IMPLEMENTED — NOT YET VERIFIED] Confirm frontend calls the intended PHP API.
- [NEEDS FIX] Confirm payment endpoints are not duplicated across PHP and Express; Express still contains a separate payment implementation.
- [BLOCKED] Confirm `backend/server.js` is not unintentionally exposed as a second production API.
- [BLOCKED] Confirm Composer dependencies are installed using the production lockfile.
- [IMPLEMENTED — NOT YET VERIFIED] Confirm debug mode and PHP error display are disabled in production.
- [BLOCKED] Confirm no test endpoints or development credentials remain in deployment configuration.
- [IMPLEMENTED — NOT YET VERIFIED] Confirm all payment-related routes are documented.

## 2. Registration and checkout calculations (17)

Evidence/files: `backend/src/RegistrationService.php`, `backend/src/CurrencyPolicy.php`, `frontend/js/register.js`, `frontend/js/checkout.js`, `backend/src/Application.php`. Tests: Node tests cover unrelated legacy logic; PHP tests were added but not executed because PHP is unavailable. Action: execute PHP suite and browser tests against approved prices; owner to confirm tax and accommodation rules.

- [IMPLEMENTED — NOT YET VERIFIED] Verify every registration category and its configured price.
- [IMPLEMENTED — NOT YET VERIFIED] Verify participant count and additional participant pricing.
- [IMPLEMENTED — NOT YET VERIFIED] Verify accommodation eligibility and selection rules.
- [IMPLEMENTED — NOT YET VERIFIED] Verify room types and room prices; current model has single/double occupancy only.
- [NOT IMPLEMENTED] Verify room quantity calculations; no distinct room-count or inventory field exists.
- [IMPLEMENTED — NOT YET VERIFIED] Verify room nights, check-in validation and server-derived checkout date.
- [IMPLEMENTED — NOT YET VERIFIED] Verify additional services and optional charges.
- [IMPLEMENTED — NOT YET VERIFIED] Verify coupon and discount validation.
- [BLOCKED] Verify tax rules; code applies 5% after discount, pending business/tax-owner approval.
- [IMPLEMENTED — NOT YET VERIFIED] Verify USD currency and fallback rules; no payment fee is currently applied.
- [IMPLEMENTED — NOT YET VERIFIED] Verify integer-minor-unit rounding behavior.
- [PARTIALLY IMPLEMENTED] Verify itemized checkout summary; quote API returns itemized data, but the normal page summary remains locally rendered.
- [IMPLEMENTED — NOT YET VERIFIED] Verify displayed totals update after selection changes.
- [IMPLEMENTED — NOT YET VERIFIED] Verify invalid selections are rejected.
- [IMPLEMENTED — NOT YET VERIFIED] Verify backend independently recalculates the complete order.
- [IMPLEMENTED — NOT YET VERIFIED] Verify checkout cannot be manipulated through browser tools or HTTP payloads.
- [PARTIALLY IMPLEMENTED] Verify price changes between quote and payment; checkout recomputes before initiation but has no persisted quote version/expiry.

## 3. PHP backend payment processing (14)

Evidence/files: `backend/src/Application.php`, `backend/src/Store.php`, `backend/src/RegistrationService.php`. Tests: no PHP tests executed. Action: add dedicated order/idempotency entities and MySQL concurrency/provider failure tests.

- [IMPLEMENTED — NOT YET VERIFIED] Validate request data server-side.
- [IMPLEMENTED — NOT YET VERIFIED] Use prepared PDO statements for database queries.
- [PARTIALLY IMPLEMENTED] Use database transactions for related order/payment writes; Store mutations transact, but provider operation and ledger state are not one transaction.
- [IMPLEMENTED — NOT YET VERIFIED] Create an internal pending registration before provider order creation.
- [PARTIALLY IMPLEMENTED] Store a pricing snapshot in the registration record; no immutable ledger table/database-level immutability exists.
- [IMPLEMENTED — NOT YET VERIFIED] Generate unique internal references.
- [NOT IMPLEMENTED] Implement unique request-level idempotency for repeated checkout submissions.
- [IMPLEMENTED — NOT YET VERIFIED] Create provider orders using backend-calculated totals.
- [IMPLEMENTED — NOT YET VERIFIED] Compare provider amount and currency against the internal registration.
- [PARTIALLY IMPLEMENTED] Handle provider timeouts; pending record remains, but there is no automated recovery/reconciliation.
- [PARTIALLY IMPLEMENTED] Prevent one order from being paid twice through repeat-safe status transitions; no unique normalized payment record exists.
- [NOT IMPLEMENTED] Implement a complete safe payment retry policy.
- [IMPLEMENTED — NOT YET VERIFIED] Ensure frontend cannot mark an online order paid.
- [PARTIALLY IMPLEMENTED] Associate provider operations with internal orders; explicit guest ownership/session binding is absent.

## 4. MySQL and data integrity (15)

Evidence/files: `backend/src/Database.php`, `backend/src/Store.php`, `backend/migrations/001_initial.sql`–`003_payment_coupon_audit.sql`. Tests: code inspection only; no database, migration copy, or restore test available. Action: run on a production-like MySQL copy and implement normalized financial ledger.

- [BLOCKED] Confirm MySQL is configured as the production persistence layer.
- [IMPLEMENTED — NOT YET VERIFIED] Ensure online-provider operations fail closed without MySQL.
- [BLOCKED] Confirm all required migrations are applied in production.
- [BLOCKED] Test migrations on a production-like database copy.
- [PARTIALLY IMPLEMENTED] Review foreign keys and relationship constraints; normalized order/payment relationships do not exist.
- [PARTIALLY IMPLEMENTED] Use decimal columns and integer minor units; submission amount is `DECIMAL(12,2)`, calculations use integer cents.
- [IMPLEMENTED — NOT YET VERIFIED] Persist currency with each registration/payment record.
- [PARTIALLY IMPLEMENTED] Persist provider name and order ID in registration JSON; no normalized provider-order column.
- [PARTIALLY IMPLEMENTED] Persist provider payment/capture IDs in registration JSON.
- [PARTIALLY IMPLEMENTED] Keep payment status transitions repeat-safe; no independent order state exists.
- [PARTIALLY IMPLEMENTED] Unique webhook event IDs exist; provider transaction IDs have no normalized unique constraints.
- [IMPLEMENTED — NOT YET VERIFIED] Store webhook event IDs with uniqueness constraints in migration 003.
- [PARTIALLY IMPLEMENTED] Add lookup indexes; no dedicated order/payment indexes exist.
- [BLOCKED] Test backup restoration.
- [IMPLEMENTED — NOT YET VERIFIED] Ensure migrations preserve existing records; migration source is additive, but production migration execution was not observed.

## 5. PayPal production readiness (13)

Evidence/files: `backend/src/Application.php`, `backend/src/PaymentConfiguration.php`, `.env.example`. Tests: no PayPal sandbox/API mock run. Action: configure sandbox merchant/webhook, test the full flow, then validate live setup after approval.

- [BLOCKED] Use PayPal sandbox for complete end-to-end testing.
- [IMPLEMENTED — NOT YET VERIFIED] Create orders through the PHP backend.
- [IMPLEMENTED — NOT YET VERIFIED] Use server-calculated amount and currency.
- [PARTIALLY IMPLEMENTED] Validate approval/return and cancellation; return captures server-side, cancellation is only a frontend state.
- [IMPLEMENTED — NOT YET VERIFIED] Capture payments server-side.
- [IMPLEMENTED — NOT YET VERIFIED] Verify capture status before marking paid.
- [IMPLEMENTED — NOT YET VERIFIED] Verify captured amount and currency.
- [IMPLEMENTED — NOT YET VERIFIED] Verify configured merchant/payee identifier.
- [PARTIALLY IMPLEMENTED] Persist PayPal order and capture IDs in registration JSON.
- [IMPLEMENTED — NOT YET VERIFIED] Verify webhook authenticity using PayPal's verification API.
- [PARTIALLY IMPLEMENTED] Record duplicate webhook IDs and protect paid status; atomic event/state processing and complete ordering are unverified.
- [NOT IMPLEMENTED] Complete pending, denied, cancellation and refund transaction states.
- [PARTIALLY IMPLEMENTED] Retrieve/capture status after uncertain browser return; no background reconciliation exists.

## 6. Razorpay production readiness (14)

Evidence/files: `backend/src/Application.php`, `backend/src/PaymentConfiguration.php`, `.env.example`. Tests: no Razorpay test-mode/API mock run. Action: test raw webhook delivery, callback signatures, payment association, duplicate delivery and provider outage cases.

- [BLOCKED] Use Razorpay test mode for complete end-to-end testing.
- [IMPLEMENTED — NOT YET VERIFIED] Create Razorpay orders on the PHP backend.
- [IMPLEMENTED — NOT YET VERIFIED] Convert amount to minor units.
- [IMPLEMENTED — NOT YET VERIFIED] Use configured USD currency; merchant account setup remains unverified.
- [IMPLEMENTED — NOT YET VERIFIED] Verify checkout payment HMAC server-side.
- [IMPLEMENTED — NOT YET VERIFIED] Fetch provider payment details.
- [IMPLEMENTED — NOT YET VERIFIED] Verify payment belongs to the expected Razorpay order.
- [IMPLEMENTED — NOT YET VERIFIED] Require captured status for paid transition.
- [IMPLEMENTED — NOT YET VERIFIED] Verify actual amount and currency.
- [PARTIALLY IMPLEMENTED] Persist Razorpay order and payment IDs in registration JSON.
- [IMPLEMENTED — NOT YET VERIFIED] Verify webhook signature over raw request body.
- [PARTIALLY IMPLEMENTED] Store event IDs and use repeat-safe status transitions; concurrent delivery testing is outstanding.
- [PARTIALLY IMPLEMENTED] Handle failed/authorized/captured; refunded state is not implemented.
- [NOT IMPLEMENTED] Verify retries cannot create duplicate successful registrations; request idempotency is absent.

## 7. Security and configuration (17)

Evidence/files: `backend/src/Security.php`, `backend/src/Application.php`, `backend/php/index.php`, `.env.example`, `.htaccess`, frontend scripts. Tests: existing Node security tests passed; no PHP/runtime security test or deployment scan available. Action: staging security test, secret scan, CSP/origin review, host configuration audit.

- [IMPLEMENTED — NOT YET VERIFIED] Keep provider secrets server-side.
- [IMPLEMENTED — NOT YET VERIFIED] Keep `.env` outside public web root per deployment instructions.
- [BLOCKED] Verify `.env` and backup files cannot be downloaded from production host.
- [BLOCKED] Verify no credentials/API keys exist in Git history or frontend artifacts.
- [IMPLEMENTED — NOT YET VERIFIED] Use environment-specific configuration with disabled-by-default provider flags.
- [BLOCKED] Verify HTTPS throughout the deployed application.
- [IMPLEMENTED — NOT YET VERIFIED] Use secure, HttpOnly, SameSite session cookies.
- [IMPLEMENTED — NOT YET VERIFIED] Verify CSRF on applicable browser state-changing routes.
- [IMPLEMENTED — NOT YET VERIFIED] Verify admin authentication and authorization.
- [IMPLEMENTED — NOT YET VERIFIED] Verify checkout rate limiting.
- [IMPLEMENTED — NOT YET VERIFIED] No cross-origin API allowance is intentionally configured; confirm host/proxy behavior.
- [IMPLEMENTED — NOT YET VERIFIED] Prepared statements and context-safe frontend text insertion are used in inspected paths.
- [PARTIALLY IMPLEMENTED] Provider order references are checked against internal records; explicit guest ownership binding is absent.
- [PARTIALLY IMPLEMENTED] Signed events and unique IDs reduce replay risk; full atomic idempotency is absent.
- [IMPLEMENTED — NOT YET VERIFIED] Validate provider webhook authenticity before applying payment state.
- [IMPLEMENTED — NOT YET VERIFIED] Avoid logging raw secrets/tokens/payment bodies in inspected payment handlers.
- [IMPLEMENTED — NOT YET VERIFIED] PHP display errors are disabled in web SAPI; production error-log configuration remains host-dependent.

## 8. Payment lifecycle and recovery (13)

Evidence/files: `backend/src/Application.php`, `backend/src/Store.php`, `backend/migrations/003_payment_coupon_audit.sql`. Tests: no provider/DB lifecycle tests. Action: implement normalized event/payment ledger, reconciliation, expiry and refund state machine.

- [PARTIALLY IMPLEMENTED] Define allowed payment transitions in code; no central formal state model.
- [NOT IMPLEMENTED] Keep all applicable pending/authorized/processing/paid/failed/cancelled/expired/refunded states distinct.
- [IMPLEMENTED — NOT YET VERIFIED] Only verified captured/settled payments become paid in current online flows.
- [NOT IMPLEMENTED] Reliably recover provider success followed by local database failure.
- [PARTIALLY IMPLEMENTED] Browser closure can be resolved by provider webhooks; no universal status-recovery page.
- [PARTIALLY IMPLEMENTED] Handle repeated/delayed events through event IDs and guarded transitions; no atomic claim.
- [PARTIALLY IMPLEMENTED] Provider timeouts leave a pending internal record; automated resolution is absent.
- [NOT IMPLEMENTED] Implement server-side reconciliation.
- [NOT IMPLEMENTED] Prevent payment on expired orders with an expiry/recovery policy; orders do not expire.
- [NOT IMPLEMENTED] Handle partial and full refunds.
- [PARTIALLY IMPLEMENTED] Keep a webhook event record; a full auditable payment event history is absent.
- [PARTIALLY IMPLEMENTED] Current general submission mail may be sent while pending; verified-success receipt is not a durable workflow.
- [NOT IMPLEMENTED] Ensure confirmation/receipt is issued exactly once through an outbox.

## 9. Frontend checkout and user experience (12)

Evidence/files: `frontend/js/register.js`, `frontend/js/checkout.js`, `frontend/registration.html`. Tests: JavaScript syntax checked; no browser E2E/mobile/accessibility test. Action: test desktop/tablet/mobile, provider return, refresh and quote reconciliation.

- [PARTIALLY IMPLEMENTED] Show an itemized local registration summary; server quote details are returned but not fully rendered as the normal summary.
- [PARTIALLY IMPLEMENTED] Registration, accommodation, add-ons, discount and tax are locally displayed; verify parity with server quote in browser.
- [IMPLEMENTED — NOT YET VERIFIED] Show currency and final amount.
- [IMPLEMENTED — NOT YET VERIFIED] Disable the submit button while an online checkout request is in flight.
- [PARTIALLY IMPLEMENTED] Show processing/success/failure/cancellation/pending states; provider failure/status recovery is incomplete.
- [IMPLEMENTED — NOT YET VERIFIED] Never rely solely on provider redirect for paid status.
- [IMPLEMENTED — NOT YET VERIFIED] Fetch backend/provider status for Stripe return and server capture for PayPal.
- [PARTIALLY IMPLEMENTED] Webhooks can resolve browser closure; general refresh recovery/status lookup is absent.
- [IMPLEMENTED — NOT YET VERIFIED] Browser amount edits are ignored by authoritative backend price calculation.
- [IMPLEMENTED — NOT YET VERIFIED] Provider methods are shown only when API config enables them.
- [BLOCKED] Test desktop, tablet and mobile layouts.
- [PARTIALLY IMPLEMENTED] Back/cancel routes exist; test provider navigation behavior.

## 10. Testing and quality assurance (21)

Evidence/files: `tests/`, `composer.json`, frontend scripts. Tests: `npm test` last executed with 17/17 passing; `php` is unavailable. Action: install PHP 8.2+ and locked Composer dependencies, execute PHPUnit/PHPStan, then run isolated provider and DB tests.

- [IMPLEMENTED — NOT YET VERIFIED] Unit-test pricing/tax calculations; new PHP cases were added but not executed.
- [PARTIALLY IMPLEMENTED] Test registration categories; existing coverage is incomplete and unexecuted here.
- [PARTIALLY IMPLEMENTED] Test minimum/maximum participant quantities; not executed here.
- [NOT IMPLEMENTED] Test all room/accommodation combinations; distinct room count is unsupported.
- [PARTIALLY IMPLEMENTED] Test discounts/invalid/expired coupons; not executed here.
- [PARTIALLY IMPLEMENTED] Test tax rounding/currency precision; not executed here.
- [NOT IMPLEMENTED] Test frontend amount manipulation against live PHP route.
- [NOT IMPLEMENTED] Test forged provider order IDs.
- [PARTIALLY IMPLEMENTED] Provider amount/currency checks exist; mismatch integration tests are absent.
- [NOT IMPLEMENTED] Test invalid payment signatures.
- [NOT IMPLEMENTED] Test invalid webhook signatures.
- [NOT IMPLEMENTED] Test duplicate webhook delivery.
- [NOT IMPLEMENTED] Test out-of-order webhooks.
- [PARTIALLY IMPLEMENTED] Existing Node state tests pass; PHP provider state tests are absent/unrun.
- [NOT IMPLEMENTED] Test browser refresh during payment.
- [NOT IMPLEMENTED] Test provider timeout/retry behavior.
- [NOT IMPLEMENTED] Test concurrent checkout submissions.
- [NOT IMPLEMENTED] Test duplicate capture/registration prevention.
- [NOT IMPLEMENTED] Test refunds/reconciliation.
- [BLOCKED] Run provider sandbox end-to-end tests; no credentials/account access.
- [IMPLEMENTED — NOT YET VERIFIED] Review application/PHP/database logs after isolated tests; production logs unavailable.

## 11. Hosting and production deployment (17)

Evidence/files: `README.md`, `docs/PRODUCTION_DEPLOYMENT.md`, `.env.example`, router and PHP entry points. Tests: no host access. Action: complete and sign off each host-specific item before live keys.

- [BLOCKED] Confirm production PHP version and required extensions.
- [BLOCKED] Confirm PDO MySQL driver is enabled.
- [BLOCKED] Confirm production database connection is MySQL.
- [IMPLEMENTED — NOT YET VERIFIED] Confirm PHP configuration is production-safe.
- [BLOCKED] Confirm public web root exposes only intended files.
- [IMPLEMENTED — NOT YET VERIFIED] Protect backend source/vendor/environment files according to deployment guide.
- [BLOCKED] Configure PayPal production webhook URL.
- [BLOCKED] Configure Razorpay production webhook URL.
- [BLOCKED] Configure and test correct live webhook secrets.
- [BLOCKED] Configure allowed production return/cancel URLs.
- [BLOCKED] Confirm HTTPS certificates are valid.
- [BLOCKED] Confirm DNS and domain routing.
- [NOT APPLICABLE] Scheduled jobs are not currently implemented; if introduced, configure them.
- [BLOCKED] Confirm backups and recovery procedures.
- [BLOCKED] Confirm monitoring/error alerting.
- [IMPLEMENTED — NOT YET VERIFIED] Confirm deployment rollback procedure.
- [BLOCKED] Confirm no sandbox credentials are used in production.

## 12. Live credentials and final authorization (13)

Evidence/files: `.env.example`, `docs/PRODUCTION_DEPLOYMENT.md`, provider enablement checks. Tests: no credentials requested or used; no live payment initiated. Action: merchant owner configures secrets privately only after all blockers are closed.

- [BLOCKED] Obtain PayPal live client ID and secret securely.
- [BLOCKED] Obtain Razorpay live key ID and secret securely.
- [IMPLEMENTED — NOT YET VERIFIED] Configure live credentials only in production secret storage.
- [BLOCKED] Verify PayPal merchant account and receiving currency.
- [BLOCKED] Verify Razorpay merchant KYC and settlement configuration.
- [BLOCKED] Confirm payment methods and currencies are enabled on provider accounts.
- [BLOCKED] Confirm provider webhook subscriptions are active.
- [BLOCKED] Run a controlled low-value live transaction only after explicit authorization.
- [BLOCKED] Verify provider dashboard transaction against internal database.
- [BLOCKED] Verify user receives correct verified confirmation.
- [BLOCKED] Verify refund procedure using provider-approved testing.
- [NEEDS FIX] Resolve all critical/high lifecycle and persistence blockers.
- [BLOCKED] Obtain explicit business-owner approval before accepting public payments.
