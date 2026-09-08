# EPIC 042 Meta Embedded Signup Operations

## Architecture

EPIC 042 adds self-service WhatsApp onboarding through Meta Embedded Signup.

The browser only receives the approved public tuple:

- `META_APP_ID`
- `META_EMBEDDED_SIGNUP_CONFIG_ID`
- `META_GRAPH_API_VERSION`

The browser must never receive or persist Meta App Secret, Integration encryption keys, Embedded Signup HMAC keys, access tokens, authorization codes, provider response bodies, state digests, or completion-code digests.

The backend owns provider exchange, asset verification, Integration Connection persistence, credential encryption, WABA subscription confirmation, WhatsApp connection linking, and final readiness.

Meta WhatsApp credentials are stored only as encrypted Integration Connection secrets. New Embedded Signup flows do not copy the access token into the legacy `whatsapp_connection_credentials` store.

## Required Backend Environment

Configure these values in the Render backend environment when Meta Embedded Signup is enabled:

- `META_APP_ID`
- `META_APP_SECRET`
- `META_EMBEDDED_SIGNUP_CONFIG_ID`
- `META_GRAPH_API_VERSION`
- `META_EMBEDDED_SIGNUP_STATE_HMAC_KEY`
- `ATLAS_INTEGRATION_SECRET_KEY`

The existing WhatsApp runtime also uses:

- `WHATSAPP_APP_SECRET`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_GRAPH_API_VERSION`

Production also requires the existing deployment variables documented by EPIC 014, including `NODE_ENV=production`, `DATABASE_PROVIDER=libsql`, Turso credentials, and allowed origins. Production media uses private S3-compatible object storage, with Cloudflare R2 as the initial supported target. Configure `ATLAS_MEDIA_STORAGE_PROVIDER=s3`, `ATLAS_S3_ENDPOINT`, `ATLAS_S3_REGION`, `ATLAS_S3_BUCKET`, `ATLAS_S3_ACCESS_KEY_ID`, and `ATLAS_S3_SECRET_ACCESS_KEY`.

Do not put secret values in source control, Vercel variables, frontend configuration, logs, documentation, or screenshots.

## Secret Formats

`ATLAS_INTEGRATION_SECRET_KEY` must contain exactly 64 hexadecimal characters, representing 32 random bytes.

Generate a new value without committing it:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`META_EMBEDDED_SIGNUP_STATE_HMAC_KEY` must be canonical base64url and decode to at least 32 bytes.

Generate a new value:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Store both only in the backend production environment.

## Meta Application Configuration

The Meta application used by Atlas must provide:

1. A valid Meta App ID.
2. The matching Meta App Secret.
3. A valid Embedded Signup configuration ID.
4. A supported Graph API version such as the version configured in `META_GRAPH_API_VERSION`.
5. WhatsApp webhook configuration compatible with the existing Atlas webhook endpoint and `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
6. The production app secret configured as `WHATSAPP_APP_SECRET` for webhook signature validation.

`META_APP_ID`, `META_APP_SECRET`, and `META_GRAPH_API_VERSION` form one backend provider configuration. Configure all three together. Atlas rejects partial provider configuration.

`META_EMBEDDED_SIGNUP_CONFIG_ID` is public configuration and may be sent to the authenticated portal. `META_APP_SECRET` must never be sent to the browser.

## Embedded Signup Lifecycle

1. An authenticated Atlas user starts Embedded Signup.
2. Atlas creates a tenant-scoped signup attempt with a short lifetime.
3. The browser receives only the raw transient state needed for the Meta flow.
4. Atlas stores only keyed digests for state and completion-code authority.
5. The browser returns the transient authorization code and Meta asset hints to Atlas.
6. The backend exchanges the authorization code with Meta.
7. The backend verifies the WABA and phone-number assets.
8. Atlas reserves a durable `inc_*` Integration Connection identifier.
9. The Meta access token is encrypted with `ATLAS_INTEGRATION_SECRET_KEY`.
10. Atlas validates the Integration Connection against Meta.
11. Atlas atomically creates or reconnects the `wac_*` WhatsApp Connection and links it to the Integration Connection.
12. Atlas checks the WABA `subscribed_apps` state.
13. If required, Atlas subscribes the WABA and then performs a second observational check.
14. Only after confirmed subscription and provider validation does Atlas activate the WhatsApp connection.

