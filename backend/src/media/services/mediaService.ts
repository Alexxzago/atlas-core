import { createHash, randomUUID } from "node:crypto";
import type { MediaAssociationOwnerResolver, MediaInspectorPort, MediaRepositoryPort, MediaStoragePort } from "../application/ports.js";
import { canonicalMetadata, mediaKind, safeFilename, safeMetadata, MediaDomainError, type MediaAsset, type MediaAssociation, type MediaAssociationOwnerType, type MediaBlob, type MediaMetadataValue } from "../domain/media.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export interface StoreMediaInput { readonly operation: "ingest"; readonly idempotencyKey: string; readonly declaredMediaType: string; readonly filename?: string; readonly metadata?: Readonly<Record<string, MediaMetadataValue>>; readonly content: AsyncIterable<Uint8Array>; }

export class MediaService {
  public constructor(private readonly repository: MediaRepositoryPort, private readonly storage: MediaStoragePort, private readonly inspector: MediaInspectorPort, private readonly owners: MediaAssociationOwnerResolver, private readonly clock: { now(): string }) {}
  public async store(context: WorkspaceContext, companyId: number, input: StoreMediaInput): Promise<MediaAsset> {
    const filename=safeFilename(input.filename), metadata=safeMetadata(input.metadata), mediaType=normalizeType(input.declaredMediaType), kind=mediaKind(mediaType), now=this.clock.now(), assetId=id("mas"),candidateId=id("mbl"); let staged: Awaited<ReturnType<MediaStoragePort["stage"]>> | undefined; let promoted: string | undefined; let reservedAssetId: string | undefined;
    try {
      staged=await this.storage.stage(candidateId,input.content);
      const fingerprint=createHash("sha256").update(JSON.stringify({kind,mediaType,filename,metadata:canonicalMetadata(metadata),digest:staged.digest,sizeBytes:staged.sizeBytes})).digest("hex");
      const reserved=this.repository.reserve(context,companyId,input.operation,key(input.idempotencyKey),fingerprint,{id:assetId,workspaceId:context.workspaceId,companyId,kind,mediaType,sizeBytes:null,filename,metadata,status:"pending",createdAt:now,archivedAt:null,deletedAt:null},now);
      if(reserved.kind==="same"){await this.storage.delete(staged.temporaryReference);return reserved.asset;}
      if(reserved.kind==="in_progress")throw new MediaDomainError("media_idempotency_in_progress");
      if(reserved.kind==="divergent")throw new MediaDomainError("media_idempotency_conflict");
      reservedAssetId=reserved.asset.id;
      const bytes=await this.storage.readTemporary(staged.temporaryReference,staged.sizeBytes);
      const inspected=this.inspector.inspect(bytes);
      if(inspected.mediaType!==mediaType)throw new MediaDomainError("media_type_mismatch");
      safeMetadata(inspected.metadata);
      promoted=await this.storage.promote(staged.temporaryReference,candidateId);
      const existing=this.repository.findBlob(context,companyId,staged.digest,staged.sizeBytes,inspected.mediaType);
      if(existing){await this.storage.delete(promoted);promoted=undefined;}
      const complete=this.repository.complete(context,companyId,reservedAssetId,{id:candidateId,workspaceId:context.workspaceId,companyId,digest:staged.digest,sizeBytes:staged.sizeBytes,mediaType:inspected.mediaType,storageReference:promoted??candidateId,state:"active",createdAt:this.clock.now()},this.clock.now());
      if(!complete)throw new MediaDomainError("media_completion_conflict");
      const canonical=this.repository.findBlob(context,companyId,staged.digest,staged.sizeBytes,inspected.mediaType);
      if(promoted&&canonical?.id!==candidateId){await this.storage.delete(promoted);promoted=undefined;}
      return complete;
    } catch(error:unknown) { if(staged&&!promoted)await this.storage.delete(staged.temporaryReference).catch(()=>undefined);if(promoted)await this.storage.delete(promoted).catch(()=>undefined);if(reservedAssetId)this.repository.fail(context,companyId,reservedAssetId,error instanceof MediaDomainError?error.code:"media_storage_failed",this.clock.now());throw error; }
  }
  public attach(context:WorkspaceContext,companyId:number,assetId:string,type:MediaAssociationOwnerType,ownerId:string):MediaAssociation { const now=this.clock.now(),association=this.repository.createAssociation(context,{id:id("maa"),assetId,workspaceId:context.workspaceId,companyId,ownerType:type,ownerId,createdAt:now},now,()=>this.owners.owns(context,companyId,type,ownerId));if(!association)throw new MediaDomainError("media_not_associable");return association; }
  public archive(context:WorkspaceContext,companyId:number,assetId:string):MediaAsset { const value=this.repository.archive(context,companyId,assetId,this.clock.now());if(!value)throw new MediaDomainError("media_not_found");return value; }
  public async delete(context:WorkspaceContext,companyId:number,assetId:string):Promise<MediaAsset> { const outcome=this.repository.delete(context,companyId,assetId,this.clock.now());if(!outcome)throw new MediaDomainError("media_not_found");if(outcome.reclaim){await this.storage.delete(outcome.reclaim.storageReference);this.repository.finalizeReclaim(context,companyId,outcome.reclaim.id,this.clock.now());}return outcome.asset; }
  public async sweepPendingReclaims(context:WorkspaceContext,companyId:number):Promise<void>{for(const blob of this.repository.listPendingReclaims(context,companyId)){await this.storage.delete(blob.storageReference);this.repository.finalizeReclaim(context,companyId,blob.id,this.clock.now());}}
  public async open(context:WorkspaceContext,companyId:number,assetId:string):Promise<Uint8Array> { const value=this.repository.open(context,companyId,assetId);if(!value)throw new MediaDomainError("media_not_found");const bytes=await this.storage.read(value.storageReference,value.sizeBytes);const digest=createHash("sha256").update(bytes).digest("hex");if(digest!==value.digest)throw new MediaDomainError("media_integrity_invalid");return bytes; }
}
function id(prefix:string):string{return `${prefix}_${randomUUID().replace(/-/gu,"")}`;}
function key(value:string):string{const result=value.trim();if(!result||result.length>200)throw new MediaDomainError("media_idempotency_invalid");return result;}
function normalizeType(value:string):string{const result=value.toLowerCase().split(";",1)[0]!.trim();if(!result||mediaKindSafe(result)===null)throw new MediaDomainError("media_type_unsupported");return result;}
function mediaKindSafe(value:string):string|null{return ["application/pdf","image/jpeg","image/png","image/gif","image/webp"].includes(value)?value:null;}
