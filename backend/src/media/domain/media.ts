export type MediaKind = "document" | "image" | "audio";
export type MediaAssetStatus = "pending" | "ready" | "failed" | "archived" | "deleted";
export type MediaBlobState = "active" | "reclaim_pending" | "reclaimed";
export type MediaAssociationOwnerType = "conversation_message" | "knowledge_source" | "tool_result" | "outbound_message";
export interface MediaMetadataObject { readonly [key: string]: MediaMetadataValue; }
export type MediaMetadataValue = number | readonly MediaMetadataValue[] | MediaMetadataObject;

export interface MediaAsset {
  readonly id: string;
  readonly workspaceId: number;
  readonly companyId: number;
  readonly kind: MediaKind;
  readonly mediaType: string;
  readonly sizeBytes: number | null;
  readonly filename: string | null;
  readonly metadata: Readonly<Record<string, MediaMetadataValue>>;
  readonly status: MediaAssetStatus;
  readonly createdAt: string;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
}

/** Physical integrity authority. Never expose this record outside media persistence/service internals. */
export interface MediaBlob {
  readonly id: string;
  readonly workspaceId: number;
  readonly companyId: number;
  readonly digest: string;
  readonly sizeBytes: number;
  readonly mediaType: string;
  readonly storageReference: string;
  readonly state: MediaBlobState;
  readonly createdAt: string;
}

export interface MediaAssociation {
  readonly id: string;
  readonly assetId: string;
  readonly workspaceId: number;
  readonly companyId: number;
  readonly ownerType: MediaAssociationOwnerType;
  readonly ownerId: string;
  readonly createdAt: string;
}

export const MEDIA_LIMITS = Object.freeze({ maximumBytes: 25 * 1024 * 1024, filenameLength: 180, metadataEntries: 4, metadataValue: 100_000, idempotencyKeyLength: 200 } as const);
export const MEDIA_TYPES = Object.freeze(["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp", "audio/mpeg", "audio/ogg", "audio/wav"] as const);
export class MediaDomainError extends Error { public constructor(public readonly code: string) { super(code); } }

export function mediaKind(mediaType: string): MediaKind { return mediaType === "application/pdf" ? "document" : mediaType.startsWith("audio/") ? "audio" : "image"; }
export function safeFilename(value: string | undefined): string | null { if (value === undefined) return null; const filename = value.normalize("NFC").trim(); if (!filename || filename.length > MEDIA_LIMITS.filenameLength || /[\\/\u0000-\u001f]/u.test(filename)) throw new MediaDomainError("media_filename_invalid"); return filename; }
export function safeMetadata(value: Readonly<Record<string, MediaMetadataValue>> | undefined): Readonly<Record<string, MediaMetadataValue>> { if (value === undefined) return Object.freeze({}); let entries = 0; const visit = (input: MediaMetadataValue, depth: number): MediaMetadataValue => { if (typeof input === "number") { if (!Number.isInteger(input) || input < 0 || input > MEDIA_LIMITS.metadataValue) throw new MediaDomainError("media_metadata_invalid"); return input; } if (depth >= 4) throw new MediaDomainError("media_metadata_invalid"); if (Array.isArray(input)) return Object.freeze(input.map(item => visit(item, depth + 1))); if (!input || Object.getPrototypeOf(input) !== Object.prototype) throw new MediaDomainError("media_metadata_invalid"); const values = Object.entries(input); entries += values.length; if (entries > MEDIA_LIMITS.metadataEntries || values.some(([key]) => !/^[a-z][a-zA-Z]{0,31}$/u.test(key))) throw new MediaDomainError("media_metadata_invalid"); return Object.freeze(Object.fromEntries(values.map(([key, item]) => [key, visit(item, depth + 1)])));
  }; return visit(value, 0) as Readonly<Record<string, MediaMetadataValue>>; }

/** Deterministic JSON representation for idempotency identity; arrays retain their semantic order. */
export function canonicalMetadata(value: Readonly<Record<string, MediaMetadataValue>>): string { const encode = (item: MediaMetadataValue): string => { if (typeof item === "number") return JSON.stringify(item); if (Array.isArray(item)) return `[${item.map(encode).join(",")}]`; const object=item as MediaMetadataObject; return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${encode(object[key]!)}`).join(",")}}`; }; return encode(value); }
