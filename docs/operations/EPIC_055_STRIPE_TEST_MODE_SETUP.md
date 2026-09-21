# EPIC055 Stripe Test-Mode Setup

## Required Stripe configuration

1. Create a restricted Stripe **test-mode** secret key with permission to create Checkout Sessions, Billing Portal Sessions, and update/read Subscriptions. Set it only as `STRIPE_SECRET_KEY` in the deployment environment.
2. Create one active recurring USD Stripe Price for each immutable Atlas provider commercial offer. Record only its Price ID in the Atlas offer administration flow. The Stripe interval, amount, currency (`USD`), and active state must match the immutable Atlas offer before it is made sellable.
3. Set `STRIPE_ALLOWED_REDIRECT_ORIGINS` to the comma-separated HTTPS Atlas origins that host the checkout success URL, checkout cancel URL, and billing portal return URL. Do not include arbitrary customer-controlled origins.
4. Configure Stripe to deliver `checkout.session.completed` and `customer.subscription.*` events to `https://<atlas-api-origin>/webhooks/billing/stripe`. Set the endpoint signing secret only as `STRIPE_WEBHOOK_SIGNING_SECRET`; never in source or client configuration.
5. Enable and configure the Stripe Billing Portal in test mode. Its return URL must be the configured HTTPS Atlas billing portal return URL.

## Controlled validation

1. Start checkout for a single workspace and confirm the Checkout Session is in subscription mode with the mapped USD Price.
2. Complete payment using Stripe test data. Confirm the browser return only shows pending/returned state until the signed webhook and reconciliation worker have completed.
3. Verify the reconciled subscription has the expected Stripe subscription ID, customer binding, immutable Price mapping, and canonical entitlement.
4. Use the Billing Portal to schedule cancellation and reactivate before period end. Confirm Atlas state changes only after reconciliation.
5. Exercise a deliberately delayed or failed Checkout Session create in the local test harness. Confirm Atlas records uncertainty and recovers only with the same durable Stripe idempotency key.

## Environment values

- `STRIPE_SECRET_KEY`: Stripe test-mode secret key.
- `STRIPE_ALLOWED_REDIRECT_ORIGINS`: HTTPS Atlas return origins.
- `STRIPE_TIMEOUT_MS`: bounded provider request timeout.
- `STRIPE_API_VERSION`: optional pinned Stripe API version.
- `STRIPE_WEBHOOK_SIGNING_SECRET`: Stripe endpoint signing secret.

No Stripe credentials, Product IDs, Price IDs, Customer IDs, Subscription IDs, or webhook secrets are committed by this pass.
