import type { CompleteBackupManifest } from "./backupOrchestration.js";
import type { RetentionSet } from "./backupRetention.js";
import type { BackupObjectStorage } from "./s3BackupObjectStorage.js";

const pageSize=100,maximumPages=100,maximumManifestBytes=1_000_000;
const manifestKey=/^backups\/(bkp_[a-f0-9]{32})\/manifest\.json$/u;

/** Reads only final manifests from the private backup bucket. It never discovers work markers. */
export class CompleteBackupDiscoveryService {
  public constructor(private readonly storage:BackupObjectStorage) {}
  public async discover():Promise<readonly RetentionSet[]>{
    const sets:RetentionSet[]=[];let continuationToken:string|null=null;
    for(let page=0;page<maximumPages;page+=1){
      const listed=await this.storage.list("backups/",continuationToken,pageSize);
      for(const key of listed.keys){const match=manifestKey.exec(key);if(!match)continue;const set=await this.load(key,match[1]!);if(set)sets.push(set);}
      continuationToken=listed.continuationToken;if(!continuationToken)return Object.freeze(sets);
    }
    throw new Error("Complete backup discovery exceeded its bound.");
  }
  private async load(manifestKey:string,backupId:string):Promise<RetentionSet|null>{
    try{const object=await this.storage.get(manifestKey,maximumManifestBytes),manifest=JSON.parse(await text(object.body)) as CompleteBackupManifest;if(!complete(manifest,backupId))return null;return Object.freeze({backupId,createdAt:manifest.createdAt,manifestKey,mediaBackupObjectKeys:Object.freeze(manifest.media.entries.map(entry=>entry.backupObjectKey))});}catch{return null;}
  }
}
async function text(body:AsyncIterable<Uint8Array>):Promise<string>{const chunks:Uint8Array[]=[];for await(const chunk of body)chunks.push(chunk);return Buffer.concat(chunks).toString("utf8");}
function complete(manifest:CompleteBackupManifest,backupId:string):boolean{return !!manifest&&manifest.formatVersion===1&&manifest.backupId===backupId&&manifest.state==="complete"&&typeof manifest.createdAt==="string"&&!Number.isNaN(new Date(manifest.createdAt).getTime())&&Array.isArray(manifest.media?.entries)&&manifest.media.entries.every(entry=>typeof entry.backupObjectKey==="string"&&entry.backupObjectKey.startsWith(`backups/${backupId}/media/`));}
