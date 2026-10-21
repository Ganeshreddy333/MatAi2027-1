# MatAi 2027 application quality audit

**Audit date:** 2026-10-20  
**Decision:** **NO-GO for production launch**  
**Provisional score:** **46/100 (4.6/10)**. This is an evidence-limited engineering score, not a certification. Payment and recovery release gates fail independently of the aggregate score.

## Executive summary

The inspected application is a static HTML/CSS/vanilla-JavaScript conference site with a PHP 8.2+ API using PDO and MySQL (or private JSON storage when MySQL is not configured). A separate legacy Node/Express backend remains in the repository. The available configuration does not establish that both backends should be run together; current project documentation warns against running them as simultaneous writers.

Local code-quality checks are green: Composer/PHP tests, PHPStan, Node unit tests, PHP and JavaScript syntax checks, and dependency audits passed. All 13 public/admin HTML routes loaded locally. Public pages were checked at the integrated browser's available 312 px viewport: no horizontal overflow, settled broken images, visible unlabeled form inputs, duplicate IDs, or JavaScript page errors were found after the accessibility edits in this pass.

These results do **not** validate end-to-end registration persistence, abstract uploads, payment provider behavior, SMTP, production HTTPS, authorized admin operations, load capacity, backup restoration, or deployment rollback. Stripe, PayPal, and Razorpay were all disabled in local checkout configuration. The principal release blockers remain the absence of a durable payment/event ledger, checkout idempotency, event deduplication, reconciliation, refunds/disputes, and a retryable email outbox. Do not enable live payments on the basis of these local tests.

## Architecture and feature inventory

| Area | Observed implementation | Verification limit |
| --- | --- | --- |
| Frontend | 12 public HTML pages plus `frontend/admin.html`; vanilla JavaScript, custom CSS, Bootstrap CSS via CDN. | Browser route/render smoke only; no full visual reference comparison or screen-reader certification. |
| Primary API | PHP 8.2+, Composer, PDO, `backend/src/Application.php`, routed through `frontend/api.php` and `backend/php/router.php`. | Local endpoints tested; no staging/production runtime. |
| Alternate API | Legacy Express backend in `backend/server.js`, separate storage and duplicated provider flows. | Not launched in this test pass; do not run both as concurrent writers without a documented shared persistence strategy. |
| Database | MySQL through PDO, with JSON fallback when MySQL is absent; base migration at `backend/migrations/001_initial.sql`. | No DB writes or migrations in this audit pass. Earlier local DB migration evidence is documented in `docs/production-readiness.md`; it is not production evidence. |
| Registration | Server-side input validation, fee calculation in integer cents, fixed 5% tax, coupon validation, and EUR totals in `RegistrationService`. | Unit-tested; browser-to-database and concurrent registration journeys not exercised. |
| Abstracts | Form submission and private PDF/DOC/DOCX upload handling; authenticated admin download path in PHP. | No new upload, unauthorized file access, or storage lifecycle test. |
| Payments | PHP/Node Stripe, PayPal, Razorpay code; hosted/provider checkout; callbacks/status checks; Stripe and Razorpay webhooks. | No provider was enabled; no sandbox transaction, signature test, reconciliation, refund, or dispute run. |
| Email | PHPMailer sends synchronous general submission notifications when configured. | SMTP and retries not tested; no durable outbox/receipt lifecycle. |
| Admin | Session-protected PHP admin API, content/pricing/submission management, CSV export, and evidence-based pending bank-transfer status updates. | Anonymous API denial tested; authenticated mutation, export correctness, full audit trail, MFA, pagination/search, and transaction operations not tested or not implemented. |

Public pages checked: `index.html`, `about.html`, `committee.html`, `speakers.html`, `abstract-submission.html`, `sessions.html`, `venue.html`, `information.html`, `sponsors.html`, `registration.html`, `contact.html`, `brochure.html`, and `admin.html`.

