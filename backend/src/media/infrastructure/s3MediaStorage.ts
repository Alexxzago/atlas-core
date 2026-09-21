import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { MediaStorageLocation, MediaStoragePort, StagedMedia } from "../application/ports.js";
import { MEDIA_LIMITS, MediaDomainError } from "../domain/media.js";

const blobId = /^mbl_[a-f0-9]{32}$/u;
const temporaryKey = /^workspaces\/\d+\/companies\/\d+\/media\/mbl_[a-f0-9]{32}\/staging\/tmp_[a-f0-9]{32}$/u;
const objectKey = /^workspaces\/\d+\/companies\/\d+\/media\/mbl_[a-f0-9]{32}\/object$/u;

export interface S3MediaStorageConfiguration { readonly endpoint: string; readonly region: string; readonly bucket: string; readonly accessKeyId: string; readonly secretAccessKey: string; }
interface S3ClientPort { send(command: object, options?: { readonly abortSignal?: AbortSignal }): Promise<unknown>; }
export const S3_MEDIA_TIMEOUT_MILLISECONDS = 30_000;
export const S3_MEDIA_MAX_ATTEMPTS = 2;
/** Do not force path-style addressing; the S3 SDK endpoint resolver selects the effective request form. */
export const S3_MEDIA_FORCE_PATH_STYLE = false;

/** Private S3-compatible byte storage. Atlas retains media ownership and lifecycle metadata in SQLite. */
export class S3MediaStorage implements MediaStoragePort {
  private readonly client: S3ClientPort;
  public constructor(private readonly configuration: S3MediaStorageConfiguration, client?: S3ClientPort, private readonly timeoutMilliseconds = S3_MEDIA_TIMEOUT_MILLISECONDS) {
    if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 60_000) throw new Error("S3 media timeout is invalid.");
    this.client = client ?? new S3Client({ endpoint: configuration.endpoint, region: configuration.region, credentials: { accessKeyId: configuration.accessKeyId, secretAccessKey: configuration.secretAccessKey }, forcePathStyle: S3_MEDIA_FORCE_PATH_STYLE, maxAttempts: S3_MEDIA_MAX_ATTEMPTS });
  }
  public async stage(id: string, content: AsyncIterable<Uint8Array>, location?: MediaStorageLocation): Promise<StagedMedia> {
    if (!blobId.test(id) || !location || !Number.isSafeInteger(location.workspaceId) || location.workspaceId < 1 || !Number.isSafeInteger(location.companyId) || location.companyId < 1) throw new Error("Invalid media storage location.");
    const temporaryReference = `workspaces/${location.workspaceId}/companies/${location.companyId}/media/${id}/staging/tmp_${randomUUID().replace(/-/gu, "")}`;
    const digest = createHash("sha256"); let sizeBytes = 0;
    const bounded = async function* (): AsyncGenerator<Uint8Array> {
      for await (const chunk of content) {
        if (!(chunk instanceof Uint8Array)) throw new MediaDomainError("media_stream_invalid");
        sizeBytes += chunk.byteLength;
        if (sizeBytes > MEDIA_LIMITS.maximumBytes) throw new MediaDomainError("media_too_large");
        digest.update(chunk); yield chunk;
      }
      if (sizeBytes === 0) throw new MediaDomainError("media_empty");
    };
    try { await this.send(new PutObjectCommand({ Bucket: this.configuration.bucket, Key: temporaryReference, ContentType: "application/octet-stream", Body: Readable.from(bounded()) })); }
    catch (error: unknown) { await this.delete(temporaryReference).catch(() => undefined); throw storageError(error); }
    return Object.freeze({ temporaryReference, digest: digest.digest("hex"), sizeBytes });
  }
  public async readTemporary(reference: string, maximumBytes: number): Promise<Uint8Array> { if (!temporaryKey.test(reference)) throw new Error("Invalid media storage reference."); return this.readKey(reference, maximumBytes); }
  public async promote(temporaryReference: string, id: string, mediaType?: string): Promise<string> {
    if (!temporaryKey.test(temporaryReference) || !blobId.test(id) || !temporaryReference.includes(`/${id}/`) || !mediaType) throw new Error("Invalid media storage reference.");
    const target = temporaryReference.replace(/\/staging\/tmp_[a-f0-9]{32}$/u, "/object");
    try { await this.send(new CopyObjectCommand({ Bucket: this.configuration.bucket, Key: target, CopySource: `${this.configuration.bucket}/${temporaryReference.split("/").map(encodeURIComponent).join("/")}`, ContentType: mediaType, MetadataDirective: "REPLACE" })); }
    catch (error: unknown) { throw storageError(error); }
    await this.delete(temporaryReference).catch(() => undefined);
    return target;
  }
  public async delete(reference: string): Promise<void> {
    if (!temporaryKey.test(reference) && !objectKey.test(reference)) throw new Error("Invalid media storage reference.");
    try { await this.send(new DeleteObjectCommand({ Bucket: this.configuration.bucket, Key: reference })); }
    catch (error: unknown) { if (missing(error)) return; throw storageError(error); }
  }
  public async read(reference: string, maximumBytes: number): Promise<Uint8Array> { if (!objectKey.test(reference)) throw new Error("Invalid media storage reference."); return this.readKey(reference, maximumBytes); }
  private async readKey(reference: string, maximumBytes: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MEDIA_LIMITS.maximumBytes) throw new MediaDomainError("media_integrity_invalid");
    let response: { Body?: unknown; ContentLength?: number };
    try { response = await this.send(new GetObjectCommand({ Bucket: this.configuration.bucket, Key: reference })) as { Body?: unknown; ContentLength?: number }; }
    catch (error: unknown) { throw storageError(error); }
    if (!Number.isSafeInteger(response.ContentLength) || response.ContentLength! < 1 || response.ContentLength! > maximumBytes) throw new MediaDomainError("media_integrity_invalid");
    const body = response.Body;
    if (!body || !(Symbol.asyncIterator in Object(body))) throw new MediaDomainError("media_storage_failed");
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      for await (const chunk of body as AsyncIterable<unknown>) {
        if (!(chunk instanceof Uint8Array)) throw new MediaDomainError("media_storage_failed");
        length += chunk.byteLength;
        if (length > maximumBytes) throw new MediaDomainError("media_integrity_invalid");
        chunks.push(chunk);
      }
    } catch (error: unknown) { throw error instanceof MediaDomainError ? error : storageError(error); }
    if (length !== response.ContentLength) throw new MediaDomainError("media_integrity_invalid");
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }
  private async send(command: object): Promise<unknown> { return this.client.send(command, { abortSignal: AbortSignal.timeout(this.timeoutMilliseconds) }); }
}

function storageError(error: unknown): MediaDomainError {
  return missing(error) ? new MediaDomainError("media_not_found") : new MediaDomainError("media_storage_failed");
}
function missing(error: unknown): boolean { const status = typeof error === "object" && error !== null && "$metadata" in error ? (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode : undefined; const name = typeof error === "object" && error !== null && "name" in error ? (error as { name?: unknown }).name : undefined; return status === 404 || name === "NoSuchKey" || name === "NotFound"; }
