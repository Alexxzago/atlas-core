import { backupS3Configuration } from "../config/backupS3Configuration.js";
import { BackupVerificationService } from "../operations/backupVerification.js";
import { S3BackupObjectStorage } from "../operations/s3BackupObjectStorage.js";
const backupId=process.argv.slice(2).find((value,index,values)=>values[index-1]==="--backup-id");if(!backupId)throw new Error("--backup-id is required.");const migrationHead=process.env.ATLAS_MIGRATION_HEAD?.trim()??"0069_shared_rate_limit_windows";const result=await new BackupVerificationService(new S3BackupObjectStorage(backupS3Configuration()),migrationHead).verify(backupId);console.log(JSON.stringify(result));
