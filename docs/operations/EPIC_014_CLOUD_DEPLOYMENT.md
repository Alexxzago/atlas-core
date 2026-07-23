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
2. Render discovers `render.yaml`; confirm root directory `backend`, build command `npm ci && npm run build`, start command `npm start`, and health check `/health`.
3. Add secret environment variables: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ATLAS_VERIFICATION_ORIGIN`, `ATLAS_BOOTSTRAP_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_REPLY_TO`, `GEMINI_API_KEY`, and `FIRECRAWL_API_KEY` when their features are enabled.
4. Set non-secret variables: `NODE_ENV=production` and `DATABASE_PROVIDER=libsql`.
5. Set `ATLAS_VERIFICATION_ORIGIN` to the final HTTPS Vercel origin, for example `https://atlas-portal.vercel.app`.
6. Set `ATLAS_ALLOWED_ORIGINS` to that same exact origin. Multiple explicit origins are comma-separated only when required.
7. Deploy, then check `https://YOUR-RENDER-HOST/health` and `https://YOUR-RENDER-HOST/ready`.

`ATLAS_BOOTSTRAP_SECRET` must be a unique secret of at least 32 characters. It authorizes the one-time initial platform claim and must never be sent to browsers, logs, or email. SMTP values configure Nodemailer: `SMTP_SECURE=true` normally uses port 465; `SMTP_SECURE=false` normally uses port 587. `SMTP_FROM` and `SMTP_REPLY_TO` are the sender and support reply address. Production startup fails if the bootstrap secret or any SMTP variable is missing or invalid.

Render free services can sleep after inactivity and their local filesystem is ephemeral. Atlas production data is therefore only in Turso. The first request after sleep can be slow.

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

## Free-Tier Limits

- Render free services sleep and have ephemeral disk.
- Turso and Vercel free tiers have request, storage, transfer, and policy limits that must be checked in their current dashboards before customer onboarding.
- Free tiers do not replace monitored backups or a future paid reliability plan.
