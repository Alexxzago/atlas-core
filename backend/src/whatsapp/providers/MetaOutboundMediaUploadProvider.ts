import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { WhatsAppConnectionRepositoryPort, WhatsAppCredentialResolverPort } from "../application/ports.js";
import type { WhatsAppOutboundMediaUploadInput, WhatsAppOutboundMediaUploadPort, WhatsAppOutboundMediaUploadResult } from "../application/outboundMediaUploadPort.js";

export class MetaOutboundMediaUploadProvider implements WhatsAppOutboundMediaUploadPort {
  public constructor(private readonly connections: WhatsAppConnectionRepositoryPort, private readonly credentials: WhatsAppCredentialResolverPort, private readonly graphVersion: string, private readonly fetcher: typeof fetch = fetch) {}
  public async upload(context: WorkspaceContext, companyId: number, connectionId: string, input: WhatsAppOutboundMediaUploadInput): Promise<WhatsAppOutboundMediaUploadResult> {
    const connection = this.connections.findById(context, companyId, connectionId as never);
    if (!connection || connection.status !== "active") return { kind: "failed", safeFailureCategory: "unauthorized" };
    let token: string | null;
    try { token = this.credentials.resolve(context, companyId, connection.id); } catch { return { kind: "failed", safeFailureCategory: "unauthorized" }; }
    if (!token) return { kind: "failed", safeFailureCategory: "unauthorized" };
    const bytes = new Uint8Array(input.content.byteLength); bytes.set(input.content);
    const body = new FormData(); body.set("messaging_product", "whatsapp"); body.set("type", input.mediaType); body.set("file", new Blob([bytes.buffer], { type: input.mediaType }), input.filename ?? "audio.ogg");
    try {
      const response = await this.fetcher(`https://graph.facebook.com/${this.graphVersion}/${encodeURIComponent(connection.phoneNumberId)}/media`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body, redirect: "error", signal: input.signal });
      if (!response.ok) return failure(response.status);
      const value = await response.json() as { id?: unknown };
      return typeof value.id === "string" && value.id.trim().length > 0 && Array.from(value.id.trim()).length <= 200 ? { kind: "uploaded", providerMediaId: value.id.trim() } : { kind: "failed", safeFailureCategory: "invalid_response" };
    } catch (error: unknown) { return error instanceof DOMException && error.name === "AbortError" || (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError") ? { kind: "retryable", safeFailureCategory: "timeout" } : { kind: "retryable", safeFailureCategory: "provider_unavailable" }; }
  }
}

function failure(status: number): WhatsAppOutboundMediaUploadResult { if (status === 408 || status === 429 || status >= 500) return { kind: "retryable", safeFailureCategory: status === 429 ? "rate_limited" : "provider_unavailable" }; return { kind: "failed", safeFailureCategory: status === 401 || status === 403 ? "unauthorized" : "provider_rejected" }; }
