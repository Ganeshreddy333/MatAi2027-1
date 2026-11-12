# Payment webhook configuration

Configure HTTPS webhook destinations on the exact provider account and environment used by the app. Do not enable provider verification flags until test-mode delivery and signature validation are evidenced.

| Provider | Endpoint | Current subscribed event guidance | Secret/identifier |
|---|---|---|---|
| Stripe | `POST https://<public-host>/api/stripe/webhook` | `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `checkout.session.async_payment_failed` | `STRIPE_WEBHOOK_SECRET` |
| PayPal | `POST https://<public-host>/api/paypal/webhook` | `PAYMENT.CAPTURE.COMPLETED` | `PAYPAL_WEBHOOK_ID` plus OAuth client credentials; authenticity is checked with PayPal's `/v1/notifications/verify-webhook-signature` API. |
| Razorpay | `POST https://<public-host>/api/razorpay/webhook` | `payment.captured`, `payment.failed` | `RAZORPAY_WEBHOOK_SECRET`; signature is computed over the unmodified raw request body. The handler also requires `X-Razorpay-Event-Id`. |

## Operational requirements

- Webhook requests must reach the PHP API directly with body bytes unchanged, especially for Razorpay.
- Allow provider retries on transient non-2xx responses. The handler records provider event IDs in the unique `(provider, provider_event_id)` key after verification and uses repeat-safe payment transitions.
- Do not store raw webhook payloads: current audit records keep only a resource identifier.
- Rotate secrets through the secret manager; update provider dashboard and environment together.
- Use separate sandbox/test and live webhook destinations/IDs.
- Confirm HTTPS, route reachability, provider dashboard delivery status, event signature validity, DB persistence, and replay behavior in staging.

Duplicate-event recording and registration update are not a single database transaction yet; this remains a live-payment release blocker.
