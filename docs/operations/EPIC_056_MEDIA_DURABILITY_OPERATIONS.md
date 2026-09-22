# EPIC 056 Durable Media Operations

## Production Configuration

Production media is optional only when no media-capable WhatsApp flow is enabled. A production WhatsApp webhook requires durable S3-compatible storage; Atlas fails closed rather than using local disk or SQLite as media storage.

Set `ATLAS_MEDIA_STORAGE_PROVIDER=s3` and all of:

- `ATLAS_S3_ENDPOINT` as an HTTPS endpoint.
- `ATLAS_S3_REGION`.
- `ATLAS_S3_BUCKET`.
- `ATLAS_S3_ACCESS_KEY_ID`.
- `ATLAS_S3_SECRET_ACCESS_KEY`.

The media IAM identity requires private-object `GetObject`, `PutObject`, `DeleteObject`, and `ListBucket` permissions, limited to the Atlas-owned `workspaces/<workspaceId>/companies/<companyId>/media/` prefix. Final object writes must support conditional create (`If-None-Match: *`); Atlas never overwrites a final object.

Google speech is optional. When enabled, the only credential input is `GOOGLE_CLOUD_SPEECH_SERVICE_ACCOUNT_JSON_B64`: Base64-encoded Google service-account JSON with the approved token URI. The service identity needs Cloud Text-to-Speech and Speech-to-Text access, plus token creation. Do not split its credentials into environment variables or log its JSON, JWTs, OAuth tokens, or Google responses.

## Backup And Restore Contract

SQL metadata and live S3 objects are one recoverable system. Use the existing private checkpoint process:

```powershell
cd C:\ATLAS\backend
npm run maintenance:backup -- --writes-quiesced
npm run maintenance:verify-backup -- --backup-id <backupId>
npm run maintenance:restore -- --backup-id <backupId> --target-database <isolated-name>
```

Quiesce writes before the checkpoint. The backup manifest records the Turso recovery point, migration head, active media inventory, object sizes, and SHA-256 checksums. Only a verified `complete` manifest is recoverable.

Restore order is fixed:

1. Verify the complete backup manifest and every backed-up media object.
2. Create and verify an isolated point-in-time SQL restore at the manifest recovery point.
3. Verify migration head and credential compatibility in the restored database.
4. Derive required media from restored SQL and copy checksum-verified objects to a separate restore-target bucket.
5. Verify every restored object before any manual smoke test or promotion decision.

Never combine an arbitrary SQL snapshot with a different object snapshot. If source snapshots are not perfectly aligned, restore only the complete manifest set. Metadata that points to an absent or corrupt object is not healthy: recovery marks the ready blob unavailable. Metadata-less owned objects remain candidates for cleanup only after 24 hours. Incomplete ingest and reclaim rows retain their durable evidence and are reconciled by the normal recovery cycle.

The restore target is isolated. It is not automatically promoted and the source database and live bucket are not modified. Rollback means retaining the source and discarding the isolated target; do not copy restored objects into the live prefix manually.

## Recovery Expectations

Each WhatsApp recovery cycle processes inbound media, Atlas media recovery, transcription, webhook resume, synthesis, Meta upload, then outbound dispatch. Voice uploads persist the Meta media ID before dispatch; an absent ID prevents audio send. The single voice recovery service is the only production scheduler for transcription, synthesis, and upload.

Common safe responses:

- Missing or corrupt ready object: the blob is marked unavailable; re-ingest or restore from a verified checkpoint.
- Incomplete ingest: recovery resumes only from durable staging/final evidence; otherwise it remains safely failed or retryable.
- Reclaim ambiguity: do not finalize metadata until storage deletion confirms absence; retry reconciliation.
- S3 authorization, timeout, or conditional-create collision: correct IAM/provider state, then let bounded recovery retry where appropriate.
- Speech or Meta provider failure: inspect safe structured events and retry through durable worker state. Never retry an uncertain outbound send as if it were unsent.

## Safe Operational Signals

Media lifecycle events are bounded structured records with only existing internal workspace/company identifiers and fixed categories. They contain no object keys, media bytes, credentials, provider bodies, JWTs, or tokens.

- Ingest: `media_ingest_reserved`, `media_ingest_staged`, `media_ingest_promoted`, `media_ingest_settled`, `media_ingest_retryable_failure`, `media_ingest_terminal_failure`.
- Reconciliation: `media_recovery_claimed`, `media_recovery_settled`, `media_recovery_failed`, `media_ready_object_missing`, `media_ready_object_corrupt`, `media_ready_object_unavailable`, `media_orphans_cleaned`.
- Reclaim: `media_reclaim_completed`, `media_reclaim_ambiguous`.
- Voice worker failures: `voice_transcription_failed`, `voice_synthesis_failed`, `voice_media_upload_failed`.

Existing disaster-recovery events in `EPIC_047_BACKUP_RESTORE_DR.md` remain authoritative for checkpoint, restore, and retention operations.
