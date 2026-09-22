# EPIC 014 Cloud Deployment

## Architecture

Production runs the Express service on Render and the React portal on Vercel. Render uses Turso through the libSQL client; it does not use its local filesystem for Atlas data. Local development and automated tests keep using `node:sqlite` databases.

`DATABASE_PROVIDER=libsql` is mandatory when `NODE_ENV=production`. Startup fails before serving traffic when the provider, Turso URL, or Turso token is absent or invalid. Migrations use the existing `schema_migrations` table, never `PRAGMA user_version`.

Keep the portal same-origin by configuring a Vercel `/api/:path*` rewrite to the Render URL. This preserves the existing CSRF and Fetch Metadata protections. Do not point `VITE_ATLAS_API_BASE_URL` directly at Render for the authenticated portal.

## Local Development

1. Run `npm install` in `backend` and `frontend`.
2. Set local provider secrets only in untracked `backend/.env`.
3. Run `npm run dev` in `backend`.
4. Run `npm run dev` in `frontend`.
5. The Vite proxy routes `/api` to `http://localhost:3000`; local SQLite is created under `database/`.

## Turso

1. Install and authenticate the Turso CLI: `turso auth login`.
2. Create the production database: `turso db create atlas-production`.
3. Obtain its URL: `turso db show atlas-production --url`.
4. Create a token without printing or committing it: `turso db tokens create atlas-production`.
5. Store the URL and token only in Render environment variables. Do not put them in source, `.env.example`, logs, or Vercel.
6. For a fresh database, deploy Render once. Atlas applies `schema_migrations` on startup.
7. Confirm readiness from an authenticated shell: `curl -fsS https://YOUR-RENDER-HOST/ready`.

## Existing SQLite Import

1. Stop local Atlas writes before exporting.
2. Export the local file: `sqlite3 database/atlas.sqlite ".dump" > atlas-export.sql`.
3. Create a backup copy outside the repository before importing.
4. Import once: `turso db shell atlas-production < atlas-export.sql`.
5. Verify application rows without secrets, for example: `turso db shell atlas-production "SELECT 'companies', COUNT(*) FROM companies UNION ALL SELECT 'workspaces', COUNT(*) FROM workspaces UNION ALL SELECT 'knowledge_versions', COUNT(*) FROM company_knowledge_versions;"`.
6. Start Render and call `/ready`. Do not run an automatic local-to-cloud import during application startup.

The import includes `schema_migrations`, tenant records, Knowledge versions/publications, profiles, identity data, sessions, and all related tables. Importing the same dump twice is not idempotent; restore/import only into a freshly created Turso database or a database intentionally replaced from backup.

## Render

1. Create a Render Web Service from this GitHub repository and select the current branch.
2. Render discovers `render.yaml`; confirm root directory `backend`, build command `npm ci && npm run build`, start command `npm start`, and health check `/ready`. `/health` is liveness only; Render must gate deployment on readiness.
3. Render-managed values must satisfy `backend/src/config/productionConfiguration.ts`. Core configuration is `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ATLAS_VERIFICATION_ORIGIN`, and `ATLAS_BOOTSTRAP_SECRET`. Configure delivery credentials only for the selected `EMAIL_PROVIDER`/`ATLAS_VERIFICATION_DELIVERY`; configure WhatsApp, integrations, Meta, Billing, Gemini, and Firecrawl only when those providers are enabled. `render.yaml` tracks variable names, not secret values.
4. Set non-secret variables: `NODE_ENV=production` and `DATABASE_PROVIDER=libsql`.
5. Set `ATLAS_VERIFICATION_ORIGIN` to the final HTTPS Vercel origin, for example `https://atlas-portal.vercel.app`.
6. Set `ATLAS_ALLOWED_ORIGINS` to that same exact origin. Multiple explicit origins are comma-separated only when required.
7. Deploy, then check `https://YOUR-RENDER-HOST/health` and `https://YOUR-RENDER-HOST/ready`.

`ATLAS_BOOTSTRAP_SECRET` must be a unique secret of at least 32 characters. It authorizes the one-time initial platform claim and must never be sent to browsers, logs, or email. SMTP values configure Nodemailer: `SMTP_SECURE=true` normally uses port 465; `SMTP_SECURE=false` normally uses port 587. `SMTP_FROM` and `SMTP_REPLY_TO` are the sender and support reply address. For Google Apps Script, set `EMAIL_PROVIDER=google_apps_script`, `GOOGLE_APPS_SCRIPT_URL` to the HTTPS endpoint, `GOOGLE_APPS_SCRIPT_TOKEN` to the shared secret, and `EMAIL_TIMEOUT` for the request timeout in milliseconds. The backend sends a JSON payload with `authToken`, `to`, `subject`, `html`, and `text`; the Web App compares `authToken` with a Script Property and must return JSON `{ "ok": true }` for success. The endpoint must not be used without a shared secret, and secrets must never be committed to Git. Production startup fails only for invalid core configuration or an enabled provider's invalid configuration.

Render free services can sleep after inactivity and their local filesystem is ephemeral. Atlas production data is therefore only in Turso. The first request after sleep can be slow.

## Production Media Durability