## Baseline versus final evidence

| Measure | Baseline before current accessibility edits | Final result for this pass |
| --- | --- | --- |
| PHP/Node automated tests | 4 PHP tests / 11 assertions and 5 Node tests passed. | Same: `composer check` and `npm test` passed. |
| Static analysis / dependency audit | PHPStan clean; Composer and npm dependency audits not yet run in this pass. | PHPStan clean; `composer audit` reported no advisories; `npm audit --omit=dev` reported 0 vulnerabilities. |
| Local HTML pages | All 13 public/admin routes returned HTTP 200. | All 13 returned HTTP 200 in the browser route smoke. |
| Browser page errors/images/overflow | 0 page errors and no horizontal overflow at available viewport; one image had not completed on an early scan, then loaded on later scan. | On the 12 public pages: 0 page errors, 0 settled broken images, and no horizontal overflow at 312 px. Admin route returned 200, but its interaction/accessibility scan was excluded because the shared browser appeared to carry an authenticated session. |
| Public form accessible names | Inputs had missing programmatic label associations on registration, abstract, contact, and brochure pages. Registration also had a duplicate `registration-details` ID. | 0 visible unlabeled controls and 0 duplicate IDs across the checked pages after linking labels and removing the redundant anchor. |
| Local response timing | No baseline sample. | 12 sequential localhost HTML fetch samples: home p50/p95 7.8/64.8 ms; registration 3.1/36.3 ms; abstract 3.0/4.7 ms; admin 3.7/7.3 ms. Informational only, not a load/hosting benchmark. |
| Providers | No test transactions. | All three provider methods disabled locally; no provider API or sandbox calls. |

The integrated browser screenshot showed the local registration page at a narrow mobile viewport. It was not saved as a repository artifact and is not a comparable reference/redesign screenshot set. Desktop visual matching and Core Web Vitals are **Not Verified**. Full scenario results are in [acceptance-test-results.md](./acceptance-test-results.md).

## Weighted quality scorecard

| Dimension | Max | Earned | Acceptance criteria and evidence | Remaining defects / next steps |
| --- | ---: | ---: | --- | --- |
| Functional correctness and workflows | 20 | 12 | All 13 local routes returned 200; server-side registration pricing/coupon tests passed; anonymous protected admin API returned 401. | Test real browser-to-storage registration, abstract/file workflow, authorized admin mutations, exports, duplicate/concurrent submission behavior, and notifications on isolated services. |
| Security and privacy | 20 | 11 | PHP uses hashed password verification, CSRF checks, rate limiting, prepared statements, generic errors, and restrictive session-cookie attributes by code inspection; the legacy Node runtime now uses scrypt password hashes, CSRF middleware, session rotation, and HTTPS-aware secure cookies with focused unit tests; dependency audits clean. | Node login/session and protected-route integration, production HTTPS, CSP, privacy/retention, MFA, OWASP ASVS, secret-scan, and production configuration remain unverified. |
| Payment correctness and financial integrity | 15 | 3 | Server-side amount calculation and EUR-only PHP Razorpay configuration have unit coverage; a Node regression test protects a `Paid` state against stale failure/cancel transitions. | No sandbox provider test, immutable payment ledger, checkout idempotency, webhook event deduplication, reconciliation, receipt/outbox, refund, dispute, or chargeback workflow. |
| Reliability, data integrity, and recovery | 15 | 5 | PHP Store uses transactions and locking for record mutations; no database writes occurred during this pass. | No concurrency/outage/restart recovery test, backup/restore evidence, durable payment/email jobs, or provider/database ambiguity reconciliation. |
| Performance and scalability | 10 | 3 | Bounded localhost fetch timing samples were recorded. | No representative hosting benchmark, load test, resource/DB telemetry, bundle audit, real-user Web Vitals, or agreed SLO. Local samples cannot establish capacity. |
| Accessibility and user experience | 10 | 7 | Public forms' labels were associated; browser route smoke found no visible unlabeled controls, duplicate IDs, settled broken images, page errors, or mobile horizontal overflow on the 12 public pages at 312 px. | No screen-reader/manual keyboard/contrast/reduced-motion/WCAG 2.2 AA evaluation; no desktop/tablet check at comparable target viewports; admin UI scan and workflows were not tested because the shared browser appeared authenticated. |
| Maintainability, tests, and code quality | 5 | 4 | 4 PHP tests / 11 assertions, 5 Node tests, PHPStan clean, JS/PHP syntax checks passed; Composer/npm audit clean. | Limited coverage relative to duplicated runtimes and workflow size; CI runtime matrix not run; no integration/E2E/contract/concurrency suites. |
| Deployment and operations | 5 | 1 | Local PHP API and health-related routes available; production readiness documentation lists controls and blockers. | No staging/production review, live HTTPS, monitoring/alerting, least-privilege DB proof, backup/restore, runbook exercise, or rollback evidence. |
| **Total** | **100** | **46** | **46/100 = 4.6/10** | **Provisional; not a release approval.** |

