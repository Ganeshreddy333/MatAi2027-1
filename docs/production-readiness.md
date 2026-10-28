# Production operations and release readiness

This document describes intended controls and operational work that must be completed by the service owner and hosting operator. Code or documentation in this repository is not evidence that a control has been configured, tested, or accepted in staging or production.

## Launch decision

**Do not launch with real submissions or live payments until every Critical and High item below has an owner, evidence, and an explicit disposition.** The current repository does not contain hosting credentials, an approved backup schedule, a staging URL, payment sandbox evidence, or a tested restore.

The local pre-launch acceptance checks run on 2026-10-20 are recorded in [acceptance-test-results.md](./acceptance-test-results.md). Online providers were disabled in that environment; no sandbox transaction or production control was verified.

| Severity | Outstanding item | Evidence required before launch |
| --- | --- | --- |
| Critical | Payment ledger, provider-event deduplication, idempotent order creation, and supported refund/dispute/reconciliation workflow are not implemented as a durable financial subsystem. | Implement and test provider sandbox cases including retries, duplicate/out-of-order events, amount/currency mismatch, refund, and reconciliation. |
| Critical | No automated/off-host backup, retention, encryption, or restore test is configured by this repository. | Hosting-owner approval of schedule/RPO/RTO; evidence of protected database and file backups and a successful isolated restore. |
| High | No staging environment or production configuration verification is available. | Deploy a staging release and record smoke-test evidence without exposing secrets. |
| High | No central alerting, uptime/resource monitoring, or log-retention/access policy is configured. | Configure provider/monitoring alerts and test their delivery and acknowledgement procedure. |
| High | Admin authentication has no MFA, individual accounts, or complete audit trail for administrative changes. | Add suitable MFA/individual identity and auditable administrative actions, or approve a documented compensating control before granting access to production personal/payment data. |
| High | A production Content Security Policy has not been enabled: inline scripts/styles and payment integrations require an inventory and staged compatibility testing first. | Define and validate an enforced CSP in staging; do not treat report-only mode as enforcement. |
| High | No real security assessment or OWASP ASVS verification has been completed. | Complete a scoped security review/assessment and track findings; this document is not a penetration-test report. |
| High | Privacy text, retention periods, data-subject procedures, controller/processor roles, and applicable legal obligations require owner and legal review. | Approve accurate privacy/terms notices and operational retention/access/deletion procedures for the actual hosting and provider setup. |
| Medium | Admin submission listing loads complete datasets; there is no database-backed pagination or realistic load baseline. | Measure expected volume and add pagination/indexes if observed or forecast data volumes require it. |
| Medium | No staging smoke-test job, provider sandbox test suite, or measured performance baseline is configured. | Add controlled staging credentials and automated/manual smoke checks; record response-time/error-rate baselines. |
| Low | No canonical production origin, sitemap, or production robots policy has been approved. | Confirm the canonical domain and URL inventory before publishing crawler metadata; keep admin/API paths excluded. |

## Environment variable reference

Set secrets in a private environment/secrets manager; `.env.example` contains placeholders only. Do not echo effective secret values in release logs.

