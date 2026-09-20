import type { BackupVerificationService } from "./backupVerification.js";
import type { CompleteBackupManifest } from "./backupOrchestration.js";
import type { BackupObjectStorage } from "./s3BackupObjectStorage.js";
import type { RestoreTargetMediaStorage } from "./restoreTargetMediaStorage.js";
import type { DatabaseRecoveryProvider } from "./disasterRecovery.js";
import { createLibsqlDatabase, type SqlDatabase } from "../config/sqlDatabase.js";
import { DisasterRecoveryRepository, RestoredCredentialCompatibilityVerifier, type RestoredDatabaseVerificationConnection } from "./disasterRecovery.js";
import { normalizeOperationalError, operationalLogger } from "../observability/operationalLogger.js";
import type { RotationCipher } from "../security/credentialReencryptionMaintenance.js";

export interface RestoredMediaEntry { readonly storageReference:string;readonly sizeBytes:number;readonly contentType:string;readonly checksum:string; }
export interface RestoredDatabaseAccess { verify(migrationHead:string):Promise<void>;mediaInventory():Promise<readonly RestoredMediaEntry[]>;credentialCounts():Promise<{readonly credentialRowsChecked:number;readonly credentialRowsCompatible:number;readonly credentialRowsIncompatible:number}>; }
export interface RestoredDatabaseFactory { create(targetDatabase:string):Promise<RestoredDatabaseAccess>; }
interface VerificationRecoveryProvider extends DatabaseRecoveryProvider { createVerificationConnection(targetDatabase:string):Promise<RestoredDatabaseVerificationConnection>; }
/** Builds a short-lived, read-only data-plane client only after Turso has minted the target token. */
export class TursoRestoredDatabaseFactory implements RestoredDatabaseFactory { public constructor(private readonly recovery:VerificationRecoveryProvider,private readonly whatsApp:RotationCipher,private readonly integration:RotationCipher){} public async create(targetDatabase:string):Promise<RestoredDatabaseAccess>{const connection=await this.recovery.createVerificationConnection(targetDatabase);const database=createLibsqlDatabase(connection.url,connection.authToken);return new LibsqlRestoredDatabaseAccess(database,this.whatsApp,this.integration);} }
class LibsqlRestoredDatabaseAccess implements RestoredDatabaseAccess { public constructor(private readonly database:SqlDatabase,private readonly whatsApp:RotationCipher,private readonly integration:RotationCipher){} public async verify(migrationHead:string):Promise<void>{await new DisasterRecoveryRepository(this.database).verifyReadOnly(migrationHead);await this.database.query("SELECT encrypted_access_token FROM whatsapp_connection_credentials LIMIT 1");await this.database.query("SELECT encrypted_secret FROM integration_connection_secrets LIMIT 1");} public mediaInventory():Promise<readonly RestoredMediaEntry[]>{return restoredMediaInventory(this.database);} public credentialCounts(){return new RestoredCredentialCompatibilityVerifier(this.database,this.whatsApp,this.integration).verify();} }
export async function restoredMediaInventory(database:SqlDatabase):Promise<readonly RestoredMediaEntry[]>{const rows=await database.query<{storage_reference:string;sha256_digest:string;size_bytes:number;media_type:string}>("SELECT storage_reference,sha256_digest,size_bytes,media_type FROM media_blobs WHERE state='active' ORDER BY rowid");return rows.map(row=>Object.freeze({storageReference:row.storage_reference,sizeBytes:Number(row.size_bytes),contentType:row.media_type,checksum:row.sha256_digest}));}
export interface RestoreResult { readonly backupId:string;readonly targetDatabase:string;readonly restoreBucket:string;readonly migrationHead:string;readonly credentialRowsChecked:number;readonly credentialRowsCompatible:number;readonly credentialRowsIncompatible:number;readonly requiredMedia:number;readonly requiredMediaPresent:number;readonly requiredMediaMissing:number;readonly backupMediaOrphaned:number;readonly restoredMediaVerified:number;readonly verified:true; }
export class RestoreOrchestrationService {
  public constructor(private readonly verification:BackupVerificationService,private readonly manifest:(backupId:string)=>Promise<CompleteBackupManifest>,private readonly recovery:DatabaseRecoveryProvider,private readonly restored:RestoredDatabaseFactory,private readonly backup:BackupObjectStorage,private readonly target:RestoreTargetMediaStorage) {}
  public async restore(input:{readonly backupId:string;readonly targetDatabase:string;readonly liveBucket:string;readonly backupBucket:string;readonly restoreBucket:string}):Promise<RestoreResult>{
    const started=performance.now();operationalLogger.info("restore_started",{subsystem:"disaster_recovery",outcome:"started",backupId:input.backupId,targetDatabaseName:input.targetDatabase});
    try{
      const manifest=await this.manifest(input.backupId);
      if(input.targetDatabase===manifest.database.sourceDatabase||input.liveBucket===input.backupBucket||input.liveBucket===input.restoreBucket||input.backupBucket===input.restoreBucket)throw new Error("Restore isolation is invalid.");
      await this.verification.verify(input.backupId);
      await this.recovery.createPointInTimeRestore(manifest.database.sourceDatabase,input.targetDatabase,manifest.database.recoveryPoint);
      await this.recovery.verifyDatabaseExists(input.targetDatabase);
      operationalLogger.info("restore_database_created",{subsystem:"disaster_recovery",outcome:"completed",backupId:input.backupId,targetDatabaseName:input.targetDatabase});
      const database=await this.restored.create(input.targetDatabase);await database.verify(manifest.migrationHead);
      const credentials=await database.credentialCounts();if(credentials.credentialRowsIncompatible>0)throw new Error("Restore credential compatibility is invalid.");
      operationalLogger.info("restore_credentials_verified",{subsystem:"disaster_recovery",outcome:"completed",backupId:input.backupId,targetDatabaseName:input.targetDatabase});
      const required=await database.mediaInventory(),byReference=new Map(manifest.media.entries.map(entry=>[entry.originalStorageReference,entry]));
      const missing=required.filter(entry=>!byReference.has(entry.storageReference));const orphan=manifest.media.entries.filter(entry=>!required.some(media=>media.storageReference===entry.originalStorageReference));
      if(missing.length)throw new Error("Restore media reconciliation is invalid.");
      let copied=0;
      for(const media of required){const entry=byReference.get(media.storageReference)!;const source=await this.backup.get(entry.backupObjectKey,entry.expectedBytes);if(source.sizeBytes!==entry.expectedBytes)throw new Error("Restore media reconciliation is invalid.");await this.target.put(media.storageReference,source.body,source.sizeBytes,media.contentType,media.checksum);await this.target.verify(media.storageReference,media.sizeBytes);copied+=1;}
      operationalLogger.info("restore_media_completed",{subsystem:"disaster_recovery",outcome:"completed",backupId:input.backupId,targetDatabaseName:input.targetDatabase,mediaObjectCount:copied});
      const result=Object.freeze({backupId:input.backupId,targetDatabase:input.targetDatabase,restoreBucket:input.restoreBucket,migrationHead:manifest.migrationHead,credentialRowsChecked:credentials.credentialRowsChecked,credentialRowsCompatible:credentials.credentialRowsCompatible,credentialRowsIncompatible:credentials.credentialRowsIncompatible,requiredMedia:required.length,requiredMediaPresent:required.length,requiredMediaMissing:0,backupMediaOrphaned:orphan.length,restoredMediaVerified:copied,verified:true as const});
      operationalLogger.info("restore_verified",{subsystem:"disaster_recovery",outcome:"completed",backupId:input.backupId,targetDatabaseName:input.targetDatabase,mediaObjectCount:copied,durationMs:Math.round(performance.now()-started)});
      return result;
    }catch(error:unknown){operationalLogger.error("restore_failed",{subsystem:"disaster_recovery",outcome:"failed",backupId:input.backupId,targetDatabaseName:input.targetDatabase,safeErrorCategory:normalizeOperationalError(error),durationMs:Math.round(performance.now()-started)});throw error;}
  }
}