Scoring is intentionally conservative: untested behavior earns no full credit solely because implementation code exists. The total does not waive mandatory release gates.

## Defect register

| ID | Severity | Status | Affected area / evidence | Reproduction or expected behavior | Required remediation and regression evidence |
| --- | --- | --- | --- | --- | --- |
| Q-001 | Critical | Open | Payment persistence/schema; `backend/migrations/001_initial.sql`, PHP/Node webhook handlers. No immutable transaction ledger or durable event-ID deduplication. | Duplicate/replayed events should resolve to one durable payment/fulfillment and preserve a complete transaction history. | Add reviewed additive payment/event/outbox schema with unique provider transaction/event IDs; test duplicates, ordering, transactions, and migrations on an isolated database. |
| Q-002 | High | Open | Checkout order creation in `backend/src/Application.php` and `backend/server.js`. Requests can create new provider orders/references without logical checkout idempotency. | Two tabs/retries should not create unintended payable orders or duplicate charges for one registration. | Persist an internal order/idempotency key before provider creation; use provider idempotency APIs; test concurrent attempts and ambiguous timeout recovery. |
| Q-003 | High | Open | Provider/database boundaries in PHP/Node. A provider may accept a charge before local persistence succeeds; no reconciliation worker recovers it. | After a DB outage/restart, an accepted payment should be reconciled to its original internal order. | Add durable pending state and verified bounded reconciliation with operator queue; test provider accepted + DB failure and provider outage cases. |
| Q-004 | High | Open | No supported refunds, partial refunds, disputes, reversals, or chargeback lifecycle. | Financial records should reflect provider-confirmed partial/full refund or dispute state and alert authorized operators. | Implement provider-specific supported events and actions, immutable transactions, authorization, audit trail, and sandbox tests. |
| Q-005 | High | Open | `backend/src/NotificationService.php`; general synchronous submission notification. No durable payment receipt outbox/retry state. | Successful payment must remain successful if email fails, with safe idempotent delivery retry. | Add transactional outbox and separate payment/email states; test SMTP unavailable/retry/duplicate event. |
| Q-006 | High | Remediated (unit-tested; integration unverified) | Legacy Express authentication in `backend/server.js`. Plaintext password comparison has been replaced by `NODE_ADMIN_PASSWORD_HASH` using Node scrypt; unsafe methods require a session CSRF token; login rotates the session; production requires an HTTPS public URL and uses `Secure` cookies. | If this server is deployed, it must provide hashed authentication, CSRF defense, session-fixation protection, and HTTPS-only cookies. | Added focused tests for password hash verification, CSRF middleware, token comparison, and cookie attributes. Still verify configured Node login, protected route behavior, expiry/logout, and a real production HTTPS response before exposure. |
| Q-007 | High | Open | Provider enablement/configuration in PHP checkout config. Credential presence alone enables UI selection; no sandbox/dashboard readiness check is evidenced. PayPal has no webhook reconciliation path. | A method should not be offered until its mode, merchant account, webhook, currency, and recovery path are verified. | Add explicit environment activation and provider readiness runbooks/tests; provide sandbox evidence for every enabled provider. |
| Q-008 | High | Open | Production operations: `docs/production-readiness.md`. No backup/restore, alerting, staging, production configuration or rollback evidence. | Release requires a protected backup and successful isolated restore and an exercised rollback/recovery plan. | Configure owned operational controls and attach evidence before release. |
| Q-009 | Medium | Remediated in this pass | `frontend/registration.html`, `frontend/abstract-submission.html`, `frontend/contact.html`, `frontend/brochure.html`. Visible form labels previously lacked `for`/control association; registration had duplicate anchor ID. | Browser should expose visible input names and unique in-page IDs. | Added explicit label associations and removed redundant anchor; browser scan passed all public pages for visible unlabeled controls and duplicate IDs. |
| Q-010 | Medium | Remediated in preceding payment-audit pass | Legacy Node payment status transitions in `backend/server.js`. Delayed failure/cancel could overwrite `Paid`. | Captured status should not be downgraded by stale failure/cancel. | Added `applyVerifiedPaymentStatus` and 5 Node unit tests; all pass. Provider webhook integration remains unverified. |
| Q-011 | Medium | Open | Admin operations in `backend/src/Application.php` and `frontend/admin.html`. No full transaction timeline, provider/currency reporting, reconciliation queue, search/pagination or full audit trail. | Admin totals/actions should match authoritative financial records with attribution and currency separation. | Build authorized ledger-backed reports/queues, record all admin actions, and test against synthetic records. |
| Q-012 | Medium | Open | Visual/performance/accessibility evidence is incomplete. | Desktop/tablet/mobile visual evidence, representative performance, and WCAG checks should support release. | Save comparable screenshots; run automated and manual accessibility checks; establish staging performance targets and controlled measurements. |
| Q-013 | Medium | Open | Multiple PHP and Node backend implementations. | One documented writer should own authoritative registration/payment persistence. | Select and enforce the production runtime; define data ownership and migration/deprecation plan for the other backend. |

