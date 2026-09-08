import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { MEDIA_LIMITS } from "../media/domain/media.js";
import type { BackupS3Configuration } from "../config/backupS3Configuration.js";

export interface RestoreTargetMediaStorage { put(key:string,body:AsyncIterable<Uint8Array>,sizeBytes:number,contentType:string,checksum:string):Promise<void>;verify(key:string,expectedBytes:number):Promise<void>; }
interface S3ClientPort { send(command:object,options?:{readonly abortSignal?:AbortSignal}):Promise<unknown>; }
const mediaKey=/^(?:workspaces|companies)\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u;

/** Private restore-only storage preserving database-owned media references verbatim. */
export class S3RestoreTargetMediaStorage implements RestoreTargetMediaStorage {
  private readonly client:S3ClientPort;
  public constructor(private readonly configuration:BackupS3Configuration,client?:S3ClientPort,private readonly timeoutMilliseconds=30_000){if(!Number.isSafeInteger(timeoutMilliseconds)||timeoutMilliseconds<1||timeoutMilliseconds>60_000)throw new Error("Restore target storage timeout is invalid.");this.client=client??new S3Client({endpoint:configuration.endpoint,region:configuration.region,credentials:{accessKeyId:configuration.accessKeyId,secretAccessKey:configuration.secretAccessKey},maxAttempts:2});}
  public async put(key:string,body:AsyncIterable<Uint8Array>,sizeBytes:number,contentType:string,checksum:string):Promise<void>{this.valid(key,sizeBytes);if(!contentType||!checksum)throw new Error("Restore target media is invalid.");try{await this.send(new PutObjectCommand({Bucket:this.configuration.bucket,Key:key,Body:Readable.from(this.bounded(body,sizeBytes)),ContentLength:sizeBytes,ContentType:contentType,ChecksumSHA256:checksum}));}catch{throw new Error("Restore target storage operation failed.");}}
  public async verify(key:string,expectedBytes:number):Promise<void>{this.valid(key,expectedBytes);try{const response=await this.send(new HeadObjectCommand({Bucket:this.configuration.bucket,Key:key})) as {ContentLength?:number};if(response.ContentLength!==expectedBytes)throw new Error();}catch{throw new Error("Restore target storage operation failed.");}}
  private valid(key:string,sizeBytes:number):void{if(!mediaKey.test(key)||!Number.isSafeInteger(sizeBytes)||sizeBytes<1||sizeBytes>MEDIA_LIMITS.maximumBytes)throw new Error("Restore target media is invalid.");}
  private async *bounded(body:AsyncIterable<Uint8Array>,expected:number):AsyncGenerator<Uint8Array>{let total=0;for await(const chunk of body){if(!(chunk instanceof Uint8Array))throw new Error("Restore target media is invalid.");total+=chunk.byteLength;if(total>expected)throw new Error("Restore target media is invalid.");yield chunk;}if(total!==expected)throw new Error("Restore target media is invalid.");}
  private send(command:object):Promise<unknown>{return this.client.send(command,{abortSignal:AbortSignal.timeout(this.timeoutMilliseconds)});}
}
