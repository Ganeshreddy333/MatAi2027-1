# Payment API

All URLs are same-origin PHP API routes. State-changing endpoints require the application's CSRF token in `X-CSRF-Token`. Online payment endpoints require MySQL; JSON mode returns service unavailable for provider operations.

## Checkout

| Method and route | Purpose |
|---|---|
| `GET /api/checkout/config` | Returns provider availability and public Razorpay key ID only. Provider availability is false without MySQL and required configuration. |
| `POST /api/checkout/quote` | Validates submitted registration selections and returns server-calculated item lines, participant count, period, accommodation dates, subtotal, discount, tax and final amount in minor units. Client financial fields are not authoritative. |
| `POST /api/checkout/stripe` | Recalculates the selection, stores a pending internal registration/snapshot, then creates a Stripe Checkout Session. |
| `GET /api/checkout/stripe/status/{sessionId}` | Retrieves Stripe session status from Stripe and verifies internal reference, amount and currency. |
| `POST /api/checkout/paypal/order` | Recalculates and persists the pending registration before creating PayPal Orders API order. |
| `POST /api/checkout/paypal/capture` | Looks up the internal registration by provider order ID, retrieves/captures server-side, then verifies capture status, amount, currency and merchant. |
| `POST /api/checkout/razorpay/order` | Recalculates and persists before creating a Razorpay order in minor units. |
| `POST /api/checkout/razorpay/verify` | Validates checkout HMAC, fetches provider payment, checks association, amount/currency and captured status. Authorized-only remains pending. |
| `POST /api/checkout/razorpay/cancel` | Marks only an eligible pending registration as cancelled; it is not proof of provider cancellation. |

## Webhooks

- `POST /api/stripe/webhook`
- `POST /api/paypal/webhook`
- `POST /api/razorpay/webhook`

Webhook routes bypass browser CSRF only; they require provider signature validation. See [PAYMENT_WEBHOOK_CONFIGURATION.md](./PAYMENT_WEBHOOK_CONFIGURATION.md).

## Trust boundary

Never submit an amount to a provider based on `totalPrice`, tax, discount or unit price from browser data. The backend recomputes from saved content. The quote is for display/confirmation; provider creation recomputes again. Only server-verified captured payments set internal status to paid.

## Known API limitations

No public order-status lookup independent of Stripe session ID, no guest ownership token, no payment retry endpoint, no refund endpoint, no internal idempotency key, and no reconciliation endpoint are currently implemented. Do not expose a generic registration-reference lookup to unauthenticated callers.