## Security review and coverage

The dedicated security-review task reported: **“No security vulnerabilities found in the reviewed changes.”** This is limited reviewer output, not penetration-test evidence and not a claim of complete security certification. The implementation inspection also identified the legacy-runtime controls listed in Q-006. Do not expose that runtime publicly until those controls are resolved and retested.

Observed PHP controls include `password_verify`, session ID rotation, HttpOnly/SameSite=Strict cookies, HTTPS-aware Secure-cookie configuration, CSRF verification, failed-login and request rate limits, authenticated admin routes, prepared PDO statements, upload signature/size checks, and generic request errors. Local tests verified only selected public endpoints and anonymous admin denial; control presence is not equivalent to exploit-resistant end-to-end testing.

## Payment provider matrix

| Provider | Checkout in local config | Evidence obtained | Status |
| --- | --- | --- | --- |
| Stripe | Disabled | No checkout/API/webhook call. Code uses hosted Checkout, provider status lookup, and signed webhooks. | Sandbox and production readiness Not Verified; no event ledger/reconciliation. |
| PayPal | Disabled | No Orders API or capture call. Browser return path performs server-side order/capture lookup in code. | Sandbox and production readiness Not Verified; no webhook/reconciliation path. |
| Razorpay | Disabled | No order/payment/webhook call. PHP now refuses checkout unless configured currency is EUR; unit tested. | Sandbox and production readiness Not Verified; no event ledger/reconciliation/refunds. |

No provider documentation/dashboard configuration, webhook reachability, merchant capability, test/live credential separation, charge, or refund was validated in this pass.

## Database, recovery, deployment, and manual prerequisites