A successful POST subscription response alone is not sufficient authority for activation. Atlas confirms the subscription observationally before readiness.

## Reconnect And Recovery

Embedded Signup attempts are durable and tenant-scoped.

A completion retry with the same durable authority may resume without creating duplicate Integration Connections or WhatsApp Connections.

If Atlas has already exchanged credentials and persisted the encrypted Integration Connection secret, a retry can continue from durable server state.

If credentials cannot be recovered safely after an interrupted provider exchange, Atlas returns `reconnect_required` rather than guessing or accepting browser-provided credential authority.

Existing manually configured WhatsApp connections remain supported. Legacy/manual connections may have a null Integration Connection link until they are explicitly reconnected through Embedded Signup.

Atlas does not automatically unsubscribe the WABA when a WhatsApp connection is locally deactivated.

## Operational Audit

EPIC 042 emits structured operational events for safe correlation, including signup lifecycle, connection linking, confirmed WABA subscription, WhatsApp activation, and final readiness.

Operational events may contain safe identifiers such as:

- Workspace ID
- Company ID
- Signup attempt ID
- Integration Connection ID
- WhatsApp Connection ID
- Timestamp
- Whether Atlas performed the subscription mutation

They must never contain:

- OAuth authorization code
- Raw Embedded Signup state
- Meta access token
- App Secret
- Integration encryption key
- HMAC key
- Raw provider response body

Integration Connection create, validation, activation, and other durable lifecycle events continue using the existing append-only Integration Connection audit system.

## Render

Add all EPIC 042 backend variables to the Render service, never to Vercel.

After changing secrets or Meta configuration:

1. Redeploy the Render backend.
2. Confirm `/health`.
3. Confirm `/ready`.
4. Log in through the normal Vercel portal.
5. Start Meta Embedded Signup from the WhatsApp onboarding screen.
6. Complete the Meta flow.
7. Confirm Atlas reports WhatsApp as connected and ready.
8. Confirm no legacy WhatsApp credential row was created for the new Embedded Signup connection.
9. Send a real inbound WhatsApp message and confirm webhook routing reaches the linked connection.
10. Send an outbound response and confirm provider delivery succeeds.

## Media Storage Warning

Production media bytes are stored in private S3-compatible object storage. Cloudflare R2 is the initial supported target; Turso remains authoritative for media metadata and lifecycle.

`ATLAS_MEDIA_ROOT` and `LocalMediaStorage` are development/test/pre-hardening only. Production must not fall back to the local filesystem, and Render Persistent Disk is neither required nor recommended as canonical media storage.

## Smoke Test

Before considering Meta Embedded Signup operationally ready:

1. Confirm the authenticated portal exposes only App ID, Embedded Signup config ID, and Graph API version.
2. Start a fresh Embedded Signup attempt.
3. Complete Meta authorization.
4. Confirm exactly one durable Integration Connection is created.
5. Confirm its secret is encrypted and no plaintext access token is persisted.
6. Confirm exactly one WhatsApp Connection is linked to that Integration Connection.
7. Confirm no new legacy WhatsApp credential row exists.
8. Confirm Integration validation succeeds.
9. Confirm WABA subscription is observed as active.
10. Confirm both Integration Connection and WhatsApp Connection become active.
11. Repeat completion/readiness and confirm idempotent replay without duplicate durable records.
12. Exercise reconnect against an existing compatible WhatsApp connection.
13. Confirm asset changes fail closed instead of replacing the existing number.
14. Inspect logs and confirm no authorization code, raw state, access token, App Secret, provider body, encryption key, or HMAC key appears.

## Rotation

To rotate `ATLAS_INTEGRATION_SECRET_KEY`, a dedicated credential re-encryption procedure is required because existing encrypted Integration Connection secrets depend on the current key. Do not replace this key blindly in Render while production credentials exist.

`META_EMBEDDED_SIGNUP_STATE_HMAC_KEY` protects transient signup-attempt correlation. Rotating it invalidates outstanding Embedded Signup attempts. Rotate it only when it is acceptable for currently open attempts to restart.

Meta App Secret and other provider credentials should be rotated through the Meta console and Render environment without exposing the old or new values in logs or source control.
