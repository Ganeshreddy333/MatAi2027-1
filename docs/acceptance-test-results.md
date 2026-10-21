# MatAi 2027 acceptance test results

**Run date:** 2026-10-20  
**Environment:** Local PHP application at `http://127.0.0.1:8001`, plus offline PHPUnit and Node tests.  
**Safety limits:** `.env` values were not read or printed. No real or sandbox provider requests, charges, refunds, email sends, admin logins, destructive requests, or database writes were performed. This is not a production or provider certification.

## Executed checks

| Check | Result | Evidence |
| --- | --- | --- |
| Node payment status transition tests | Passed | `npm test`: 5 tests passed, covering verified payment preserved from delayed failure/cancellation and supported late capture recovery. |
| PHP registration pricing / coupon tests | Passed | `composer test`: 4 tests, 11 assertions. Server calculates totals from saved pricing and verifies a valid coupon is applied before tax. |
| PHP Razorpay currency configuration test | Passed | Same PHPUnit run verifies provider availability requires credentials and EUR configuration. |
| PHP static analysis | Passed | `composer analyse`: no PHPStan errors. |
| JavaScript/PHP syntax | Passed | `node --check backend/server.js`, `node --check backend/payment-status.js`, and PHP lint on changed PHP files. |
| Local CSRF-token endpoint | Passed | `GET /api/csrf` returned HTTP 200. This did not test rejection of a bad/missing token. |
| Online-provider availability | Passed (disabled state) | `GET /api/checkout/config` returned HTTP 200; Stripe, PayPal, and Razorpay were all disabled in this local environment. No provider checkout could be run. |
| Anonymous admin stats access | Passed | `GET /admin/api/stats` returned HTTP 401 without an authenticated session. |
| Anonymous admin session and local cookie attributes | Passed (local scope) | `GET /admin/api/session` returned `authenticated=false`; cookie had HttpOnly and SameSite=Strict. Secure was absent over local HTTP; production HTTPS behavior was not tested. |
| Public/admin page route and responsive smoke | Passed (limited) | Browser navigated 13 routes, all HTTP 200. The 12 public pages had no horizontal overflow, settled broken images, visible unlabeled form controls, duplicate IDs after accessibility edits, or page JavaScript errors at the available 312 px viewport. Admin route health was checked, but admin interaction/accessibility was excluded because the shared browser appeared to carry an authenticated session; no admin controls were used. |
| Local HTML response-time sample | Informational only | 12 sequential localhost fetches per route; observed p50/p95: home 7.8/64.8 ms, registration 3.1/36.3 ms, abstract 3.0/4.7 ms, admin 3.7/7.3 ms. This is not a load test, hosting benchmark, or before/after comparison. |
| Visual comparison and Core Web Vitals | Not Verified | Captured a local mobile screenshot in the integrated browser; no retained screenshot artifact, comparable reference capture, desktop viewport, representative LCP/INP/CLS data, or field-user metrics were produced in this pass. |
| Database modification during this run | Passed | No database writes or migrations were performed. |

## Payment lifecycle

