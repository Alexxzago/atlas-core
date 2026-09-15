# EPIC 053 Pilot Readiness Release Checklist

## Release Gate

From `C:\ATLAS\backend`, run:

```powershell
npm run typecheck
npm run test:epic053:pass5
```

## Configuration

- Confirm the production core configuration validated by `productionConfiguration`: `NODE_ENV=production`, `DATABASE_PROVIDER=libsql`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ATLAS_VERIFICATION_ORIGIN`, and `ATLAS_BOOTSTRAP_SECRET`.
- Configure the Meta embedded-signup capability only when it is intended for the release. Its code-derived configuration names are `META_APP_ID`, `META_EMBEDDED_SIGNUP_CONFIG_ID`, `META_GRAPH_API_VERSION`, and `META_EMBEDDED_SIGNUP_STATE_HMAC_KEY`; the production inventory also requires `META_APP_SECRET` when Meta embedded signup is enabled.
- Configure WhatsApp only when its credentials or webhook are enabled. Use the names listed in `productionConfigurationInventory`; do not place values in release notes, logs, URLs, or client configuration.
- A company can become `pilot_ready` with an executable default assistant, published knowledge, usable commercial state, and at least one operational Web Chat or WhatsApp connection. Meta embedded signup is not required when Web Chat is operational.

## Smoke Check

- Confirm `/ready` returns HTTP 200 after deployment.
- As an existing authorized customer, repeat `GET /workspaces/:workspaceId/companies/:companyId/pilot-readiness`; both requests must be safe retries and return the current assessment.
- Inspect only safe `pilot_readiness_*` operational events. They contain workspace and company numeric identifiers plus classification, never credentials, provider identifiers, raw errors, or UI action paths.
- No migration is required for PASS5. The transition cache is process-local telemetry state and does not affect readiness responses or persistent data.
