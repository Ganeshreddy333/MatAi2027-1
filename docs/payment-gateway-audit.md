# MatAi 2027 payment gateway audit

## Scope and evidence

This audit traced the documented PHP/PDO application from the registration form through server-side pricing, provider checkout creation, callback/status verification, webhook updates, persistence, notifications, and the admin API. The separate legacy Express implementation was also checked for payment-flow differences. No `.env` values were read or disclosed, and no provider API calls, charges, refunds, or database writes were performed for this audit.

The security-review task reported no vulnerabilities in the changes it reviewed. That result does not verify provider account configuration, payment correctness, or production readiness.

## Findings

| Severity | Area | Evidence | Recommendation |
| --- | --- | --- | --- |
| Critical | Durable payment lifecycle | `backend/migrations/001_initial.sql` stores submissions, status, amount, and a JSON record, but defines no immutable payment ledger or webhook-event table. `Application::stripeWebhook` and `Application::razorpayWebhook` process events without durable event-ID deduplication. Refund, dispute, reconciliation, and recovery workflows are not implemented. | Add an additive payment ledger/event model with unique provider transaction/event IDs, transactional transitions, reconciliation, and explicit refund/dispute operations before live payments. |
| High | Duplicate payable orders and orphaned provider orders | PHP checkout methods create provider orders before `saveRegistration`; repeated requests create new references/orders. There is no checkout idempotency key or unique constraint tying one registration attempt to one payable order. | Persist an idempotent internal order before provider interaction; use provider idempotency support where available and recover ambiguous timeouts. |
| High | Currency configuration | Registration pricing and the public page state EUR billing. Before remediation, PHP `createRazorpayOrder` accepted any three-letter `RAZORPAY_CURRENCY` and created an order using the EUR numeric amount in that currency. Admin revenue sums amounts without currency grouping. The legacy Node implementation hardcodes EUR. | **Partially remediated:** PHP checkout configuration and order creation now require EUR; automated unit coverage verifies this guard. Currency-wise ledger reporting remains a production blocker if any other currency is introduced. |
| High | Provider enablement and operational verification | `/api/checkout/config` marks providers available based on credential presence. That does not prove account readiness, webhook setup, correct mode, successful sandbox checkout, or alerting. PayPal has no webhook/reconciliation path in the inspected implementation. | Gate launch on explicit per-environment activation and verified account/webhook/sandbox evidence. Keep providers disabled where required verification or recovery paths are absent. |
| High | Payment notifications and recovery | `Application::saveRegistration` invokes the general submission notification when an online order is created, before payment succeeds. There is no durable email outbox, payment receipt job, or retry status. A notification failure/retry can be disconnected from the financial state. | Separate registration, payment-confirmation, and email-delivery states; enqueue notifications transactionally and retry idempotently. |
| Medium | Confirmation and receipts | The public checkout displays inline status messages. Verified Stripe/PayPal/Razorpay paths display the registration reference only; there is no dedicated verified confirmation or pending page, payment reference/amount/currency summary, or downloadable receipt. | Add a server-verified confirmation/status view and receipt only after an authorized backend lookup. Keep pending clearly distinct from paid. |
| Medium | Admin operations and reporting | The PHP admin API exposes aggregate revenue/counts and manual bank-transfer verification with evidence, but no provider/currency-wise ledger, transaction timeline, failed/unresolved queue, webhook status, email status, reconciliation, or refund/dispute operations. | Build operations on top of the durable ledger; retain manual evidence-based bank-transfer verification and prohibit direct paid-state edits. |
| Medium | Test coverage | Existing tests exercised registration pricing and validation; this pass adds targeted currency and legacy status-transition tests, but there are still no lifecycle tests for duplicate checkout/events, provider mismatches, ambiguous timeouts, refunds, email failure, or concurrency. | Add provider-mocked tests and sandbox integration evidence before enabling live payment methods. |
| Medium | Legacy Node status transitions | The Express implementation previously allowed a delayed Stripe cancellation or Razorpay failure to overwrite a paid registration. | **Remediated in this pass:** shared transition logic preserves `Paid`; late verified captures can still resolve pending, failed, or cancelled records. Regression tests cover these transitions. |

## Current-flow summary

- The PHP application recalculates registration pricing server-side and uses EUR totals for Stripe and PayPal. Razorpay checkout is now disabled unless its configured currency is EUR; verification checks the provider order/payment association, currency, amount, and provider status.
- Stripe webhook signatures are checked against the raw request body and a five-minute timestamp window. Razorpay webhook signatures are checked against the raw body. Payment updates are partly repeat-safe at the record-status level, but provider event IDs and a durable transaction history are not recorded.
- PayPal return handling retrieves the provider order and confirms the capture server-side. A user who does not complete the return flow has no webhook-driven confirmation or reconciliation path.
- The admin PHP path restricts manual payment updates to pending bank transfers and records evidence/operator attribution. This does not replace provider reconciliation.
- The legacy Node backend duplicates checkout/payment logic and does not share the PHP database service boundary; both runtimes should not be operated as simultaneous writers.

## Verification limits

No provider credentials or account dashboard settings were validated. No sandbox checkout, webhook delivery, email delivery, refund, dispute, or real transaction was run. The existing local database was not modified during this audit. These findings are engineering gaps and deployment blockers, not evidence that any payment provider is currently live or misconfigured.

## Acceptance evidence for this audit pass

| Requirement / scenario | Result | Evidence |
| --- | --- | --- |
| Server-side registration pricing and coupon validation | Passed | `composer test`: pricing/validation tests pass; 4 tests, 11 assertions total. |
| Razorpay configured currency matches the EUR pricing model | Passed | `PaymentConfigurationTest` verifies missing credentials and non-EUR currency disable availability. |
| Legacy Node delayed failure/cancellation does not overwrite verified paid status | Passed | `npm test`: status-transition tests cover late failure, cancellation, and verified capture ordering. |
| Static analysis | Passed | `composer analyse`: no PHPStan errors. |
| Stripe, PayPal, and Razorpay sandbox checkout/callback/webhook flows | Not Verified | No provider account/dashboard configuration or sandbox transaction was available for this audit pass. |
| Duplicate checkout prevention and provider event-ID deduplication | Failed | No server-side checkout idempotency record or durable webhook-event uniqueness constraint exists. |
| Duplicate/out-of-order event, timeout recovery, and provider outage scenarios | Not Verified | No durable payment event queue/reconciliation path or payment lifecycle test suite exists. |
| Refunds, partial refunds, disputes, and chargebacks | Failed | These operations are not implemented as a verified provider-backed workflow. |
| Email delivery failure/retry after payment | Not Verified | No payment-confirmation outbox or delivery-state mechanism exists; no SMTP test was performed. |
| Database integrity under payment concurrency | Not Verified | No payment ledger migration or concurrency test was run; no database changes were made. |
| Production provider configuration, HTTPS, and dashboard webhooks | Not Verified | Requires operator/provider-console evidence; no secrets were inspected. |

No payment-related database changes or real charges/refunds were made. The audit and targeted currency guard do not meet the final acceptance rule for production readiness; online payments must remain blocked from live launch until the Critical/High items above are resolved and verified.