| Scenario | Result | Evidence / limitation |
| --- | --- | --- |
| Successful Stripe, PayPal, and Razorpay checkout | Not Verified | All three providers were disabled locally; no provider calls or transactions were made. |
| Provider-confirmed payment is stored against the correct registration | Not Verified | Provider state could not be obtained or written in a sandbox. |
| Invalid callback/webhook signature is rejected without marking paid | Not Verified | Signature-verification code exists, but no signed/unsigned request tests were run. |
| Forged success redirect cannot mark paid | Not Verified | The PHP return/status paths query provider state in code; no runtime forgery test was performed. |
| Wrong amount or currency is rejected and flagged | Not Verified | Provider-side mismatch checks exist; no provider response was mocked for this run. EUR-only Razorpay configuration is covered separately. |
| Wrong provider order ID is rejected | Not Verified | No provider verification request was exercised. |
| Authorization without capture is not treated as paid | Not Verified | No provider state was mocked. |
| Delayed webhook eventually reconciles | Failed | No durable reconciliation worker or retry queue is implemented. |
| Webhook before redirect yields one successful fulfillment | Not Verified | No event-order integration test; no fulfillment/outbox is implemented. |
| Redirect before webhook stays evidence-based | Not Verified | Provider status lookup exists for Stripe/PayPal, but no runtime test was run. |
| Duplicate webhook causes no duplicate registration, receipt, or email | Failed | Webhook event IDs are not durably deduplicated; there is no payment receipt/email outbox. Record-level paid updates alone are not sufficient. |
| Out-of-order failure after success cannot downgrade payment | Passed (Node unit scope) | The 5 Node unit tests verify the transition helper preserves `Paid`. No provider webhook integration test was run. |
| Refreshing success page creates no duplicate registration/payment | Not Verified | Not browser-tested. The success status path does not itself initiate checkout, but no end-to-end test was run. |
| Same checkout opened in two tabs cannot create an unintended duplicate charge | Failed | There is no server-side checkout idempotency key or uniqueness constraint for a logical registration attempt. |
| Provider API outage has safe pending/retry behavior | Not Verified | No outage simulation. No complete retry/reconciliation mechanism exists. |
| Database unavailable after provider charge is reconciled after recovery | Failed | Provider order creation and local persistence are separate; there is no durable reconciliation process for this ambiguous outcome. |
| Payment succeeds but email fails; email retry is queued | Failed | Notifications are synchronous submission notices; no durable payment email outbox/retry state exists. |
| Partial/full refund records correct state and financial data | Failed | No provider-backed refund workflow or transaction ledger exists. |
| Chargeback/reversal is recorded and surfaced to admins | Failed | No dispute/reversal event handling or admin queue exists. |
| Two successful charges are both recorded and investigated | Failed | No immutable transaction ledger or duplicate-charge investigation queue exists. |
| Coupon manipulation cannot choose the submitted total/discount | Passed (pricing unit scope) | Registration pricing tests confirm server-side saved pricing and coupon calculation; no HTTP tampering test was run. |
| Currency conversion/rounding matches documented rules | Not Verified | Existing pricing tests use integer cents and EUR; edge-case rounding and foreign-currency display/billing were not tested. The PHP Razorpay path is restricted to EUR. |

## Admin panel and access control

| Scenario | Result | Evidence / limitation |
| --- | --- | --- |
| Correct credentials permit login | Not Verified | No credentials were read or used. |
| Incorrect credentials rejected without username disclosure | Not Verified | No login attempts were made. PHP code uses a generic error and password-hash verification. |
| Passwords stored as secure hashes | Not Verified (PHP config); Passed (Node unit test) | PHP requires `ADMIN_PASSWORD_HASH` and uses `password_verify`; configured values were not inspected. Legacy Node now verifies a separate `NODE_ADMIN_PASSWORD_HASH` scrypt hash; no live credential was used and the login route was not integration-tested. |
| Session cookie is Secure, HttpOnly, SameSite in production | Partially Verified | PHP local cookie had HttpOnly and Strict but no Secure flag over local HTTP; its HTTPS configuration was not exercised. Node unit tests verify Secure serialization; production startup requires HTTPS `PUBLIC_BASE_URL`, but no production response was available. |
| Logout invalidates session | Not Verified | No authenticated session was created. |
| Expired session requires reauthentication | Not Verified | PHP implements an eight-hour inactivity check; expiry was not simulated. |
| Protected admin route rejects anonymous user | Passed | Local admin stats API returned 401. |
| Guessed admin URLs cannot expose data | Passed (one route) | Admin stats returned 401; other protected endpoints were not individually exercised. |
| Changing IDs cannot expose another attendee’s private data | Not Verified | No authorized attendee-level access flow exists to exercise; no IDOR test was run. |
| Unauthorized users cannot change payment/abstract status | Not Verified | No mutation request was attempted to avoid writes. PHP admin routes require authentication and CSRF validation. |
| Search, pagination, filters, and exports are accurate | Failed | Search/pagination/filter workflows are not implemented as a complete admin feature set; exports were not reconciled against database records. |
| Dashboard separates paid/pending/failed/refunded and currency/provider totals | Failed | Current summary is limited and does not provide a full transaction-ledger breakdown by provider/currency/refund state. |
| Destructive actions require authorization and confirmation | Not Verified | No destructive action was attempted. |
| Admin actions have complete actor/timestamp audit trail | Failed | Manual bank-transfer updates retain evidence/operator details, but a complete audit trail for all administrative changes is absent. |
| Password reset uses expiring single-use tokens | Not Applicable | No password-reset workflow was found in the inspected application. |

## Database, files, email, and integrations

