# EPIC055 Mercado Pago Sandbox Setup

## Required configuration

- `MERCADOPAGO_ACCESS_TOKEN`: sandbox or controlled live-like access token.
- `MERCADOPAGO_WEBHOOK_SECRET`: notification signing secret used by Atlas.
- `MERCADOPAGO_ALLOWED_REDIRECT_ORIGINS`: comma-separated HTTPS Atlas checkout return origins.
- One active recurring ARS Mercado Pago preapproval plan/reference per immutable Atlas Mercado Pago offer. Its interval and amount must match the Atlas offer before the offer is sellable.
- Configure the Atlas notification endpoint as `https://<atlas-api-origin>/webhooks/billing/mercadopago`.

## Operational constraints

- A verified payer identity selected by an authorized workspace manager is required before Mercado Pago checkout. Atlas sends only that selected email as `payer_email`.
- Atlas posts the configured HTTPS checkout success target as `back_url`; browser return remains non-authoritative until reconciliation completes.
- Validate Mercado Pago sandbox notification headers and signature construction with real sandbox notifications before go-live. Atlas preserves timestamp freshness but does not assume undocumented provider fields or idempotency behavior.
- Test uncertain create recovery using only the opaque Atlas external reference. Do not retry a Mercado Pago create request blindly.
