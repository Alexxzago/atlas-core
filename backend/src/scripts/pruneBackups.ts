import { backupS3Configuration } from "../config/backupS3Configuration.js";
import { CompleteBackupDiscoveryService } from "../operations/completeBackupDiscovery.js";
import { backupRetentionConfiguration, BackupRetentionService } from "../operations/backupRetention.js";
import { runPruneBackupsCommand } from "../operations/pruneBackupsCommand.js";
import { S3BackupObjectStorage } from "../operations/s3BackupObjectStorage.js";

const storage=new S3BackupObjectStorage(backupS3Configuration()),retention=backupRetentionConfiguration();
process.exitCode=await runPruneBackupsCommand(process.argv.slice(2),{discover:async()=>new CompleteBackupDiscoveryService(storage).discover(),prune:async(sets,activeBackupId)=>new BackupRetentionService(storage).prune(sets,retention,activeBackupId),write:value=>console.log(value.trimEnd())});
