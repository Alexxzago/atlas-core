import { MEDIA_LIMITS } from "../../media/domain/media.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { WhatsAppConnectionRepositoryPort, WhatsAppCredentialResolverPort } from "../application/ports.js";
import { WhatsAppInboundMediaDownloadStreamError, type WhatsAppInboundMediaDownloadResult, type WhatsAppInboundMediaProviderPort } from "../application/mediaPorts.js";
import type { WhatsAppInboundMediaDescriptor } from "../domain/whatsappInboundMedia.js";

export interface MetaInboundMediaProviderOptions { readonly graphVersion: string; readonly metadataTimeoutMs?: number; readonly downloadTimeoutMs?: number; readonly maximumBytes?: number; }

export class MetaInboundMediaProvider implements WhatsAppInboundMediaProviderPort {
  private readonly metadataTimeoutMs: number;
  private readonly downloadTimeoutMs: number;
  private readonly maximumBytes: number;
  public constructor(private readonly connections: WhatsAppConnectionRepositoryPort, private readonly credentials: WhatsAppCredentialResolverPort, private readonly options: MetaInboundMediaProviderOptions, private readonly fetcher: typeof fetch = fetch) {
    this.metadataTimeoutMs = options.metadataTimeoutMs ?? 10_000;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? 30_000;
    this.maximumBytes = options.maximumBytes ?? MEDIA_LIMITS.maximumBytes;
  }

  public async download(context: WorkspaceContext, companyId: number, connectionId: string, descriptor: WhatsAppInboundMediaDescriptor): Promise<WhatsAppInboundMediaDownloadResult> {
    const connection = this.connections.findById(context, companyId, connectionId as never);
    if (!connection || connection.status !== "active") return { kind: "unauthorized" };
    let token: string | null;
    try { token = this.credentials.resolve(context, companyId, connection.id); } catch { return { kind: "unauthorized" }; }
    if (!token) return { kind: "unauthorized" };
    const metadata = await this.request(`https://graph.facebook.com/${this.options.graphVersion}/${encodeURIComponent(descriptor.providerMediaId)}`, token, this.metadataTimeoutMs);
    if (metadata.kind !== "response") return metadata;
    if (!metadata.response.ok) return failure(metadata.response.status);
    let body: { id?: unknown; url?: unknown; mime_type?: unknown; file_size?: unknown };
    try { body = await metadata.response.json() as { id?: unknown; url?: unknown; mime_type?: unknown; file_size?: unknown }; } catch { return { kind: "invalid_response" }; }
    if (body.id !== descriptor.providerMediaId || typeof body.url !== "string" || typeof body.mime_type !== "string" || !body.mime_type.trim() || (typeof body.file_size !== "number" && body.file_size !== undefined)) return { kind: "invalid_response" };
    if ((descriptor.declaredMime.length > 0 && body.mime_type.toLowerCase() !== descriptor.declaredMime.toLowerCase()) || (typeof body.file_size === "number" && (!Number.isSafeInteger(body.file_size) || body.file_size < 1 || body.file_size > this.maximumBytes))) return typeof body.file_size === "number" && body.file_size > this.maximumBytes ? { kind: "too_large" } : { kind: "invalid_response" };
    if (!safeMetaUrl(body.url)) return { kind: "unsafe_location" };
    const download = await this.request(body.url, token, this.downloadTimeoutMs);
    if (download.kind !== "response") return download;
    if (!download.response.ok) return failure(download.response.status);
    if (download.response.redirected) return { kind: "unsafe_location" };
    const length = Number(download.response.headers.get("content-length"));
    if (Number.isFinite(length) && length > this.maximumBytes) return { kind: "too_large" };
    if (!download.response.body) return { kind: "invalid_response" };
    return { kind: "downloaded", download: { mediaType: body.mime_type, filename: descriptor.filename, content: bounded(download.response.body, this.maximumBytes, download.signal) } };
  }

  private async request(url: string, token: string, timeoutMs: number): Promise<{ kind: "response"; response: Response; signal: AbortSignal } | Exclude<WhatsAppInboundMediaDownloadResult, { readonly kind: "downloaded" }>> {
    const signal = AbortSignal.timeout(timeoutMs);
    try { return { kind: "response", response: await this.fetcher(url, { headers: { authorization: `Bearer ${token}` }, redirect: "error", signal }), signal }; }
    catch (error: unknown) { return error instanceof DOMException && error.name === "TimeoutError" || (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError") ? { kind: "timeout" } : { kind: "unavailable" }; }
  }
}

function safeMetaUrl(value: string): boolean { try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "lookaside.fbsbx.com" && !url.username && !url.password; } catch { return false; } }
function failure(status: number): Exclude<WhatsAppInboundMediaDownloadResult, { readonly kind: "downloaded" }> { if (status === 404) return { kind: "not_found" }; if (status === 401 || status === 403) return { kind: "unauthorized" }; if (status === 408 || status === 504) return { kind: "timeout" }; return status >= 500 ? { kind: "unavailable" } : { kind: "invalid_response" }; }
async function* bounded(body: ReadableStream<Uint8Array>, maximum: number, signal: AbortSignal): AsyncGenerator<Uint8Array> { const reader = body.getReader(); let total = 0; try { while (true) { if (signal.aborted) throw new WhatsAppInboundMediaDownloadStreamError("timeout"); const next = await reader.read(); if (next.done) return; if (!(next.value instanceof Uint8Array)) throw new WhatsAppInboundMediaDownloadStreamError("invalid_response"); total += next.value.byteLength; if (total > maximum) { await reader.cancel(); throw new WhatsAppInboundMediaDownloadStreamError("too_large"); } yield next.value; } } finally { reader.releaseLock(); } }
