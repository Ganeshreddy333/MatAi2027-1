# MatAi 2027 — Materials Science, Engineering & AI Conference

The existing conference content and 12 public pages, plus the admin console, are retained. The frontend remains HTML, CSS, JavaScript, and Bootstrap 5 CSS; the backend now includes a PHP 8.2+, Composer, PDO, and MySQL implementation while keeping the current browser API contract.

## Preserved pages and features

| Page | File |
| --- | --- |
| Home | `frontend/index.html` |
| About | `frontend/about.html` |
| Scientific Committee | `frontend/committee.html` |
| Speakers | `frontend/speakers.html` |
| Abstract Submission | `frontend/abstract-submission.html` |
| Scientific Sessions | `frontend/sessions.html` |
| Venue | `frontend/venue.html` |
| Conference Information and policies | `frontend/information.html` |
| Sponsors and Exhibition | `frontend/sponsors.html` |
| Registration | `frontend/registration.html` |
| Contact | `frontend/contact.html` |
| Brochure | `frontend/brochure.html` |
| Admin | `frontend/admin.html` |

The PHP API retains editable public content, committee/speaker/page administration, form submissions, private abstract attachments, CSV export, server-calculated registration totals, and Stripe, PayPal, and Razorpay checkout and payment verification. The reference website is a different event; only general design ideas should be borrowed, not its dates, venue, branding, or event content.

Bootstrap 5.3.3 CSS is loaded from jsDelivr before the existing custom design system; the existing vanilla JavaScript remains in place for the site's current interactions.

## Local development

Requirements: PHP 8.2+, Composer, and the PHP extensions `pdo_mysql`, `curl`, `fileinfo`, `json`, `mbstring`, and `openssl`.

```sh
composer install
cp .env.example .env
# Edit .env with local values; set APP_URL=http://localhost:8000.
php -S 127.0.0.1:8000 -t frontend backend/php/router.php
```

On Windows, if `php -m` does not list `pdo_mysql`, enable the bundled extension when starting the server:

```powershell
$phpDir = Split-Path (Get-Command php).Source
php -d "extension_dir=$phpDir\ext" -d extension=php_pdo_mysql.dll -S 127.0.0.1:8000 -t frontend backend/php/router.php
```

The built-in PHP router sends `/api/*`, `/admin/*`, and `/uploads/*` to the PHP API while serving the existing static pages. The existing Node server remains available for the legacy development workflow (`npm install && npm start`); do not run both backends against the same database while accepting submissions.

Without MySQL settings, the PHP backend uses the existing private JSON files under `backend/data/`. If any MySQL setting is supplied, all required MySQL connection settings must be valid; connection failures are reported, not silently switched to JSON.

## MySQL and data preservation

1. Back up the existing database and `backend/data/` files using your hosting provider's secure backup facility.
2. Create a least-privilege MySQL database/user. The app needs table creation for the first migration and read/write access to the application tables.
3. Copy `.env.example` to `.env` outside the public document root, and set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD`.
4. Install dependencies and apply migrations:

   ```sh
   composer install --no-dev --classmap-authoritative
   php backend/bin/migrate.php
   ```

The initial migration uses `CREATE TABLE IF NOT EXISTS` and the existing `matai_submissions`, `matai_submission_locks`, `matai_site_content`, and `matai_migrations` table names and columns. Legacy JSON submissions/content are imported once using the existing `legacy-json-v1` migration marker. Original JSON files are not deleted or rewritten. Existing schema, content, identifiers, and records are never dropped or reset.

Do not run migrations against production before taking a backup and confirming the target database. No database was contacted while preparing this migration.

## Admin, uploads, and security

- Set unique `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH`; create the password hash with PHP's `password_hash()` (for example, run `php -r 'echo password_hash(readline("Admin password: "), PASSWORD_DEFAULT), PHP_EOL;'` in a trusted terminal). Login verifies the secret using `password_verify()`; there is no source-code default credential.
- The PHP admin uses secure/HTTP-only/SameSite session cookies, rotates the session on login, requires CSRF headers on state-changing routes, and rate-limits failed logins.
- The legacy Node backend does not accept a plaintext admin password. Configure `NODE_ADMIN_PASSWORD_HASH` separately using `npm run admin:hash` in an interactive terminal; it creates a Node scrypt hash and does not echo the password. Keep `ADMIN_PASSWORD_HASH` for the PHP backend only. The Node app issues `/api/csrf` tokens for state-changing requests, rotates the session on successful login, and sets `Secure` cookies when `APP_ENV=production` or `PUBLIC_BASE_URL` uses HTTPS. Production requires an HTTPS `PUBLIC_BASE_URL`.
- Keep `backend/` and `.env` outside the public document root. Set private data/upload directory permissions to the PHP process user only (for example, directories `0700`, files `0600`).
- Abstract uploads are limited to 5 MB and PDF/DOC/DOCX signatures are checked. They are stored outside public access and downloaded only by an authenticated administrator.
- Admin-uploaded images are signature-checked and served through a strict allowlisted image route.
- Configure HTTPS and use a database account limited to the application database. Review web-server and PHP logs privately.

## Email setup

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_ENCRYPTION` (`tls` or `ssl`), `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_ADDRESS`, `SMTP_FROM_NAME`, and `ADMIN_NOTIFICATION_EMAIL`. PHPMailer sends an administrative notification and a brief receipt to the submitter after a submission is durably stored. SMTP is optional until configured; failures are logged without undoing saved submissions. Credentials and message bodies are not written to application logs. Test with a dedicated mailbox before enabling production delivery.

