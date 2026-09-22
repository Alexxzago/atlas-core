import { createHash, randomUUID } from "node:crypto";
import type { MediaRepositoryPort, MediaStoragePort } from "../application/ports.js";
import { MediaDomainError, MediaStorageError, type MediaBlob, type MediaIngestAttempt } from "../domain/media.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import { operationalLogger } from "../../observability/operationalLogger.js";

export interface MediaRecoveryOptions { readonly owner: string; readonly limit: number; readonly leaseMilliseconds: number; }

/** Bounded, lease-safe reconciliation of durable ingest attempts. */
export class MediaRecoveryService {
  public constructor(private readonly repository: MediaRepositoryPort, private readonly storage: MediaStoragePort, private readonly clock: { now(): string }) {}

  public async recover(context: WorkspaceContext, companyId: number, options: MediaRecoveryOptions): Promise<number> {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100 || !options.owner || options.owner.length > 100 || !Number.isInteger(options.leaseMilliseconds) || options.leaseMilliseconds < 1) throw new Error("Invalid media recovery options.");
    const now=this.clock.now(),token=`mlt_${randomUUID().replace(/-/gu,"")}`,expiresAt=new Date(Date.parse(now)+options.leaseMilliseconds).toISOString(),attempts=await this.repository.leaseIncomplete(context,companyId,options.owner,token,now,expiresAt,options.limit);
    if(attempts.length)operationalLogger.info("media_recovery_claimed",fields(context,companyId,"recovery","claimed",{mediaObjectCount:attempts.length}));
    for (const attempt of attempts) await this.recoverAttempt(context,companyId,options.owner,token,attempt);
    await this.reconcileReady(context,companyId,options.limit);
    await this.reconcileReclaims(context,companyId,options.owner,token,now,expiresAt,options.limit);
    await this.cleanupOrphans(context,companyId,options.limit);
    return attempts.length;
  }
  public async recoverAvailable(owner: string, limit = 20, leaseMilliseconds = 60_000): Promise<number> { let recovered=0;for(const scope of await this.repository.listRecoveryScopes(limit)){recovered+=await this.recover({workspaceId:scope.workspaceId,workspaceKey:scope.workspaceKey},scope.companyId,{owner,limit,leaseMilliseconds});}return recovered; }

  public async reconcileReclaims(context: WorkspaceContext, companyId: number, owner: string, token: string, now: string, expiresAt: string, limit: number): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid media reclaim limit.");
    let completed=0;
    for (const blob of await this.repository.leaseReclaims(context,companyId,owner,token,now,expiresAt,limit)) {
      try { const result=await this.storage.delete(blob.storageReference); if (result.status === "absent" && await this.repository.finalizeLeasedReclaim(context,companyId,blob.id,owner,token,this.clock.now())) { completed+=1; operationalLogger.info("media_reclaim_completed",fields(context,companyId,"reclaim","completed")); } else operationalLogger.warn("media_reclaim_ambiguous",fields(context,companyId,"reclaim","ambiguous")); }
      catch(error:unknown){operationalLogger.warn("media_reclaim_ambiguous",fields(context,companyId,"reclaim","failed",{safeErrorCategory:category(error)}));throw error;}
    }
    return completed;
  }

  private async reconcileReady(context: WorkspaceContext, companyId: number, limit: number): Promise<void> { for(const value of await this.repository.listReadyBlobs(context,companyId,limit)){try{await this.exactBlob(value);}catch(error:unknown){const failure=category(error),event=failure==="integrity"?"media_ready_object_corrupt":failure==="not_found"?"media_ready_object_missing":"media_ready_object_unavailable";await this.repository.markBlobUnavailable(context,companyId,value.id,failure,this.clock.now());operationalLogger.warn(event,fields(context,companyId,"ready_reconciliation","failed",{safeErrorCategory:failure}));}} }
  /** 24 hours is the initial operational safety threshold for metadata-less owned objects. */
  private async cleanupOrphans(context: WorkspaceContext, companyId: number, limit: number): Promise<void> { const cutoff=Date.now()-24*60*60*1000;let deleted=0;for(const value of await this.storage.listOwned({workspaceId:context.workspaceId,companyId},limit)){if(Date.parse(value.createdAt)>cutoff||await this.repository.referencesStorage(context,companyId,value.reference))continue;await this.storage.delete(value.reference);deleted+=1;}if(deleted)operationalLogger.info("media_orphans_cleaned",fields(context,companyId,"orphan_cleanup","completed",{mediaObjectCount:deleted})); }

  private async recoverAttempt(context: WorkspaceContext, companyId: number, owner: string, token: string, attempt: MediaIngestAttempt): Promise<void> {
    try {
      const final=await this.exact(attempt.finalStorageReference,attempt);
      if (attempt.state === "retryable_failure" && !await this.repository.markRecoveryPromoted(context,companyId,attempt.assetId,owner,token,this.clock.now())) return;
      const settled=await this.repository.settleRecovery(context,companyId,attempt.assetId,owner,token,blob(context,companyId,attempt),this.clock.now());if(settled)operationalLogger.info("media_recovery_settled",fields(context,companyId,"recovery","completed"));
      void final;
      return;
    } catch (error: unknown) {
      if (!missing(error)) { await this.fail(context,companyId,attempt,owner,token,error); return; }
    }
    if (attempt.state === "promoted") { await this.repository.failRecovery(context,companyId,attempt.assetId,owner,token,"not_found",true,this.clock.now()); return; }
    try {
      await this.exact(attempt.stagingStorageReference,attempt);
      if (!await this.repository.markRecoveryStaged(context,companyId,attempt.assetId,owner,token,this.clock.now()) && attempt.state !== "staged") return;
      const promoted=await this.storage.promote(attempt.stagingStorageReference,attempt.candidateBlobId,attempt.inspectedMediaType);
      if (promoted !== attempt.finalStorageReference) throw new MediaDomainError("media_integrity_invalid");
      if (!await this.repository.markRecoveryPromoted(context,companyId,attempt.assetId,owner,token,this.clock.now())) return;
      await this.exact(attempt.finalStorageReference,attempt);
      const settled=await this.repository.settleRecovery(context,companyId,attempt.assetId,owner,token,blob(context,companyId,attempt),this.clock.now());if(settled)operationalLogger.info("media_recovery_settled",fields(context,companyId,"recovery","completed"));
    } catch (error: unknown) { await this.fail(context,companyId,attempt,owner,token,error); }
  }

  private async exact(reference: string, attempt: MediaIngestAttempt): Promise<void> { const bytes=reference===attempt.stagingStorageReference?await this.storage.readTemporary(reference,attempt.sizeBytes):await this.storage.read(reference,attempt.sizeBytes);if(bytes.byteLength!==attempt.sizeBytes||createHash("sha256").update(bytes).digest("hex")!==attempt.digest)throw new MediaDomainError("media_integrity_invalid"); }
  private async exactBlob(value: MediaBlob): Promise<void> { const bytes=await this.storage.read(value.storageReference,value.sizeBytes);if(bytes.byteLength!==value.sizeBytes||createHash("sha256").update(bytes).digest("hex")!==value.digest)throw new MediaDomainError("media_integrity_invalid"); }
  private async fail(context: WorkspaceContext, companyId: number, attempt: MediaIngestAttempt, owner: string, token: string, error: unknown): Promise<void> { const failure=category(error);await this.repository.failRecovery(context,companyId,attempt.assetId,owner,token,failure,failure!=="integrity"&&failure!=="collision"&&failure!=="permanent",this.clock.now());operationalLogger.warn("media_recovery_failed",fields(context,companyId,"recovery","failed",{safeErrorCategory:failure})); }
}

function blob(context: WorkspaceContext, companyId: number, attempt: MediaIngestAttempt): MediaBlob { return Object.freeze({id:attempt.candidateBlobId,workspaceId:context.workspaceId,companyId,digest:attempt.digest,sizeBytes:attempt.sizeBytes,mediaType:attempt.inspectedMediaType,storageReference:attempt.finalStorageReference,state:"active",createdAt:attempt.createdAt}); }
function missing(error: unknown): boolean { return error instanceof MediaStorageError&&error.category==="not_found"; }
function category(error:unknown):string{return error instanceof MediaStorageError?error.category:error instanceof MediaDomainError&&error.code==="media_integrity_invalid"?"integrity":"transient_provider";}
function fields(context:WorkspaceContext,companyId:number,operation:string,outcome:string,extra:Record<string,string|number>={}):Record<string,string|number>{return{subsystem:"media",operation,outcome,workspaceId:context.workspaceId,companyId,...extra};}