| Variables | Purpose / requirements |
| --- | --- |
| `APP_ENV`, `APP_URL`, `LOG_LEVEL` | Runtime environment label, canonical public base URL required for checkout, and hosting log threshold. Verify the URL and HTTPS in each environment. |
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` | Leave all connection values blank only for local JSON mode. If configured, provide a least-privilege account and all required values. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` | Unique admin identity and a PHP `password_hash()` value. The app has no password reset; rotate through a controlled operator procedure. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_ENCRYPTION`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_ADDRESS`, `SMTP_FROM_NAME`, `ADMIN_NOTIFICATION_EMAIL` | Optional outbound mail. Use `tls` or `ssl`, verified sender/domain, and a test mailbox in staging. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_EUR_CHECKOUT_VERIFIED` | Stripe API and signed webhook secrets. EUR checkout stays disabled until the exact merchant account/environment has passed EUR sandbox checkout and webhook verification; set the verification flag to `true` only after that evidence exists. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE`, `PAYPAL_EUR_CHECKOUT_VERIFIED` | PayPal credentials and `sandbox`/live mode. EUR checkout stays disabled until the configured merchant account/environment has passed EUR order, capture, and currency/amount verification. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_CURRENCY`, `RAZORPAY_EUR_CHECKOUT_VERIFIED` | Razorpay keys and webhook secret. This pricing model creates EUR orders only; checkout is disabled unless `RAZORPAY_CURRENCY=EUR` and EUR checkout has been verified for that merchant account. |

The registration form prices in canonical EUR. USD and GBP selections are not charge currencies: the attendee must explicitly confirm a switch to EUR, and the form recalculates/displays the EUR payable amount before checkout. No exchange rate or conversion fee is applied. Backend order creation rejects any non-EUR transaction currency, and provider verification compares the received currency and amount to the stored registration. Missing verification flags fail closed and keep online checkout disabled. No provider account is treated as verified merely because credentials are present.

Currency enforcement verification for this branch: the Node test suite passes (14 tests), and PHP syntax checks plus direct PHP checks of fallback confirmation, calculated totals, provider readiness, and amount/currency matching pass. PHPUnit could not be run because Composer and `vendor/` are not installed in this environment. No provider sandbox transaction has been performed; leave all EUR verification flags false until the configured merchant account is actually tested.

The PHP configuration currently reads these variables. Validate required PHP extensions, Apache rewrite/header support, upload/post size limits, `APP_URL`, HTTPS proxy behavior, and writable private directories separately on each host. A configuration check must report presence/validity only, never print secret contents.

## Local verification update — 2026-10-20

The current Windows development environment has PHP 8.2.33 and Composer 2.10.3. A `composer.lock` was generated, Composer validation and audit passed with no advisories, PHPUnit passed (4 tests, 11 assertions), PHPStan reported no errors, and PHP syntax checks passed for the inspected backend/test files. The GitHub Actions matrix has not been run.

The owner confirmed `matai_2027` is a dedicated non-production database. Before migration it had zero tables. The additive migration was applied with `APP_ENV=local`; verification found six tables, both expected migration markers, 12 imported legacy submissions (5 registrations, 2 abstracts, 3 contacts, 2 brochure requests), and one site-content record. The imported records/content matched the JSON source; rerunning the migration did not duplicate them. The source JSON files remain intact. A database-backed public content/CSRF smoke check passed.

No live payment, SMTP delivery, new form persistence, file-upload integration, migration against production, or deployment was tested. The local environment was configured with a privileged MySQL account; replace it with a least-privilege application account before staging/production use. The database baseline/verification is not a backup or restore test.

## Database schema and migration guide

The additive schema is in `backend/migrations/001_initial.sql` and `backend/migrations/002_currency_audit.sql`. Both the PHP migration runner and Node setup apply them idempotently under a database advisory lock and import legacy JSON once using migration marker `legacy-json-v1`. The currency migration adds normalized amount, preferred, and transaction currency columns and backfills only values evidenced by existing JSON fields; unknown historical transaction currencies remain null. New writes synchronize the normalized fields with `record_json`. MySQL DDL is not transactionally reversible; a failed DDL run may leave additive columns in place, so retry only after reviewing logs and confirming the target.

Review SQL and backups before a production migration. Use an isolated database for automated migration tests; CI applies the migration twice to ephemeral MySQL. This checks basic repeatability but does not prove compatibility with a live legacy schema/data set. There is no automatic migration at web request startup and no destructive rollback migration. Schema changes must be additive/forward-only unless a separately reviewed data migration and recovery plan says otherwise.

## Local currency migration verification — 2026-10-28

The approved local non-production database `matai_2027` was verified before migration. Migration markers `001_initial`, `legacy-json-v1`, and `002_currency_audit` are present; the three currency audit columns exist. Submission counts remain 5 registrations, 2 abstracts, 3 contacts, and 2 brochure requests, with one site-content row. Temporary test registrations written through both Node and PHP storage round-tripped amount and currency metadata through the normalized columns and JSON, then were removed; a final check found no test rows.

The existing five registrations have no `Paid` status. Their historical transaction-currency evidence is incomplete, so the migration leaves unknown amount/transaction currencies null rather than treating a preference or canonical price as proof of the actual currency. No provider sandbox credentials or explicit EUR verification flags are configured, and no sandbox order/capture was attempted. The local Express server was restarted at `http://localhost:3000`; no production schema change, production deployment, or real charge was performed.

Validation on this date: Node tests passed (14/14); changed JavaScript and PHP files passed syntax checks; direct PHP integration verified migration idempotency and PHP storage; browser verification confirmed the unsupported-currency dialog shows the recalculated EUR amount and stores the original preference plus explicit confirmation. PHPUnit/PHPStan could not run because Composer and `vendor/` are not installed.

## Backup, restore, and disaster recovery

