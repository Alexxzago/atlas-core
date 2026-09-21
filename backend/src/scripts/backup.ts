import { createProductionDatabase } from "../config/database.js";
import { s3MediaStorageConfiguration } from "../config/s3MediaStorageConfiguration.js";
import { backupS3Configuration } from "../config/backupS3Configuration.js";
import { S3MediaStorage } from "../media/infrastructure/s3MediaStorage.js";
import { BackupOrchestrationService } from "../operations/backupOrchestration.js";
import { S3BackupObjectStorage } from "../operations/s3BackupObjectStorage.js";
import { runBackupCommand } from "../operations/backupCommand.js";
import { migrationHead } from "../config/migrations.js";

if(!process.argv.includes("--writes-quiesced"))throw new Error("--writes-quiesced is required.");
const database=await createProductionDatabase(),liveConfiguration=s3MediaStorageConfiguration(),backupConfiguration=backupS3Configuration();
const live=new S3MediaStorage(liveConfiguration);
const media={async inventory(){return(await database.query<{storage_reference:string;sha256_digest:string;size_bytes:number;media_type:string}>("SELECT storage_reference,sha256_digest,size_bytes,media_type FROM media_blobs WHERE state='active' ORDER BY rowid")).map(row=>({storageReference:row.storage_reference,digest:row.sha256_digest,sizeBytes:Number(row.size_bytes),contentType:row.media_type}));},async read(reference:string,maximumBytes:number){const value=await live.read(reference,maximumBytes);return(async function*(){yield value;})();}};
try{process.exitCode=await runBackupCommand(process.argv.slice(2),{buckets:{live:liveConfiguration.bucket,backup:backupConfiguration.bucket},run:async()=>new BackupOrchestrationService(media,new S3BackupObjectStorage(backupConfiguration)).create({writesQuiesced:true,sourceDatabase:process.env.TURSO_DATABASE_NAME?.trim()??"",migrationHead:migrationHead.name,sourceBucket:liveConfiguration.bucket,backupBucket:backupConfiguration.bucket,applicationBuild:process.env.ATLAS_BUILD?.trim()??"unknown",retentionDays:Number(process.env.ATLAS_BACKUP_RETENTION_DAYS??"30")}),write:value=>console.log(value.trimEnd())});}finally{await database.close();}
