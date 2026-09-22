import type { MediaDeleteResult, MediaStorageLocation, MediaStoragePort, MediaStorageReferences, StagedMedia } from "../application/ports.js";
import { MediaDomainError } from "../domain/media.js";

/** Production has no durable media provider configured; never fall back to local storage. */
export class UnavailableMediaStorage implements MediaStoragePort {
  public plan(_blobId:string,_location:MediaStorageLocation):MediaStorageReferences { throw new MediaDomainError("media_unavailable"); }
  public stage(_references: MediaStorageReferences, _content: AsyncIterable<Uint8Array>, _location?: MediaStorageLocation): Promise<StagedMedia> { return this.unavailable(); }
  public readTemporary(_reference: string, _maximumBytes: number): Promise<Uint8Array> { return this.unavailable(); }
  public promote(_temporaryReference: string, _blobId: string, _mediaType?: string): Promise<string> { return this.unavailable(); }
  public delete(_reference: string): Promise<MediaDeleteResult> { return this.unavailable(); }
  public read(_reference: string, _maximumBytes: number): Promise<Uint8Array> { return this.unavailable(); }
  private unavailable<T>(): Promise<T> { return Promise.reject(new MediaDomainError("media_unavailable")); }
}
