# EPIC 047 Backup, Restore, And Disaster Recovery

## Preconditions

Configure production Turso organization, database, and database group values, plus the private backup S3 configuration. The live media bucket, backup bucket, and restore-target bucket must be separate private buckets. Configure the existing PASS7 WhatsApp and integration credential decryptors before restore verification. Never place secrets in commands, logs, or this document.

## Backup

```powershell
cd C:\ATLAS\backend
npm run maintenance:backup -- --writes-quiesced
```

The operator must externally quiesce writes first. Atlas does not freeze writes automatically. A final immutable `backups/<backupId>/manifest.json` is published only after the checkpoint media copy succeeds.

## Verify Backup

```powershell
npm run maintenance:verify-backup -- --backup-id <id>
```

Successful verification reports the complete backup ID and safe aggregate media counts. Failure returns a generic maintenance failure and must be investigated through safe operational events, never provider output.

## Restore

```powershell
npm run maintenance:restore -- --backup-id <id> --target-database <name>
```

Restore creates an isolated Turso database and leaves the source intact. A temporary 10-minute read-only verification token remains in memory only. Atlas verifies the migration head, integrity, required tables, and credential decryption compatibility. Media is copied to the restore-target bucket using `originalStorageReference`; neither live database nor live media is modified. There is no automatic promotion.

## Prune

```powershell
npm run maintenance:prune-backups
npm run maintenance:prune-backups -- --active-backup-id <id>
```

`ATLAS_BACKUP_RETENTION_DAYS` is bounded to 1..3650 and `ATLAS_BACKUP_MIN_COMPLETE_SETS` to 1..100. The newest complete set, configured minimum complete sets, young sets, and an asserted active restore source are protected. Discovery is bounded and paginated. Bucket-Lock failures retain affected objects and their manifest. Media objects are deleted before the final manifest.

## Recovery And Promotion

Promotion or cutover is manual and outside PASS8 automation. Before any external promotion, confirm:

- `restore_verified` was observed.
- Application smoke checks passed.
- Credential compatibility passed.
- Media reconciliation passed.
- The source remains retained.
- A rollback path is identified.

## Failure Handling

For a backup checkpoint failure, keep writes quiesced only as required by the operator process, inspect the safe failed event, and retry after correcting the external cause. For restore database creation failure, retain the source and choose a new isolated target only after correcting configuration. For credential incompatibility or media mismatch, do not promote; correct decryption configuration or restore data and rerun verification. For Bucket Lock prune prevention, retain the set until its retention policy permits deletion. Do not use destructive shortcuts.

## Observability

Canonical events added for PASS8:

- `backup_checkpoint_started`
- `backup_checkpoint_completed`
- `backup_checkpoint_failed`
- `restore_started`
- `restore_database_created`
- `restore_credentials_verified`
- `restore_media_completed`
- `restore_verified`
- `restore_failed`
- `backup_retention_pruned`
