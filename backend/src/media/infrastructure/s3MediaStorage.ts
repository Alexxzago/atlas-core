import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { MediaDeleteResult, MediaStorageLocation, MediaStoragePort, MediaStorageReferences, MediaStorageStageOptions, StagedMedia } from "../application/ports.js";
import { MEDIA_LIMITS, MediaDomainError, MediaStorageError, type MediaStorageFailureCategory } from "../domain/media.js";

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
  public plan(id:string,location:MediaStorageLocation):MediaStorageReferences { if(!blobId.test(id)||!Number.isSafeInteger(location.workspaceId)||location.workspaceId<1||!Number.isSafeInteger(location.companyId)||location.companyId<1)throw new Error("Invalid media storage location.");const stagingReference=`workspaces/${location.workspaceId}/companies/${location.companyId}/media/${id}/staging/tmp_${randomUUID().replace(/-/gu,"")}`;return Object.freeze({stagingReference,finalStorageReference:stagingReference.replace(/\/staging\/tmp_[a-f0-9]{32}$/u,"/object")}); }
  public async stage(input: MediaStorageReferences|string, content: AsyncIterable<Uint8Array>, location?: MediaStorageLocation, expected?: MediaStorageStageOptions): Promise<StagedMedia> {
    if(typeof input==="string"&&!location)throw new Error("Invalid media storage location.");const references:MediaStorageReferences=typeof input==="string"?this.plan(input,location!):input,temporaryReference=references.stagingReference;
    if (!location || !temporaryKey.test(temporaryReference) || !objectKey.test(references.finalStorageReference) || references.finalStorageReference!==temporaryReference.replace(/\/staging\/tmp_[a-f0-9]{32}$/u,"/object")) throw new Error("Invalid media storage location.");
    if(expected&&(!Number.isSafeInteger(expected.sizeBytes)||expected.sizeBytes<1||expected.sizeBytes>MEDIA_LIMITS.maximumBytes||!/^[0-9a-f]{64}$/u.test(expected.digest)))throw new MediaDomainError("media_integrity_invalid");
    const digest = createHash("sha256"); let sizeBytes = 0, actualDigest = "";
    const bounded = async function* (): AsyncGenerator<Uint8Array> {
      for await (const chunk of content) {
        if (!(chunk instanceof Uint8Array)) throw new MediaDomainError("media_stream_invalid");
        sizeBytes += chunk.byteLength;
        if (sizeBytes > MEDIA_LIMITS.maximumBytes) throw new MediaDomainError("media_too_large");
        digest.update(chunk); yield chunk;
      }
      actualDigest=digest.digest("hex");if(!sizeBytes)throw new MediaDomainError("media_empty");if(expected&&(sizeBytes!==expected.sizeBytes||actualDigest!==expected.digest)) throw new MediaDomainError("media_integrity_invalid");
    };
    try { await this.send(new PutObjectCommand({ Bucket: this.configuration.bucket, Key: temporaryReference, ContentType: expected?.mediaType??"application/octet-stream", ...(expected?{ContentLength:expected.sizeBytes}:{}), Body: Readable.from(bounded()) })); }
    catch (error: unknown) { await this.delete(temporaryReference).catch(() => undefined); throw error instanceof MediaDomainError ? error : storageError(error); }
    return Object.freeze({ temporaryReference, finalStorageReference: references.finalStorageReference, digest: expected?.digest??actualDigest, sizeBytes: expected?.sizeBytes??sizeBytes });
  }
  public async readTemporary(reference: string, maximumBytes: number): Promise<Uint8Array> { if (!temporaryKey.test(reference)) throw new Error("Invalid media storage reference."); return this.readKey(reference, maximumBytes); }
  public async promote(temporaryReference: string, id: string, mediaType?: string): Promise<string> {
    if (!temporaryKey.test(temporaryReference) || !blobId.test(id) || !temporaryReference.includes(`/${id}/`) || !mediaType) throw new Error("Invalid media storage reference.");
    const target = temporaryReference.replace(/\/staging\/tmp_[a-f0-9]{32}$/u, "/object");
    // A conditional final put is the provider contract: a collision must fail, never overwrite.
    try { const bytes=await this.readTemporary(temporaryReference,MEDIA_LIMITS.maximumBytes); await this.send(new PutObjectCommand({ Bucket:this.configuration.bucket,Key:target,ContentType:mediaType,IfNoneMatch:"*",Body:Readable.from([bytes]) })); }
    catch (error: unknown) { throw error instanceof MediaDomainError ? error : storageError(error); }
    await this.delete(temporaryReference).catch(() => undefined);
    return target;
  }
  public async delete(reference: string): Promise<MediaDeleteResult> {
    if (!temporaryKey.test(reference) && !objectKey.test(reference)) throw new Error("Invalid media storage reference.");
    try { await this.send(new DeleteObjectCommand({ Bucket: this.configuration.bucket, Key: reference })); }
    catch (error: unknown) { if (!missing(error)) throw storageError(error); }
    return Object.freeze({status:"absent"});
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

function storageError(error: unknown): MediaStorageError { return new MediaStorageError(category(error)); }
function category(error:unknown):MediaStorageFailureCategory{const status=statusCode(error),name=errorName(error),value=errorCode(error);if(status===412||name==="PreconditionFailed")return"collision";if(status===404||name==="NoSuchKey"||name==="NotFound")return"not_found";if(name==="AbortError"||name==="TimeoutError"||value==="ABORT_ERR"||value==="ECONNABORTED")return"timeout";if(status===401||status===403||["AccessDenied","InvalidAccessKeyId","SignatureDoesNotMatch","AuthorizationHeaderMalformed"].includes(name))return"authorization";if(status===429||(status!==undefined&&status>=500)||["SlowDown","ServiceUnavailable","Throttling"].includes(name))return"transient_provider";if(["ECONNRESET","ECONNREFUSED","ENOTFOUND","EAI_AGAIN","ETIMEDOUT","EPIPE"].includes(value))return"transport";return"permanent";}
function statusCode(error:unknown):number|undefined{return typeof error==="object"&&error!==null&&"$metadata" in error?(error as {$metadata?:{httpStatusCode?:unknown}}).$metadata?.httpStatusCode as number|undefined:undefined;}
function errorName(error:unknown):string{return typeof error==="object"&&error!==null&&"name" in error&&typeof(error as {name?:unknown}).name==="string"?(error as {name:string}).name:"";}
function errorCode(error:unknown):string{return typeof error==="object"&&error!==null&&"code" in error&&typeof(error as {code?:unknown}).code==="string"?(error as {code:string}).code:"";}
function collision(error:unknown):boolean{return category(error)==="collision";}
function missing(error: unknown): boolean { return category(error)==="not_found"; }