- **Database changes in this pass:** none. No migration was added or executed; no database records were modified.
- **Schema:** current base migration defines submissions, locks, content, login/rate-limit storage, and migration tracking. It lacks payment transaction and webhook-event tables.
- **Backup/restore:** Not Verified. A prior local migration/database verification is not backup or restore evidence.
- **Production configuration:** Not Verified. No production/staging URL, HTTPS response, provider dashboard, SMTP, monitoring, or least-privilege account was inspected.
- **Manual work before retest:** choose one authoritative backend; establish isolated staging and provider sandbox credentials; configure HTTPS/webhooks/SMTP; approve data retention and privacy/legal procedures; configure backup and perform isolated restore; add monitoring/alerts; provide operator approval for destructive or live tests (not requested or performed here).
- **Rollback:** use an owner-approved deployment rollback or forward-recovery plan after an isolated backup; do not attempt to reverse production migration based on local evidence. No deployment was performed.

## Changed files in this audit sequence

Payment and audit work from this session:

- `backend/src/Application.php`
- `backend/src/PaymentConfiguration.php`
- `backend/payment-status.js`
- `backend/server.js`
- `frontend/registration.html`
- `frontend/abstract-submission.html`
- `frontend/contact.html`
- `frontend/brochure.html`
- `tests/PaymentConfigurationTest.php`
- `tests/payment-status.test.js`
- `package.json`
- `.env.example` (EUR-only example retained)
- `docs/payment-gateway-audit.md`
- `docs/acceptance-test-results.md`
- `docs/production-readiness.md`
- `docs/quality-audit-report.md`

Other existing worktree modifications were present before this audit pass and were not reverted or attributed to it. No migration files were changed in this pass.

## Reproduction commands

Run from repository root with PHP 8.2+, Composer, and Node.js 18+ installed:

```powershell
$php = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\PHP.PHP.8.2_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe'
$composer = Join-Path $env:LOCALAPPDATA 'MatAiToolchain\composer.phar'
$env:PATH = (Split-Path $php) + ';' + $env:PATH
& $php $composer check
npm test
& $php $composer audit
npm audit --omit=dev
node --check backend\server.js
node --check backend\payment-status.js
& $php -l backend\src\Application.php
git diff --check
```

The local route, viewport, accessibility-name, duplicate-ID, and response-time checks were run in the integrated browser and against `http://127.0.0.1:8001`; these were not added as repeatable automated E2E tests.

## Release gate and path to 10/10

**NO-GO.** Mandatory gates fail: payment idempotency and reconciliation are absent; critical payment history/deduplication and refund/dispute controls are absent; staging/provider configuration is unverified; and backup/restore evidence is absent.

To improve the score safely:

1. Select the sole production backend and disable any unmaintained alternate writer.
2. Design and review the payment ledger, internal order idempotency, provider event deduplication, state machine, outbox, reconciliation, and refund/dispute schemas before implementation.
3. Add deterministic provider adapter contract tests, webhook replay/order tests, two-tab/concurrency tests, and DB/provider failure recovery tests.
4. Run each provider's current sandbox flows, including mismatch, authorization/capture, delayed/duplicate events, refunds, and webhooks; never use live credentials for these tests.
5. Configure staging HTTPS, least-privilege database access, SMTP, monitoring/alerts, backup and isolated restore; collect operator evidence.
6. Run authorized end-to-end admin/public workflows, private-file tests, accessibility checks including keyboard/screen reader/contrast, and controlled staging load tests.
7. Record comparable desktop/mobile screenshots, LCP/INP/CLS with their measurement context, and production-like p50/p95/p99 endpoint and error-rate data.
8. Re-run the full matrix, resolve all Critical/High defects, review final diff and secrets scan, then recalculate the score from evidence.

Until those conditions are met, **46/100 is provisional, production readiness is not demonstrated, and a GO recommendation is not justified.**