### Approval and targets

Before configuring jobs, the service owner must approve recovery point objective (RPO), recovery time objective (RTO), retention, encryption/key ownership, access roles, and deletion rules. Suggested starting targets for owner discussion—not configured commitments—are daily backups, 30-day retention, RPO no greater than 24 hours, and RTO no greater than 8 hours. A tighter RPO requires more frequent backups and verification.

### Backup scope and handling

Back up the MySQL database and all persistent files: `backend/data/*.json` when JSON mode is used, `backend/data/uploads/`, `backend/data/images/`, and the private `.env`/deployment configuration needed for recovery (store secrets in an approved secrets manager, not in general-purpose backup archives). Include the deployed release and migration version in the recovery record. Do not expose backups under the document root.

Use the hosting provider's supported scheduled backup or a reviewed scheduler. Keep at least one encrypted, access-controlled copy outside the primary hosting failure domain where feasible. Restrict backup and encryption-key access to named operators; audit access, define key rotation/recovery, verify checksums, and securely expire copies under the approved retention schedule. Do not put database passwords in command-line arguments, repository files, or job output.

### Restore tests

At least quarterly and after a material backup-system change, restore a representative backup into an isolated non-production database and file area. Validate row counts and key references, inspect file readability/permissions, run application smoke tests, and record duration and discrepancies. Never use a production restore as a test. Do not overwrite production during an incident until the incident commander approves the target and a fresh backup is taken where possible.

### Recovery runbooks

- **Database corruption or accidental deletion:** declare an incident; stop writes or put the service in maintenance mode; preserve logs and the current database; select a known-good backup and point-in-time only if the provider supports it; restore into an isolated target; validate migrations, content, submission counts, payment references, and uploads; obtain owner approval before switching production; document data loss against the approved RPO.
- **Compromised credentials:** disable/revoke affected database, admin, SMTP, provider, and deployment credentials at their issuers; rotate dependent secrets; invalidate sessions; inspect authentication, payment, webhook, and deployment logs; assess data access and notification/legal obligations; restore only if integrity is in doubt.
- **Failed deployment:** stop rollout and disable affected write/payment flows; preserve logs and database state; roll back application code to the last known-good release only if schema compatibility is confirmed; do not run destructive/down migrations; reconcile submissions/payments accepted during the interval.
- **Application files lost:** restore the matching release, private configuration via the approved secrets process, JSON records if JSON mode is authoritative, and upload/image directories; verify permissions and references before reopening uploads/downloads.

## Monitoring, logs, and alerts

The PHP API emits JSON log entries to the configured PHP error log with UTC timestamp, severity, generated request ID, event name, and limited non-sensitive context. `LOG_LEVEL` supports `debug`, `info`, `notice`, `warning`, `error`, and `critical` (default `warning`). API responses expose the matching `X-Request-ID`; a generic server error includes that request ID. Exceptions are logged by class, not message, to reduce accidental secret/PII disclosure. PHP/API activity is not automatically shipped to a central system by this repository.

The authenticated `GET /admin/api/ops-status` endpoint checks a simple database query (or identifies JSON mode) and application data-directory writability. It does not disclose hostnames, credentials, paths, or provider status. It is not a substitute for external uptime checks, disk/CPU/memory/PHP-worker monitoring, SMTP delivery monitoring, payment reconciliation, or alerting.

Configure hosting/monitoring alerts for repeated HTTP 5xx/429 responses, unavailable API/database, low disk space, PHP worker/resource exhaustion, backup failure, repeated login throttling, webhook signature/processing failures, payment mismatch/pending age, and SMTP failure. Keep alert payloads free of secrets and unnecessary personal data. Define log retention and restricted access at the host/central logging service; test alert delivery and document who acknowledges, investigates, escalates, and closes an alert. Avoid retaining raw request bodies or payment credentials.

## Security model and verification

