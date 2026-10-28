# MatAi 2027 payment gateway audit

## Scope and evidence

This audit traced the documented PHP/PDO application from the registration form through server-side pricing, provider checkout creation, callback/status verification, webhook updates, persistence, notifications, and the admin API. The separate legacy Express implementation was also checked for payment-flow differences. No `.env` values were disclosed, and no provider API calls, charges, or refunds were performed. The 2026-10-28 local follow-up applied the additive currency audit migration on the approved non-production database and used temporary rows for persistence checks; those rows were removed.

The security-review task reported no vulnerabilities in the changes it reviewed. That result does not verify provider account configuration, payment correctness, or production readiness.

## Findings

| Severity | Area | Evidence | Recommendation |
| --- | --- | --- | --- |
| Critical | Durable payment lifecycle | `backend/migrations/001_initial.sql` stores submissions, status, amount, and a JSON record, but defines no immutable payment ledger or webhook-event table. `Application::stripeWebhook` and `Application::razorpayWebhook` process events without durable event-ID deduplication. Refund, dispute, reconciliation, and recovery workflows are not implemented. | Add an additive payment ledger/event model with unique provider transaction/event IDs, transactional transitions, reconciliation, and explicit refund/dispute operations before live payments. |
| High | Duplicate payable orders and orphaned provider orders | PHP checkout methods create provider orders before `saveRegistration`; repeated requests create new references/orders. There is no checkout idempotency key or unique constraint tying one registration attempt to one payable order. | Persist an idempotent internal order before provider interaction; use provider idempotency support where available and recover ambiguous timeouts. |
| High | Currency configuration | Registration pricing is canonical EUR. USD/GBP are preferences only and cannot be charged; the attendee must confirm a switch to EUR. No approved exchange-rate source exists. New orders store `preferredCurrency`, `transactionCurrency`, and `amountCurrency` in both normalized MySQL columns and the durable JSON record. | **Code-enforced, not provider-verified:** both backends reject non-EUR transactions and mismatched provider order/payment amounts or currencies. Currency-wise ledger reporting remains a blocker before introducing another transaction currency. |
| High | Provider enablement and operational verification | Provider enablement now requires credentials plus a per-provider `*_EUR_CHECKOUT_VERIFIED=true` flag. Credentials and a flag alone do not prove account readiness, webhook setup, correct mode, successful sandbox checkout, or alerting. PayPal has no webhook/reconciliation path in the inspected implementation. | Keep flags false until the exact merchant account/environment passes documented sandbox order, capture, and webhook checks. Gate launch on evidence and keep providers disabled where recovery paths are absent. |
| High | Payment notifications and recovery | `Application::saveRegistration` invokes the general submission notification when an online order is created, before payment succeeds. That message now identifies the quoted transaction amount/currency and marks payment pending. There is still no payment-success email, durable email outbox, receipt job, or retry status. | Separate registration, payment-confirmation, and email-delivery states; enqueue notifications transactionally and retry idempotently. |
| Medium | Confirmation and receipts | Verified checkout responses and inline confirmation messages now include the transaction amount and currency where provided. There is still no dedicated verified confirmation/pending page, downloadable receipt, or durable payment-confirmation email/outbox. | Add a server-verified confirmation/status view and durable receipt/email workflow only after an authorized backend lookup. Keep pending clearly distinct from paid. |
| Medium | Admin operations and reporting | The PHP admin API exposes aggregate revenue/counts and manual bank-transfer verification with evidence, but no provider/currency-wise ledger, transaction timeline, failed/unresolved queue, webhook status, email status, reconciliation, or refund/dispute operations. | Build operations on top of the durable ledger; retain manual evidence-based bank-transfer verification and prohibit direct paid-state edits. |
| Medium | Test coverage | Targeted EUR selection/fallback, provider-readiness, payment amount/currency matching, and legacy status-transition coverage is present. There are still no provider-mocked lifecycle tests for duplicate checkout/events, ambiguous timeouts, refunds, email failure, or concurrency. | Add provider-mocked tests plus sandbox integration evidence before enabling live payment methods. |
| Medium | Legacy Node status transitions | The Express implementation previously allowed a delayed Stripe cancellation or Razorpay failure to overwrite a paid registration. | **Remediated in this pass:** shared transition logic preserves `Paid`; late verified captures can still resolve pending, failed, or cancelled records. Regression tests cover these transitions. |

