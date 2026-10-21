# MatAi 2027 implementation checklist

This checklist reflects source inspection and checks run in the current Windows workspace. It is not a production-readiness or security certification. Database changes were applied only after the owner confirmed the target was dedicated non-production; never run migrations automatically against production.

## Phase A — Audit

- [x] Confirmed the public site is static HTML/CSS/JavaScript with a PHP 8.2+ API using PDO and MySQL as the documented primary runtime.
- [x] Identified `backend/server.js` as a separate legacy Express/MySQL backend. Do not run both backends as writers to the same data store.
- [x] Inspected the Composer and npm scripts, PHP entry points, migration, services, admin UI, tests, `.env.example`, README, and worktree status.
- [x] Preserved the pre-existing modified and untracked files.
- [x] Confirmed `.env` is not tracked by Git; secret values were not included in this audit.
- [x] Captured the approved test database baseline before migration: `matai_2027` existed and had zero tables.
- [ ] Establish a tested file/database backup and rollback path before data migrations.

## Phase B — Reliable local execution

- [x] Installed user-scoped PHP 8.2.33 with `pdo_mysql`, `curl`, `fileinfo`, `json`, `mbstring`, `openssl`, and `zip`; installed Composer 2.10.3 after validating its published installer signature.
- [x] Added the Composer MIT license declaration consistent with the existing npm manifest; generated `composer.lock` and installed dependencies.
- [x] Owner confirmed `matai_2027` is dedicated non-production and authorized its additive initial migration.
- [x] Set `APP_ENV=local` in the private `.env`, preserving all existing credential values.
- [x] The configured PHP/PDO application connected to MySQL 8.0.45; its real `/api/content` and `/api/csrf` endpoints passed smoke checks.
- [x] Applied the additive migration; verified six expected tables, two migration markers, 12 imported submissions and one site-content row. Legacy JSON files were left intact.
- [x] Re-ran migration and verified it did not duplicate imports or migration markers.
- [x] Existing configured database account is privileged/root. It was used only for this confirmed local test database; create a dedicated least-privilege application account before staging or production use.
- [x] Verified admin authorization, validation, login/session and empty dashboard using a separate temporary JSON-mode copy; no test admin credentials or records were added to the configured database.

## Phase C — Registration, abstract, and uploads

- [x] Existing PHP code validates required public fields and email; registration totals are computed from saved pricing.
- [x] Existing abstract upload path enforces extension, size, file-signature, generated-name, and private-storage checks.
- [x] PHPUnit registration pricing/coupon/email validation tests pass using temporary JSON fixtures; isolated HTTP validation check rejects a registration without accepted terms.
- [x] Verified imported legacy records match the source JSON structures by reference and content; exact counts are 5 registrations, 2 abstracts, 3 contacts and 2 brochure requests.
- [ ] Test a new successful application registration/abstract submission and upload against an isolated database, including duplicates and retries.
- [ ] Add a durable registration idempotency key and validate duplicate/retry behavior end to end.
- [ ] Add verifiable server-side human verification before enabling public submissions. Current API source does not validate a CAPTCHA/human-challenge proof; do not treat the browser-only challenge as a security boundary.
- [ ] Add database-backed pagination and filters for admin submission views/exports where appropriate.

## Phase D — Payments and email

- [x] Existing PHP routes include Stripe, PayPal, and Razorpay order/verification paths and signed webhook checks; browser redirects alone do not establish payment success.
- [ ] Add durable payment records and provider-event IDs so webhook retries, out-of-order events, reconciliation, and status history are handled idempotently.
- [ ] Test provider sandbox success, failure, cancellation, amount/currency mismatch, duplicate callback, and webhook retry scenarios.
- [ ] Verify no manual admin action can represent a provider-confirmed payment without the existing bank-transfer evidence workflow.
- [ ] Add a durable notification outbox/retry state and tests for delivery failure without duplicate business operations.
- [ ] Configure and test SMTP with an authorized test mailbox; no SMTP delivery was verified.

## Phase E — Administrator application

- [x] Existing admin UI supports website content, pages, speakers, pricing/settings, submissions, basic stats, and CSV export.
- [x] Admin session/API paths enforce server-side authentication; state-changing requests use CSRF validation.
- [x] Removed the hardcoded admin email from the top bar; the authenticated account name is now supplied by the session endpoint and rendered as text.
- [x] Isolated HTTP smoke checks confirmed unauthenticated admin stats return HTTP 401 and test-only login/session identity works.
- [ ] Implement only the additional modules backed by approved schema and real APIs: review assignments/history, payments/reconciliation, notification status, roles/users, and audit events.
- [ ] Add date/status/category filters, pagination, multi-currency-aware revenue summaries, and dashboard trend data from real queries.
- [ ] Verify authorization independently for every admin action and export.

## Phase F — Public website

- [x] Prior redesign pass inspected all 12 public pages at desktop/mobile sizes and checked navigation, layout overflow, page errors, and form-preview behavior.
- [ ] Repeat visual comparison with a matching browser scale/device-pixel ratio; the prior reference desktop capture was clipped, so no exact desktop comparison is claimed.
- [x] Rechecked the database-backed PHP application's public content and CSRF endpoints.
- [ ] Recheck public links, downloads, real form persistence and uploads against the PHP application.

## Phase G — Tests and integrity verification

- [x] `composer validate --strict` passed.
- [x] `composer test` passed: 3 tests, 6 assertions.
- [x] `composer analyse`/PHPStan passed with no errors after using 512 MB CLI memory.
- [x] PHP syntax checks passed for 12 files; JavaScript syntax passed for 8 files; `git diff --check` passed.
- [x] `composer audit` reported no security vulnerability advisories.
- [x] Isolated JSON-mode API checks passed for public endpoints, CSRF/session, unauthorized denial, invalid registration, and empty dashboard stats.
- [x] Migration and import integrity verified: baseline zero tables; after migration six tables, migration markers `001_initial` and `legacy-json-v1`, 12 submissions (5 register / 2 abstract / 3 contact / 2 brochure), and one content row. Imported source data matched and migration rerun added no duplicates.
- [x] Database-backed `/api/content` and `/api/csrf` smoke checks passed.
- [ ] Add/run new-submission persistence, upload, payment, email and full end-to-end tests.
- [ ] Do not report end-to-end, backend, provider, email, or database scenarios as passed until actually run.

## Phase H — Deployment readiness

- [x] README and `docs/production-readiness.md` contain setup, environment, migration, payment/email, backup, rollback, and deployment guidance.
- [ ] Validate deployment instructions on a staging environment and test backup restore/rollback.
- [ ] Resolve remaining launch blockers listed in `docs/production-readiness.md`, including staging evidence, monitoring/backup, payment ledger/idempotency, admin audit/MFA decision, CSP, and privacy/legal review.

## Current environment blockers and next actions

1. Create a dedicated least-privilege MySQL account scoped to `matai_2027` and update the private `.env` to use it; the current account is privileged/root. Never use this local account for production.
2. Configure server-verifiable human verification; the current browser challenge is not verified by the backend API.
3. Run new registration/abstract/upload persistence tests and provider sandbox/email tests using isolated test data and authorized sandbox/test-mailbox credentials.
4. Complete staging deployment, backup/restore, CSP, admin audit/MFA, and privacy/legal reviews before production.

No live payment or email operation was performed. The temporary PHP test server and copied application tree were stopped and removed.
