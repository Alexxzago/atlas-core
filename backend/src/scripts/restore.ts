import { runRestoreCommand } from "../operations/restoreCommand.js";
import { backupS3Configuration, restoreS3Configuration } from "../config/backupS3Configuration.js";
import { s3MediaStorageConfiguration } from "../config/s3MediaStorageConfiguration.js";
import { tursoManagementConfiguration, TursoPlatformDatabaseRecoveryProvider } from "../operations/disasterRecovery.js";
import { BackupVerificationService } from "../operations/backupVerification.js";
import { S3BackupObjectStorage } from "../operations/s3BackupObjectStorage.js";
import { S3RestoreTargetMediaStorage } from "../operations/restoreTargetMediaStorage.js";
import { RestoreOrchestrationService } from "../operations/restoreOrchestration.js";
import { TursoRestoredDatabaseFactory } from "../operations/restoreOrchestration.js";
import { AesGcmWhatsAppCredentialCipher, whatsAppCredentialCipherFromEnvironment } from "../whatsapp/infrastructure/aesGcmWhatsAppCredentialCipher.js";
import { integrationSecretCipherRingFromEnvironment } from "../integrations/infrastructure/aesGcmIntegrationSecretCipher.js";

const backupConfiguration=backupS3Configuration(),restoreConfiguration=restoreS3Configuration(),liveConfiguration=s3MediaStorageConfiguration(),recovery=new TursoPlatformDatabaseRecoveryProvider(tursoManagementConfiguration()),backup=new S3BackupObjectStorage(backupConfiguration),restore=new S3RestoreTargetMediaStorage(restoreConfiguration),verification=new BackupVerificationService(backup,"0069_shared_rate_limit_windows"),integration=integrationSecretCipherRingFromEnvironment(),whatsApp=whatsAppCredentialCipherFromEnvironment(process.env,true);if(!integration||!(whatsApp instanceof AesGcmWhatsAppCredentialCipher))throw new Error("Restore credential configuration is invalid.");const restored=new TursoRestoredDatabaseFactory(recovery,whatsApp,integration);
process.exitCode=await runRestoreCommand(process.argv.slice(2),{restore:async input=>new RestoreOrchestrationService(verification,backupId=>verification.load(backupId),recovery,restored,backup,restore).restore({...input,liveBucket:liveConfiguration.bucket,backupBucket:backupConfiguration.bucket,restoreBucket:restoreConfiguration.bucket}),write:value=>console.log(value.trimEnd())});