| Area | Existing control | Required verification / residual concern |
| --- | --- | --- |
| Authentication/session | Password hash verification, failed-login throttling, session ID rotation, HTTP-only/SameSite cookies, inactivity expiry, CSRF tokens. | Verify cookie `Secure` behind the real TLS proxy, expiry/logout, account recovery, authorization, and session fixation in staging. There is no password-reset/account-recovery flow; perform controlled operator credential rotation instead. |
| Authorization/admin | Admin API calls require an authenticated session; private abstract downloads require admin access. | Exercise every route for unauthenticated and cross-record access; verify server-side route guards after deployment. Single shared administrator identity limits attribution. |
| Payments | Server-side price calculation and provider verification/webhook signatures; browser redirects alone do not set paid. Admin UI/API prevent direct amount edits; a pending bank transfer can only be marked paid/cancelled with an attributed operator and evidence/reason. Payment-backed registrations cannot be deleted through the current admin endpoint. | No durable provider transaction ledger, event-ID dedupe, order idempotency, refund/dispute workflow, or reconciliation job. This is a production blocker for live payments. |
| Uploads | Size/type/signature checks, randomized names, private abstract download route, allowlisted public image types. | Verify PHP/web-server upload limits, malware handling policy, storage quotas, file authorization, and backup/restore on the host. |
| Database | PDO prepared statements, transactions, restrictive schema operations. | Run SQL injection, authorization/IDOR, XSS, CSRF, and migration tests against isolated fixtures; no such security test campaign has run. |
| HTTP | `nosniff`, frame restriction, referrer and permissions policies; HSTS on HTTPS through Apache headers. | Confirm the live host honors `.htaccess`/headers and TLS. CSP remains unconfigured pending inline/third-party script inventory and staging compatibility validation. |
| Dependencies/secrets | `.env` is excluded from Git and examples contain placeholders. | Commit the Composer lockfile; review Composer audit results; run secret scanning on current and historical repository data; rotate any exposed credentials. |

Use OWASP ASVS (select and record an appropriate verification level) as the checklist for security testing. Include SQL injection, stored/reflected XSS through editable content, CSRF, IDOR, broken access control, session fixation, privilege escalation, direct upload access, and payment tampering. Use test accounts, fake data, and provider sandboxes only. No penetration test or formal ASVS assessment is claimed.

Dependency maintenance: review automated dependency/security alerts weekly; evaluate security advisories promptly; update dependencies in a branch, review changelogs and `composer audit`, run tests/static analysis, deploy to staging, then promote with rollback readiness. Use Dependabot PRs as input, not automatic production deployment. Never paste secrets into CI logs or issue comments.

## Payment operations

Use provider dashboards and sandbox mode for all pre-launch tests. Never collect or store PAN/CVV or payment authentication data. Verify each internal registration against provider order/payment identifiers, exact expected amount and currency, final provider status, and reference. Browser redirects are informational only.

The application currently lacks a dedicated immutable transaction ledger and robust webhook event deduplication/order tracking. A webhook retry generally encounters an already-updated registration, but this is not a complete idempotency/reconciliation guarantee. Do not treat manual edits or a provider dashboard screenshot as a substitute for a ledger. Refunds, disputes, partial refunds, chargebacks, orphaned provider orders, duplicate orders, missing webhooks, and pending-payment aging need an owner-approved workflow and implementation before enabling live payments.

The PHP checkout now disables Razorpay unless its configured currency is EUR, matching server-calculated registration amounts and the public billing disclosure. This does not provide currency conversion or currency-wise ledger reporting.

For a suspected mismatch: pause the affected provider/write flow; preserve internal and provider event evidence; do not manually mark paid/refunded; compare provider ID, registration reference, gross/discount/tax calculation, currency, provider status, and timestamps; notify the authorized finance/admin owner; record the resolution outside sensitive logs; resume only after the discrepancy is resolved and any code defect is reviewed.

## SMTP/email

SMTP delivery is best-effort after durable submission storage; SMTP failure does not roll back a submission, and there is no durable retry/outbox queue. Monitor structured `submission_notification_failed` events and use the submission reference to follow up from the admin system. Validate sender/domain SPF, DKIM, and DMARC with the mail provider; use a dedicated mailbox and test recipients in staging. Rotate SMTP credentials on suspected exposure. Do not log message content or credentials. Test both successful delivery and provider outage before enabling production notifications.

## Privacy and legal operations

The site collects form-submitted names, email/contact details, organization/institution, country, registration/category/quantity/accommodation/billing details, abstracts and attachments, contact messages, and technical IP address recorded with submissions. Admin accounts and provider-confirmed payment references/status/amount are also processed. The primary app stores submission data in MySQL or private JSON files, uploads in private directories, and site content in MySQL/JSON. Access is intended for authorized conference administrators and hosting/database operators. Verify the precise inventory against deployed forms, logs, backups, and provider settings before final approval.

