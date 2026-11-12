# Payment database schema and migration status

## Current schema

- `matai_submissions` stores registration and other form submissions. Registration amount and currency are normalized in additive migration `002_currency_audit.sql`; the full record, including the newly written pricing snapshot, is still stored in `record_json`.
- `matai_submission_locks` serializes JSON-record array mutations in MySQL.
- `matai_payment_events` in `003_payment_coupon_audit.sql` has a composite primary key `(provider, provider_event_id)` and an optional registration reference. It is used for webhook event-ID deduplication. The JSON payload stored by the current handlers is limited to a resource ID.
- `matai_coupon_redemptions` exists, but checkout does not yet use a dedicated transactional coupon/order reservation workflow.
- `matai_migrations` tracks the applied migration names.

## Missing normalized payment entities

There are no dedicated `orders`, `order_items`, `payments`, `payment_attempts`, `refunds`, `idempotency_keys`, or payment-state-history tables. Provider references and payment status are currently part of registration `record_json`; this is insufficient for complete financial audit, unique transaction constraints, refund reporting, and reconciliation.

## Migration guidance

No schema migration was added in this implementation pass. Do not edit or reset a live database. Before adding normalized payment tables:

1. Back up the database and verify an isolated restore.
2. Apply only additive migrations to a production-like copy.
3. Backfill from existing registration records only where values are evidenced; do not infer missing provider IDs or currencies.
4. Compare row counts, amount/currency totals and foreign-key coverage.
5. Deploy application code compatible with both schemas, then add constraints only after duplicate/null audit.
6. Roll back by rolling back application code while retaining new tables and data; do not drop payment history.

The current migrations are not validated against a production database in this environment.
