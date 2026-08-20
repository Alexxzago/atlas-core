import type { MediaAsset, MediaAssociation, MediaAssociationOwnerType, MediaBlob, MediaMetadataValue } from "../domain/media.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export interface InspectedMedia { readonly mediaType: string; readonly metadata: Readonly<Record<string, MediaMetadataValue>>; }
export interface MediaInspectorPort { inspect(content: Uint8Array): InspectedMedia; }
export interface StagedMedia { readonly temporaryReference: string; readonly digest: string; readonly sizeBytes: number; }
export interface MediaStoragePort { stage(blobId: string, content: AsyncIterable<Uint8Array>): Promise<StagedMedia>; readTemporary(reference: string, maximumBytes: number): Promise<Uint8Array>; promote(temporaryReference: string, blobId: string): Promise<string>; delete(reference: string): Promise<void>; read(reference: string, maximumBytes: number): Promise<Uint8Array>; }
export interface MediaAssociationOwnerResolver { owns(context: WorkspaceContext, companyId: number, type: MediaAssociationOwnerType, id: string): boolean; }

export interface MediaRepositoryPort {
  reserve(context: WorkspaceContext, companyId: number, operation: string, key: string, fingerprint: string, asset: MediaAsset, at: string): { readonly kind: "reserved"; readonly asset: MediaAsset } | { readonly kind: "same"; readonly asset: MediaAsset } | { readonly kind: "in_progress" } | { readonly kind: "divergent" };
  complete(context: WorkspaceContext, companyId: number, assetId: string, blob: MediaBlob, at: string): MediaAsset | null;
  fail(context: WorkspaceContext, companyId: number, assetId: string, code: string, at: string): void;
  findAsset(context: WorkspaceContext, companyId: number, assetId: string): MediaAsset | null;
  findBlob(context: WorkspaceContext, companyId: number, digest: string, sizeBytes: number, mediaType: string): MediaBlob | null;
  archive(context: WorkspaceContext, companyId: number, assetId: string, at: string): MediaAsset | null;
  delete(context: WorkspaceContext, companyId: number, assetId: string, at: string): { readonly asset: MediaAsset; readonly reclaim: MediaBlob | null } | null;
  finalizeReclaim(context: WorkspaceContext, companyId: number, blobId: string, at: string): void;
  createAssociation(context: WorkspaceContext, association: MediaAssociation, at: string, owns: () => boolean): MediaAssociation | null;
  listAssociations(context: WorkspaceContext, companyId: number, assetId: string): readonly MediaAssociation[];
  open(context: WorkspaceContext, companyId: number, assetId: string): MediaBlob | null;
  listEvents(context: WorkspaceContext, companyId: number, assetId: string): readonly string[];
  listPendingReclaims(context: WorkspaceContext, companyId: number): readonly MediaBlob[];
}