Purposes include registration and payment administration, abstract review, answering enquiries, delivering requested materials, operating the conference, and security/abuse prevention. Payment processors (Stripe, PayPal, Razorpay when enabled), the configured SMTP provider, the hosting provider, Google Fonts/jsDelivr, and user-clicked map links may receive data or request metadata as their integrations are used. Actual processing locations, retention, cookie behavior, controller identity, lawful basis, and processor terms depend on production configuration and must be verified.

Before launch, publish owner/legal-reviewed privacy and terms notices, identify the controller/contact, lawful basis and purposes, recipients/transfers, retention periods, data-subject access/correction/deletion process, consent/marketing preference handling, cookies/third-party scripts, and complaint/authority contacts as applicable. Implement and test a documented request workflow; do not promise deletion from provider/backups where it is not available. The brochure updates checkbox is not evidence that a marketing-preference management system exists. Assess Indian DPDP obligations and GDPR/other international requirements with qualified counsel; no legal compliance is asserted.

For a suspected personal-data breach: contain access, preserve evidence, notify the incident lead and privacy/legal contact, determine scope/categories/individuals and provider impact, rotate credentials where relevant, assess applicable notification timelines with counsel, communicate through approved channels, document decisions/remediation, and review controls afterward.

## Performance and accessibility

The current admin submission APIs load complete collections and sort in application memory; there is no pagination or measured traffic baseline. Record expected concurrency and submission volume; measure public page/API latency, database query duration, error rate, PHP worker/memory/time limits, disk, and DB connection limits in staging. Add pagination and justified indexes when measured/forecast volume requires them. Keep image optimization, cache policy, compression, and CDN decisions within host capabilities; do not add infrastructure without evidence.

WCAG 2.2 AA, keyboard-only navigation, visible focus, screen-reader behavior, form labeling/error announcement, contrast, mobile navigation, tables, file download, and payment journeys have not received a complete audit. Run automated and manual assistive-technology checks; record and fix barriers before launch. Existing form labels, responsive behavior, and basic mobile rendering are not a WCAG conformance claim.

## Safe release procedure

1. Use separate development, staging, and production credentials/databases; never copy production data to staging unless it is minimized and safely anonymized.
2. Review the diff and migration SQL. Back up database and persistent files; confirm restore evidence and target identity. Migrations are manual and must not be run automatically in production.
3. Verify required PHP version/extensions and private environment configuration without printing secret values. Install only from the committed lockfile (`composer install --no-dev --classmap-authoritative`).
4. Run PHP syntax checks, Composer validation/audit, PHPUnit, PHPStan, JavaScript syntax, migration checks, secret scanning, and staging smoke tests.
5. Deploy a versioned release to staging; verify homepage, preserved URLs/content, CSRF, form persistence, admin authorization, upload isolation/download, notification success/failure, sandbox checkout/webhooks, and operational status.
6. Obtain release approval; deploy using the host's supported atomic/reversible mechanism; record release ID, time, approver, migration version, and backup identifier.
7. Run the same smoke tests in production without real charges or destructive actions; monitor logs/alerts. If any critical test fails, disable affected writes/payments and follow rollback steps.

Rollback application code only after confirming it is compatible with current schema/data. Preserve new records and backups; use a reviewed forward migration or explicitly authorized isolated restore for data recovery. Never run an untested restore against production.

## Administrator operating guide

- Use a unique long admin password and HTTPS. Share credentials only through an approved password manager; promptly rotate compromised credentials. Current app has no self-service password reset.
- Review registrations, abstracts, contacts, and brochure requests from the authenticated admin. Use notes/status for workflow tracking. Never alter registration price. For a pending bank transfer only, record the bank transaction reference before confirming receipt or a reason before cancelling; provider payments are changed only by verified provider workflows.
- Verify payment with provider references and the documented reconciliation process before fulfilling a paid registration. Pending/failed/review cases require finance/operator review.
- Download abstracts only when required, keep copies access-controlled, and follow the approved retention/deletion schedule.
- Before editing site content or prices, have a second authorized reviewer verify the change in staging. Export/backup content before material edits.
- Report suspicious access, payment mismatch, missing email, or upload issues through the incident/alert process; do not send personal data or secrets in routine support tickets.

## Exceptions, evidence, and release record

Maintain a dated release record containing version/commit, approver, test run links, staging and production smoke results, backup/restore evidence, migration review, dependency audit, security/privacy/accessibility findings, exceptions, owners, and target dates. Each exception needs explicit risk acceptance from the accountable owner, compensating control, expiry/review date, and must not waive a Critical data-integrity, payment-integrity, security, or recovery blocker.
