import { MEDIA_TYPES, MediaDomainError } from "../domain/media.js";
import type { InspectedMedia, MediaInspectorPort } from "../application/ports.js";

function starts(content: Uint8Array, signature: readonly number[]): boolean { return content.length >= signature.length && signature.every((value, index) => content[index] === value); }
export class BinaryMediaInspector implements MediaInspectorPort {
  public inspect(content: Uint8Array): InspectedMedia {
    const mediaType = starts(content, [0x25, 0x50, 0x44, 0x46, 0x2d]) ? "application/pdf" : starts(content, [0xff, 0xd8, 0xff]) ? "image/jpeg" : starts(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? "image/png" : starts(content, [0x47, 0x49, 0x46, 0x38]) ? "image/gif" : starts(content, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...content.slice(8, 12)) === "WEBP" ? "image/webp" : starts(content,[0x49,0x44,0x33]) || starts(content,[0xff,0xfb]) || starts(content,[0xff,0xf3]) || starts(content,[0xff,0xf2]) ? "audio/mpeg" : starts(content,[0x4f,0x67,0x67,0x53]) ? "audio/ogg" : starts(content,[0x52,0x49,0x46,0x46]) && String.fromCharCode(...content.slice(8,12))==="WAVE" ? "audio/wav" : null;
    if (!mediaType || !(MEDIA_TYPES as readonly string[]).includes(mediaType)) throw new MediaDomainError("media_type_unsupported");
    return Object.freeze({ mediaType, metadata: Object.freeze({}) });
  }
}
