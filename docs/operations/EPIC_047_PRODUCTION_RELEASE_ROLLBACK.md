# EPIC 047 Production Release And Rollback

This procedure supplements `EPIC_014_CLOUD_DEPLOYMENT.md` and the PASS8 DR runbook. Render is the backend deployment platform. Its configured health check is `/ready`, not liveness-only `/health`.

## Pre-Release Gate

From `C:\ATLAS\backend`, run:

```powershell
npm run verify:production-release
```

This executes `npx tsc --noEmit`, the backend build, EPIC047, EPIC046, and the full backend regression. The deployed frontend has existing gates and must run its established build and test commands before its own release:

```powershell
cd C:\ATLAS\frontend
npm run build
npm test
```

## Environment Checklist

Render-managed values contain secrets; `render.yaml` contains names only. Core service startup requires production libSQL/Turso, verification origin, and bootstrap secret. Durable media is unavailable when all live-media S3 variables are absent; when any live-media S3 variable is configured, the complete private S3 configuration is required. Configure email, WhatsApp, integration, Meta, billing, and AI values only when their capabilities are enabled.

DR maintenance additionally requires private backup and restore-target S3 configurations, Turso organization/platform/database/group values, and bounded retention values. Live, backup, and restore-target buckets must be distinct. Voice remains unavailable and requires no production voice provider configuration.

`ATLAS_DEPLOYMENT_VERSION` is optional safe release metadata. Use a bounded release string or commit SHA; never place a secret in it.

## Release Sequence

1. Confirm the release gate passes and identify the prior known-good Render release.
2. For schema- or data-risking releases, externally quiesce writes and create a verified PASS8 checkpoint:

```powershell
cd C:\ATLAS\backend
npm run maintenance:backup -- --writes-quiesced
npm run maintenance:verify-backup -- --backup-id <id>
```

3. Deploy the verified build to Render. Atlas applies additive migrations once through `schema_migrations` during application startup. Do not manually edit migration history and do not use destructive down-migrations.
4. Wait for Render `/ready` to return HTTP 200. A running process or `/health` response alone is not a healthy release.
5. Perform the smoke checks below before declaring the release healthy.

Atlas does not quiesce writes, run backups, restore data, or promote restored databases automatically.

## Smoke Checks

Use the deployed HTTPS origin from an authorized operator shell:

```powershell
curl -fsS https://YOUR-RENDER-HOST/health
curl -fsS https://YOUR-RENDER-HOST/ready
```

Expect liveness `online` and readiness `ready` with database `available`. Confirm release startup diagnostics identify migration head `0069_shared_rate_limit_windows` and the safe deployment version. Initialize an existing authenticated portal route only when an operator account already exists; do not create synthetic customer or tenant data. Voice being unavailable must not fail readiness.

## Rollback Decision

### Code-Only Failure

If the deployed schema remains compatible with the previous release, redeploy the known-good Render release, wait for `/ready`, and repeat smoke checks. Retain the current database and media.

### Schema Or Data Incident

Code rollback does not undo data or schema changes. Preserve the failed source. Follow `EPIC_047_BACKUP_RESTORE_DR.md` to restore an isolated Turso database from PITR, verify migration/integrity/credentials/media, and use the private restore-target bucket. Promotion or cutover is manual: first confirm `restore_verified`, application smoke checks, credential compatibility, media reconciliation, source retention, and a rollback path. Do not overwrite the source or automatically promote a restore.

## Release Failure Decision Tree

1. Build or verification gate fails: do not deploy.
2. Render process starts but `/ready` fails: do not declare healthy; inspect safe operational events and correct the dependency/configuration issue.
3. Compatible code regression: redeploy the known-good release and verify readiness.
4. Schema or data concern: stop promotion, retain source evidence, and use isolated PASS8 recovery. Use a forward fix or PITR recovery, never a destructive down-migration.