## Payments

Configure provider credentials in `.env`; do not put secrets in browser code. Keep Stripe test keys, PayPal sandbox mode, and Razorpay test keys active until checkout and webhook verification are tested end-to-end. Registration pricing, taxes, and coupons are recalculated server-side from saved content. A paid state is set only after provider-side verification or a valid provider webhook.

- Stripe webhook: `POST /api/stripe/webhook`; subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, and `checkout.session.async_payment_failed`.
- Razorpay webhook: `POST /api/razorpay/webhook`; subscribe to `payment.captured` and `payment.failed`.
- PayPal uses the Orders API and server-side capture verification.
- Set the webhook secrets in `.env`; never expose them to the browser.
- All providers use EUR, matching the existing published fees. Check merchant account currency/international-payment support before enabling.

Do not make real charges or use live credentials for development tests.

## Tests, static analysis, and CI

```sh
composer install
composer test
composer analyse
composer validate --strict
```

The GitHub Actions workflow runs Composer validation, PHPUnit, PHPStan, PHP syntax checks, and JavaScript syntax checks on PHP 8.2, 8.3, and 8.4. Payment-provider, SMTP, MySQL integration, and responsive-browser tests require appropriately isolated test services/credentials and are not run against production.

The workflow requires a committed `composer.lock`, runs `composer audit`, and scans repository history for secrets. A lockfile is present; local Composer validation and audit passed on PHP 8.2.33, but the GitHub Actions matrix has not been run. Dependabot proposes Composer, npm, and GitHub Actions updates; updates still require review and tests.

## Production-readiness operations

See [docs/production-readiness.md](docs/production-readiness.md) for operational runbooks, threat-model coverage, privacy and legal review requirements, release procedure, monitoring/backup plans, limitations, and the explicit launch-blocking readiness list. The authenticated `/admin/api/ops-status` endpoint only checks application storage and basic database connectivity; it does not configure external monitoring or alert delivery. No backup schedule, staging environment, production monitoring, legal approval, restore test, or provider sandbox test is established by this repository alone.

## Hostinger deployment

1. Select PHP 8.2 or newer and enable `pdo_mysql`, `curl`, `fileinfo`, `mbstring`, `json`, and `openssl`.
2. Keep `backend/`, `vendor/`, and `.env` outside `public_html` where possible. Set the site document root to the project `frontend/` directory.
3. Enable Apache `mod_rewrite` and deploy `frontend/.htaccess`; verify `/api/content` and `/api/csrf` before opening public forms.
4. Upload application files through the chosen Git deployment/CI workflow or Hostinger file manager. Install Composer dependencies in the private project directory.
5. Create the MySQL database/user, configure `.env` privately, back up existing records/files, then run `php backend/bin/migrate.php` once.
6. Set private data and upload directory ownership/permissions for the PHP process. Never make submission documents or `.env` world-readable.
7. Enforce HTTPS, configure SMTP, then configure provider webhooks to the HTTPS endpoints above. Use test credentials until verified.
8. Review PHP/web-server logs and run a harmless public-page/API and test-mode submission check after each deployment.

Hostinger plan details vary; confirm document-root, CLI Composer/PHP version, scheduled-job, webhook, and rewrite support in the account before deployment. No deployment was performed.

## Rollback

1. Disable checkout and form submission temporarily if data may be written during rollback.
2. Restore the previous application release without deleting the migrated PHP files or original content.
3. Keep the database and JSON backups intact. Do not drop tables during code rollback.
4. If a schema rollback is needed, take a fresh backup and use a reviewed forward migration or restore an explicitly chosen backup with authorization; never reset production data as a rollback shortcut.
5. Re-enable forms/payments only after verifying the restored application and storage target.

## Legacy Node backend

The current Node/Express backend (`backend/server.js`) is retained during the staged migration and remains a separate, legacy runtime. Its local start command is `npm start`. Hostinger PHP deployments should route the site to the PHP bridge and must not expose both backends as writers to the same storage during cutover.