| Scenario | Result | Evidence / limitation |
| --- | --- | --- |
| Production schema matches approved migrations | Not Verified | No production database was accessed. |
| Provider transaction/event uniqueness constraints exist | Failed | Current schema has no dedicated payment/event ledger with provider ID uniqueness. |
| Existing records survive deployment | Not Verified | No deployment or migration was run during this test. |
| Database credentials are least-privilege | Not Verified | Credential values/permissions were not inspected. Prior local audit recorded that the development account needs replacement before production. |
| Database failure returns safe error | Not Verified | No database outage was simulated; PHP has a generic request error handler. |
| Concurrent submissions/payments cannot corrupt records | Not Verified | Store mutation uses transactions/locks, but no concurrency test was run; duplicate logical checkout prevention is absent. |
| Financial values use precise representation | Passed (unit scope) | Server pricing calculates integer cents and persists monetary amounts to a decimal field; edge cases were not load-tested. |
| Backup and restore succeed | Not Verified | No backup/restore was run. |
| Registration confirmation reaches attendee | Not Verified | SMTP configuration/delivery was not tested. |
| Payment receipt has correct reference, amount, currency | Failed | No payment receipt workflow exists. |
| Admin notifications reach only configured recipients | Not Verified | SMTP was not exercised. |
| SMTP TLS/authentication work | Not Verified | No email was sent. |
| Failed/bounced email can be retried | Failed | No durable outbox or retry mechanism. |
| Duplicate events cannot duplicate receipts | Failed | No payment receipt/outbox or durable event deduplication. |
| Private documents cannot be downloaded by guessed URL | Not Verified | No attachment access tests were run. |
| External API timeouts/retries are bounded | Not Verified | No provider outage was simulated. The PHP HTTP client has bounded connect/overall timeouts; this is not evidence of retry/recovery behavior. |
| Webhook endpoints are reachable over public HTTPS | Not Verified | Only localhost was tested. |

## Security and reliability

| Scenario | Result | Evidence / limitation |
| --- | --- | --- |
| SQL injection | Not Verified | No dynamic injection test was run. PHP database access uses prepared statements. |
| Stored/reflected XSS | Not Verified | No dynamic payload tests were run. |
| CSRF on PHP state-changing routes | Not Verified | Token endpoint returned 200; missing/invalid-token rejection was not tested. |
| CSRF on legacy Express routes | Passed (middleware unit tests); integration Not Verified | All unsafe methods now require a session-bound `X-CSRF-Token`; valid/missing/invalid token behavior was unit-tested. The complete frontend-to-route flow was not run against the Express server. |
| Login brute-force throttling | Not Verified | Rate-limit code exists in PHP; no repeated login attempts were sent. |
| Malicious/disallowed file upload | Not Verified | No uploads were sent in this run. |
| Path traversal | Not Verified | No traversal test was run. |
| Sensitive errors avoid stacks/credentials | Not Verified | No failure was deliberately triggered; PHP request handler returns a generic response and logs exception class. |
| Secret scanning | Not Verified | No secret scan was run. `.env` values were not read. |
| Dependency audit | Passed | `composer audit`: no advisories; `npm audit --omit=dev`: 0 vulnerabilities. |
| HTTPS certificate and mixed-content checks | Not Verified | Local HTTP only. |
| Security headers/CSP | Not Verified | Local response headers and production CSP were not validated. |
| Personal-data exposure in logs/exports | Not Verified | No log/export review or production data access was performed. |
| Peak registration burst/performance | Not Verified | No load test or production traffic target was available. |
| Provider timeout/email outage/restart recovery | Not Verified | No external failure or restart scenario was simulated. |
| Monitoring and backup alerts | Not Verified | No production monitoring/alert destination was available. |
| Rollback from deployment | Not Verified | No deployment occurred. |

## Overall decision

**Acceptance: Failed / Not production-ready.** Local unit and access-control smoke checks passed, but all payment providers were disabled and most provider, email, production, and resilience scenarios could not be exercised. The absent payment ledger, checkout idempotency, event deduplication, reconciliation, refund/dispute handling, and email outbox are release blockers. Legacy Express password-hash, CSRF, session-rotation, and Secure-cookie controls have been implemented and unit-tested, but route-level authentication, configured credentials, and production HTTPS behavior remain unverified; do not expose that runtime publicly until staging checks pass.

No database records or migrations were changed during this test pass.
