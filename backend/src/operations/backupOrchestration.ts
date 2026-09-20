import { createHash, randomUUID } from "node:crypto";
import type { BackupObjectStorage } from "./s3BackupObjectStorage.js";

export interface BackupMediaEntry { readonly storageReference:string; readonly digest:string; readonly sizeBytes:number; readonly contentType:string; }
export interface CompleteBackupManifest { readonly formatVersion:1; readonly backupId:string; readonly createdAt:string; readonly applicationBuild:string; readonly migrationHead:string; readonly database:{readonly provider:"turso"; readonly mode:"pitr"; readonly sourceDatabase:string; readonly recoveryPoint:string}; readonly media:{readonly sourceBucket:string; readonly backupBucket:string; readonly objectCount:number; readonly totalBytes:number; readonly inventoryChecksum:string; readonly entries:readonly {readonly stableEntryId:string; readonly originalStorageReference:string; readonly contentType:string; readonly expectedBytes:number; readonly checksum:string; readonly backupObjectKey:string}[]}; readonly retention:{readonly retentionDays:number; readonly retentionUntil:string}; readonly state:"complete"; }
export interface LiveBackupMedia { inventory():Promise<readonly BackupMediaEntry[]>; read(reference:string,maximumBytes:number):Promise<AsyncIterable<Uint8Array>>; }

export class BackupOrchestrationService {
  public constructor(private readonly media:LiveBackupMedia, private readonly storage:BackupObjectStorage, private readonly now:()=>Date=()=>new Date()) {}
  public async create(input:{readonly writesQuiesced:boolean; readonly sourceDatabase:string; readonly migrationHead:string; readonly sourceBucket:string; readonly backupBucket:string; readonly applicationBuild:string; readonly retentionDays:number}):Promise<CompleteBackupManifest> {
    if (!input.writesQuiesced) throw new Error("Writes must be quiesced before creating a backup checkpoint.");
    if (input.sourceBucket===input.backupBucket || !Number.isSafeInteger(input.retentionDays) || input.retentionDays<1) throw new Error("Backup isolation or retention is invalid.");
    const backupId=`bkp_${randomUUID().replace(/-/gu,"")}`, createdAt=this.now().toISOString();
    await this.storage.put(`backup-work/${backupId}/started.json`,bytes("{}"),2,"application/json");
    try {
      const entries=await this.media.inventory(), manifestEntries:Array<CompleteBackupManifest["media"]["entries"][number]>=[];
      for (let index=0; index<entries.length; index+=1) {
        const entry=entries[index]!, stableEntryId=`entry_${String(index).padStart(8,"0")}`, backupObjectKey=`backups/${backupId}/media/${stableEntryId}`;
        await this.copyChecked(backupObjectKey,entry);
        manifestEntries.push(Object.freeze({stableEntryId,originalStorageReference:entry.storageReference,contentType:entry.contentType,expectedBytes:entry.sizeBytes,checksum:entry.digest,backupObjectKey}));
      }
      const inventoryChecksum=checksum(manifestEntries);
      await this.storage.put(`backup-work/${backupId}/media-complete.json`,bytes("{}"),2,"application/json");
      const complete=Object.freeze({formatVersion:1 as const,backupId,createdAt,applicationBuild:input.applicationBuild,migrationHead:input.migrationHead,database:{provider:"turso" as const,mode:"pitr" as const,sourceDatabase:input.sourceDatabase,recoveryPoint:createdAt},media:{sourceBucket:input.sourceBucket,backupBucket:input.backupBucket,objectCount:manifestEntries.length,totalBytes:manifestEntries.reduce((sum,entry)=>sum+entry.expectedBytes,0),inventoryChecksum,entries:Object.freeze(manifestEntries)},retention:{retentionDays:input.retentionDays,retentionUntil:new Date(new Date(createdAt).getTime()+input.retentionDays*86_400_000).toISOString()},state:"complete" as const});
      const serialized=JSON.stringify(complete);
      await this.storage.put(`backups/${backupId}/manifest.json`,bytes(serialized),Buffer.byteLength(serialized),"application/json");
      return complete;
    } catch (error:unknown) {
      await this.storage.put(`backup-work/${backupId}/failed.json`,bytes("{}"),2,"application/json").catch(()=>undefined);
      throw error;
    }
  }
  private async copyChecked(key:string, entry:BackupMediaEntry):Promise<void> {
    const source=await this.media.read(entry.storageReference,entry.sizeBytes);
    let actual:string|null=null;
    const checked=(async function*():AsyncGenerator<Uint8Array>{
      const hash=createHash("sha256"); let bytesRead=0;
      for await (const chunk of source) { if (!(chunk instanceof Uint8Array)) throw new Error("Backup media stream is invalid."); bytesRead+=chunk.byteLength; hash.update(chunk); yield chunk; }
      if (bytesRead!==entry.sizeBytes) throw new Error("Backup media integrity is invalid.");
      actual=hash.digest("hex");
      if (actual!==entry.digest) throw new Error("Backup media integrity is invalid.");
    })();
    await this.storage.put(key,checked,entry.sizeBytes,entry.contentType,entry.digest);
    if (actual!==entry.digest) throw new Error("Backup media integrity is invalid.");
  }
}

function bytes(value:string):AsyncIterable<Uint8Array>{return (async function*(){yield Buffer.from(value);})();}
function checksum(entries:readonly CompleteBackupManifest["media"]["entries"][number][]):string{return createHash("sha256").update(entries.map(entry=>`${entry.stableEntryId}:${entry.originalStorageReference}:${entry.expectedBytes}:${entry.checksum}:${entry.backupObjectKey}`).join("\n")).digest("hex");}