The existing production media-flow switch is the complete WhatsApp webhook pair: `WHATSAPP_APP_SECRET` and `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. It enables the webhook router and required WhatsApp recovery worker, including inbound media recovery. When that pair is configured, startup requires valid durable S3 media storage. It fails before database initialization or migrations if storage is absent or invalid.

When durable media storage is unavailable, production runs in zero-media mode: inbound media recovery is not executed and voice playback is not registered. Non-media recovery and persisted outbound delivery remain operational. Startup and readiness remain healthy with `UnavailableMediaStorage`, and Atlas never falls back to local storage or SQLite blobs. When any one of `ATLAS_MEDIA_STORAGE_PROVIDER`, `ATLAS_S3_ENDPOINT`, `ATLAS_S3_REGION`, `ATLAS_S3_BUCKET`, `ATLAS_S3_ACCESS_KEY_ID`, or `ATLAS_S3_SECRET_ACCESS_KEY` is set, all must be valid: use `ATLAS_MEDIA_STORAGE_PROVIDER=s3`, an HTTPS `ATLAS_S3_ENDPOINT`, non-empty `ATLAS_S3_REGION`, valid `ATLAS_S3_BUCKET`, `ATLAS_S3_ACCESS_KEY_ID`, and `ATLAS_S3_SECRET_ACCESS_KEY`. `ATLAS_MEDIA_ROOT` is not used in production. Do not configure a filesystem path, public bucket, public object URLs, or Render Persistent Disk as a substitute. Atlas retains media metadata and authorization in Turso; S3-compatible storage holds bytes only.

The live-media credential requires private server-side `PutObject`, `GetObject`, and `DeleteObject` access restricted to the Atlas media prefix. The S3-compatible provider must honor `PutObject` with `If-None-Match: *` atomically: Atlas uses it to create final media objects without overwriting a colliding key. Future bounded orphan reconciliation also requires `ListBucket`/`ListObjectsV2` restricted to that prefix; do not grant broad bucket listing. Atlas uses a 30-second abort deadline and at most two AWS SDK attempts per media operation. It explicitly freezes `forcePathStyle=false`: path-style addressing is not forced and the AWS SDK endpoint resolver determines the effective request form. Before production, validate the selected provider's actual bucket addressing, DNS, TLS, and conditional-put behavior because Atlas provides no addressing-mode environment override. No startup network probe is performed.

## Vercel

1. Import the same GitHub repository as a Vercel project with root directory `frontend`.
2. Use build command `npm run build` and output directory `dist`.
3. Leave `VITE_ATLAS_API_BASE_URL` unset so the browser uses `/api`.
4. In Vercel Project Settings, add this rewrite after the Render URL exists: source `/api/:path*`, destination `https://YOUR-RENDER-HOST/:path*`.
5. Redeploy the portal after adding the rewrite.
6. Do not expose `TURSO_AUTH_TOKEN`, Gemini, Firecrawl, or any backend secret in Vercel variables.

## Smoke Test

1. Before regular registration, obtain `GET /identity/bootstrap/status` through the same origin. If it returns `{"initialized":false}`, call `POST /identity/bootstrap` exactly once from a trusted operator tool with `x-atlas-bootstrap-secret`, the administrator email, locale, password, and confirmation. Confirm it returns `201`, an authenticated session cookie, and then `{"initialized":true}`. Remove the secret from the operator tool after use.
2. Open the Vercel HTTPS URL and register/login using the normal portal flow. Confirm verification, credential enrollment, and workspace invitation emails arrive through SMTP.
2. Create a Workspace and Company, then ingest and publish Knowledge.
3. Create a ready Assistant Profile and execute an operational request.
4. Record the Company name and published Knowledge version.
5. Trigger a Render redeploy or wait for an idle restart.
6. Log in again and verify the same Company, Knowledge publication, and Profile remain.
7. Confirm `/ready` returns `{"status":"ready","database":"available"}`.

## Backup, Rollback, And Rotation

- Export before risky changes with `turso db shell atlas-production ".dump" > atlas-backup.sql`, store it encrypted outside this repository, and verify its row counts.
- Roll back application code by redeploying the prior GitHub revision. Database migrations are additive; do not delete migration records or modify historical migration SQL.
- To rotate a Turso token, create a new token, update Render, verify `/ready`, then revoke the old token in Turso.
- Rotate provider keys in their provider consoles and Render only. Never log secret values.
- Persisted WhatsApp and Integration credentials use versioned AES-GCM envelopes. To rotate a domain key, configure its active key ID/key and retain the prior `*_KEY` as the legacy v1 key or configure one previous key ID/key, deploy, run `npm run maintenance:reencrypt-credentials`, and confirm only count-only output reports zero legacy/previous envelopes. Remove retired material, redeploy, and verify `/health` and `/ready`. Runtime secrets, including R2/S3, webhook, billing, email, and AI credentials, remain deployment-managed: rotate with the provider, update Render, restart, verify, then retire the prior provider credential. Do not place secret values in commands, logs, or documentation.
- Production database recovery is Turso PITR, not a libSQL export or filesystem copy. Restore always creates a new Turso database at an operator-selected RFC3339 recovery point; verify it before manually updating deployment database configuration and redeploying. Retain the source database until explicit cleanup. PITR retention is plan-dependent and may have a recovery gap of up to 15 seconds immediately before the selected point. Media recovery requires a separate private, deletion-protected backup bucket and a completed Atlas DR manifest; never use public URLs or embed database, Turso, or S3 credentials in manifests.

## Free-Tier Limits

- Render free services sleep and have ephemeral disk.
- Turso and Vercel free tiers have request, storage, transfer, and policy limits that must be checked in their current dashboards before customer onboarding.
- Free tiers do not replace monitored backups or a future paid reliability plan.