## Current-flow summary

- Both PHP and Express applications recalculate registration pricing server-side, require EUR as the final transaction currency, and fail closed unless provider-specific EUR verification is explicitly enabled. Provider order creation responses and payment verification compare the provider amount/currency with the confirmed internal order; webhook mismatches cannot mark the registration paid.
- MySQL submission records now store `amount_currency`, `preferred_currency`, and `transaction_currency` alongside the numeric `amount` and JSON record. The additive `002_currency_audit` migration backfills only evidence present in older JSON; unknown historical transaction currencies remain null. JSON-file persistence continues to store the currency fields in each record.
- Stripe webhook signatures are checked against the raw request body and a five-minute timestamp window. Razorpay webhook signatures are checked against the raw body. Payment updates are partly repeat-safe at the record-status level, but provider event IDs and a durable transaction history are not recorded.
- PayPal return handling retrieves the provider order and confirms the capture server-side. A user who does not complete the return flow has no webhook-driven confirmation or reconciliation path.
- The admin PHP path restricts manual payment updates to pending bank transfers and records evidence/operator attribution. This does not replace provider reconciliation.
- The legacy Node backend duplicates checkout/payment logic and does not share the PHP database service boundary; both runtimes should not be operated as simultaneous writers.

## Verification limits

No provider credentials or account dashboard settings were validated. All local online providers remain disabled; no sandbox checkout, webhook delivery, email delivery, refund, dispute, or real transaction was run. The approved local database received the additive migration and temporary test rows that were cleaned up; counts and migration markers were verified afterward. These findings are engineering gaps and deployment blockers, not evidence that any payment provider is currently live or misconfigured.

## Acceptance evidence for this audit pass

| Requirement / scenario | Result | Evidence |
| --- | --- | --- |
| Server-side registration pricing, explicit currency fallback, provider readiness, and amount/currency matching | Passed (focused checks) | `npm test`: 14/14 tests pass. PHP syntax checks and direct PHP checks for provider readiness, pricing, fallback audit data, and amount/currency matching pass. PHPUnit/PHPStan were unavailable because Composer and `vendor/` are not installed. |
| Currency audit migration and persistence in both backend stores | Passed (local non-production) | Migration `002_currency_audit` was applied idempotently; direct PHP and Node/PDO checks round-tripped amount and all three currency fields, then removed the temporary rows. |
| Stripe, PayPal, and Razorpay sandbox checkout/callback/webhook flows | Not Verified | Provider credentials and EUR verification flags are absent; all online providers remain disabled. |
| Legacy Node delayed failure/cancellation does not overwrite verified paid status | Passed | `npm test`: status-transition tests cover late failure, cancellation, and verified capture ordering. |
| Local unsupported-currency fallback display | Passed | Browser verification confirmed the GBP preference prompts for EUR and displays the recalculated EUR total before confirmation. |
| Duplicate checkout prevention and provider event-ID deduplication | Failed | No server-side checkout idempotency record or durable webhook-event uniqueness constraint exists. |
| Duplicate/out-of-order event, timeout recovery, and provider outage scenarios | Not Verified | No durable payment event queue/reconciliation path or payment lifecycle test suite exists. |
| Refunds, partial refunds, disputes, and chargebacks | Failed | These operations are not implemented as a verified provider-backed workflow. |
| Email delivery failure/retry after payment | Not Verified | No payment-confirmation outbox or delivery-state mechanism exists; no SMTP test was performed. |
| Database integrity under payment concurrency | Not Verified | No payment ledger migration or concurrency test was run; the only database change was the additive currency audit migration on the local non-production database. |
| Production provider configuration, HTTPS, and dashboard webhooks | Not Verified | Requires operator/provider-console evidence; no secrets were inspected. |

No payment-related database changes or real charges/refunds were made. The audit and targeted currency guard do not meet the final acceptance rule for production readiness; online payments must remain blocked from live launch until the Critical/High items above are resolved and verified.
