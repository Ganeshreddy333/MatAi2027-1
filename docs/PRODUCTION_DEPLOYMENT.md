# Production deployment guide

This guide is a deployment template, not evidence that a hosting environment has been checked.

## Runtime and web root

1. Use PHP 8.2+ with `pdo_mysql`, `curl`, `fileinfo`, `json`, `mbstring`, and `openssl`.
2. Point the web server document root to `frontend/`; keep `.env`, `backend/`, migrations, logs and private uploads outside direct public access.
3. Route `/api/*`, `/admin/*` and approved `/uploads/*` through the PHP router. Do not expose `backend/server.js` as a second production payment API.
4. Use Composer's committed lockfile and production install mode. Set `display_errors=Off`; send PHP errors to access-controlled server logs.
5. Require HTTPS at the edge and set the correct trusted proxy configuration before relying on forwarded scheme headers.

## Database and release

1. Provision a dedicated least-privilege MySQL account with required migration privileges for deployment and only application read/write privileges at runtime.
2. Back up database and private files; verify restore in an isolated environment.
3. Run incremental migrations using `php backend/bin/migrate.php`; never import `hpanel-full-import.sql` over an existing installation and never drop/reset tables.
4. Verify migration markers, table structure, registration row counts and currency/provider-reference consistency.
5. Deploy the application to staging first. Online payments remain disabled unless MySQL is connected and provider flags/configuration are complete.

## Secret configuration

Use the secret manager for database credentials, admin hash, SMTP, and provider credentials. Keep sandbox and live values in separate environments. Configure `APP_ENV=production`, HTTPS `APP_URL`, and required provider verification flags only after evidence-based sandbox acceptance.

PayPal additionally requires `PAYPAL_MERCHANT_ID` and `PAYPAL_WEBHOOK_ID`. Razorpay requires the key ID, key secret, webhook secret and `RAZORPAY_CURRENCY=USD`. Stripe requires API and webhook secrets. Never copy secrets to frontend files or logs.

## Before live traffic

Verify provider return/cancel URLs, webhook deliveries, rate limits, email delivery, database outage behavior, monitoring alerts, log retention, backup/restore and rollback. Keep a prior known-good application release available. Roll back application code without dropping payment or registration data.
