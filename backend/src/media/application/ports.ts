import type { MediaAsset, MediaAssociation, MediaAssociationOwnerType, MediaBlob, MediaIngestAttempt, MediaMetadataValue } from "../domain/media.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export type AsyncValue<T> = T | Promise<T>;

export interface InspectedMedia { readonly mediaType: string; readonly metadata: Readonly<Record<string, MediaMetadataValue>>; }
export interface MediaInspectorPort { inspect(content: Uint8Array): InspectedMedia; }
export interface MediaStorageReferences { readonly stagingReference: string; readonly finalStorageReference: string; }
export interface StagedMedia { readonly temporaryReference: string; readonly finalStorageReference: string; readonly digest: string; readonly sizeBytes: number; }
export interface MediaStorageLocation { readonly workspaceId: number; readonly companyId: number; }
export interface MediaStorageStageOptions { readonly sizeBytes: number; readonly digest: string; readonly mediaType: string; }
export interface MediaDeleteResult { readonly status: "absent"; }
export interface MediaStorageObject { readonly reference: string; readonly createdAt: string; }
export interface MediaStoragePort { plan(blobId: string, location: MediaStorageLocation): MediaStorageReferences; stage(references: MediaStorageReferences, content: AsyncIterable<Uint8Array>, location?: MediaStorageLocation, expected?: MediaStorageStageOptions): Promise<StagedMedia>; readTemporary(reference: string, maximumBytes: number): Promise<Uint8Array>; promote(temporaryReference: string, blobId: string, mediaType?: string): Promise<string>; delete(reference: string): Promise<MediaDeleteResult>; read(reference: string, maximumBytes: number): Promise<Uint8Array>; listOwned(location: MediaStorageLocation, limit: number): Promise<readonly MediaStorageObject[]>; }
export interface MediaAssociationOwnerResolver { owns(context: WorkspaceContext, companyId: number, type: MediaAssociationOwnerType, id: string): AsyncValue<boolean>; }

export interface MediaRepositoryPort {
  resolve(context: WorkspaceContext, companyId: number, operation: string, key: string, fingerprint: string): AsyncValue<{ readonly kind: "new" } | { readonly kind: "same"; readonly asset: MediaAsset } | { readonly kind: "in_progress" } | { readonly kind: "retryable_failure" } | { readonly kind: "terminal_failure" } | { readonly kind: "legacy_incomplete" } | { readonly kind: "divergent" }>;
  reserve(context: WorkspaceContext, companyId: number, operation: string, key: string, fingerprint: string, asset: MediaAsset, attempt: MediaIngestAttempt, at: string): AsyncValue<{ readonly kind: "reserved"; readonly asset: MediaAsset } | { readonly kind: "same"; readonly asset: MediaAsset } | { readonly kind: "in_progress" } | { readonly kind: "retryable_failure" } | { readonly kind: "terminal_failure" } | { readonly kind: "legacy_incomplete" } | { readonly kind: "divergent" }>;
  markStaged(context: WorkspaceContext, companyId: number, assetId: string, at: string): AsyncValue<boolean>;
  markPromoted(context: WorkspaceContext, companyId: number, assetId: string, at: string): AsyncValue<boolean>;
  complete(context: WorkspaceContext, companyId: number, assetId: string, blob: MediaBlob, at: string): AsyncValue<MediaAsset | null>;
  fail(context: WorkspaceContext, companyId: number, assetId: string, category: string, retryable: boolean, at: string): AsyncValue<void>;
  findIngestAttempt(context: WorkspaceContext, companyId: number, assetId: string): AsyncValue<MediaIngestAttempt | null>;
  findAsset(context: WorkspaceContext, companyId: number, assetId: string): AsyncValue<MediaAsset | null>;
  findBlob(context: WorkspaceContext, companyId: number, digest: string, sizeBytes: number, mediaType: string): AsyncValue<MediaBlob | null>;
  archive(context: WorkspaceContext, companyId: number, assetId: string, at: string): AsyncValue<MediaAsset | null>;
  delete(context: WorkspaceContext, companyId: number, assetId: string, at: string): AsyncValue<{ readonly asset: MediaAsset; readonly reclaim: MediaBlob | null } | null>;
  finalizeReclaim(context: WorkspaceContext, companyId: number, blobId: string, at: string): AsyncValue<void>;
  createAssociation(context: WorkspaceContext, association: MediaAssociation, at: string, owns: () => AsyncValue<boolean>): AsyncValue<MediaAssociation | null>;
  listAssociations(context: WorkspaceContext, companyId: number, assetId: string): AsyncValue<readonly MediaAssociation[]>;
  open(context: WorkspaceContext, companyId: number, assetId: string): AsyncValue<MediaBlob | null>;
  listEvents(context: WorkspaceContext, companyId: number, assetId: string): AsyncValue<readonly string[]>;
  listPendingReclaims(context: WorkspaceContext, companyId: number, limit?: number): AsyncValue<readonly MediaBlob[]>;
  leaseIncomplete(context: WorkspaceContext, companyId: number, owner: string, token: string, now: string, expiresAt: string, limit: number): AsyncValue<readonly MediaIngestAttempt[]>;
  markRecoveryStaged(context: WorkspaceContext, companyId: number, assetId: string, owner: string, token: string, at: string): AsyncValue<boolean>;
  markRecoveryPromoted(context: WorkspaceContext, companyId: number, assetId: string, owner: string, token: string, at: string): AsyncValue<boolean>;
  settleRecovery(context: WorkspaceContext, companyId: number, assetId: string, owner: string, token: string, blob: MediaBlob, at: string): AsyncValue<MediaAsset | null>;
  failRecovery(context: WorkspaceContext, companyId: number, assetId: string, owner: string, token: string, category: string, retryable: boolean, at: string): AsyncValue<boolean>;
  leaseReclaims(context: WorkspaceContext, companyId: number, owner: string, token: string, now: string, expiresAt: string, limit: number): AsyncValue<readonly MediaBlob[]>;
  finalizeLeasedReclaim(context: WorkspaceContext, companyId: number, blobId: string, owner: string, token: string, at: string): AsyncValue<boolean>;
  listReadyBlobs(context: WorkspaceContext, companyId: number, limit: number): AsyncValue<readonly MediaBlob[]>;
  markBlobUnavailable(context: WorkspaceContext, companyId: number, blobId: string, category: string, at: string): AsyncValue<boolean>;
  referencesStorage(context: WorkspaceContext, companyId: number, reference: string): AsyncValue<boolean>;
  listRecoveryScopes(limit: number): AsyncValue<readonly { readonly workspaceId: number; readonly workspaceKey: string; readonly companyId: number }[]>;
}
