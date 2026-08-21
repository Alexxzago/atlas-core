import { MediaDomainError } from "../../media/domain/media.js";
import type { MediaService } from "../../media/services/mediaService.js";
import { ChannelProviderEventRepository } from "../../repositories/channelProviderEventRepository.js";
import { WhatsAppInboundMediaRepository } from "../../repositories/whatsappInboundMediaRepository.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import { WhatsAppInboundMediaDownloadStreamError, type WhatsAppInboundMediaDownloadResult, type WhatsAppInboundMediaProviderPort } from "../application/mediaPorts.js";
import type { WhatsAppInboundMediaFailure } from "../domain/whatsappInboundMedia.js";

export type WhatsAppInboundMediaRecoveryOutcome = { readonly kind: "idle" } | { readonly kind: "associated"; readonly ledgerId: string; readonly mediaAssetId: string } | { readonly kind: "retry_scheduled" | "terminal"; readonly ledgerId: string; readonly failureCode: WhatsAppInboundMediaFailure } | { readonly kind: "lease_lost"; readonly ledgerId: string } | { readonly kind: "conflict"; readonly ledgerId?: string };

export class WhatsAppInboundMediaRecoveryService {
  public constructor(private readonly ledger: WhatsAppInboundMediaRepository, private readonly provider: WhatsAppInboundMediaProviderPort, private readonly media: MediaService, private readonly gates: ChannelProviderEventRepository, private readonly clock: { now(): string }, private readonly leaseMilliseconds = 60_000) {}

  public async recoverNext(context: WorkspaceContext, companyId: number, connectionId: string, workerId: string): Promise<WhatsAppInboundMediaRecoveryOutcome> {
    const now = this.clock.now(), claimed = this.ledger.claimInboundMediaForRecovery(context, companyId, connectionId, workerId, now, new Date(Date.parse(now) + this.leaseMilliseconds).toISOString());
    if (!claimed) return { kind: "idle" };
    const { media: row, leaseToken } = claimed;
    const downloaded = await this.provider.download(context, companyId, connectionId, row.descriptor);
    if (downloaded.kind !== "downloaded") return this.settleProvider(context, companyId, connectionId, row.id, row.eventId, leaseToken, row.attemptCount, downloaded.kind);
    try {
      const asset = await this.media.store(context, companyId, { operation: "ingest", idempotencyKey: `whatsapp-inbound:${row.id}`, declaredMediaType: downloaded.download.mediaType, ...(downloaded.download.filename === null ? {} : { filename: downloaded.download.filename }), content: downloaded.download.content });
      this.media.attach(context, companyId, asset.id, "conversation_message", row.conversationMessageId);
      const settled = this.ledger.markAssociated(context, companyId, connectionId, row.id, leaseToken, asset.id, this.clock.now());
      if (settled.kind === "lease_lost") return { kind: "lease_lost", ledgerId: row.id };
      if (settled.kind === "conflict" || settled.kind === "not_found") return { kind: "conflict", ledgerId: row.id };
      return this.gate(context, companyId, connectionId, row.eventId, row.id, { kind: "associated", ledgerId: row.id, mediaAssetId: asset.id });
    } catch (error: unknown) { return this.settleFailure(context, companyId, connectionId, row.id, row.eventId, leaseToken, row.attemptCount, mediaFailure(error)); }
  }
  public async recoverAvailable(workerId: string, limit = 25): Promise<readonly WhatsAppInboundMediaRecoveryOutcome[]> { const scopes = this.ledger.recoverableScopes(this.clock.now(), limit), outcomes = await Promise.all(scopes.map((scope) => this.recoverNext({ workspaceId: scope.workspaceId, workspaceKey: "whatsapp" }, scope.companyId, scope.connectionId, workerId))); for (const candidate of this.ledger.settledGateCandidates(limit)) { const context = { workspaceId: candidate.workspaceId, workspaceKey: "whatsapp" }, requestId = this.gates.findExecutionRequestIdForEvent(context, candidate.companyId, candidate.connectionId, candidate.eventId); if (requestId) this.gates.recomputeExecutionMediaGate(context, candidate.companyId, candidate.connectionId, requestId, this.clock.now()); } return outcomes; }

  private settleProvider(context: WorkspaceContext, companyId: number, connectionId: string, ledgerId: string, eventId: string, token: string, attempts: number, kind: Exclude<WhatsAppInboundMediaDownloadResult["kind"], "downloaded">): WhatsAppInboundMediaRecoveryOutcome {
    const mapping: Record<typeof kind, { code: WhatsAppInboundMediaFailure; retryable: boolean }> = { unavailable: { code: "provider_temporary_failure", retryable: true }, timeout: { code: "provider_temporary_failure", retryable: true }, not_found: { code: "media_expired", retryable: false }, unauthorized: { code: "integration_not_ready", retryable: false }, invalid_response: { code: "media_mime_mismatch", retryable: false }, too_large: { code: "media_too_large", retryable: false }, unsafe_location: { code: "media_download_failed", retryable: false } };
    return this.settleFailure(context, companyId, connectionId, ledgerId, eventId, token, attempts, mapping[kind]);
  }

  private settleFailure(context: WorkspaceContext, companyId: number, connectionId: string, ledgerId: string, eventId: string, token: string, attempts: number, failure: { code: WhatsAppInboundMediaFailure; retryable: boolean }): WhatsAppInboundMediaRecoveryOutcome {
    const at = this.clock.now(), retryable = failure.retryable && attempts < 3;
    const settled = retryable ? this.ledger.markRetryableFailure(context, companyId, connectionId, ledgerId, token, failure.code, new Date(Date.parse(at) + retryDelay(attempts)).toISOString(), at) : this.ledger.markTerminalFailure(context, companyId, connectionId, ledgerId, token, failure.code, at);
    if (settled.kind === "lease_lost") return { kind: "lease_lost", ledgerId };
    if (settled.kind === "conflict" || settled.kind === "not_found") return { kind: "conflict", ledgerId };
    return this.gate(context, companyId, connectionId, eventId, ledgerId, retryable ? { kind: "retry_scheduled", ledgerId, failureCode: failure.code } : { kind: "terminal", ledgerId, failureCode: failure.code });
  }

  private gate(context: WorkspaceContext, companyId: number, connectionId: string, eventId: string, ledgerId: string, outcome: Exclude<WhatsAppInboundMediaRecoveryOutcome, { readonly kind: "idle" | "lease_lost" | "conflict" }>): WhatsAppInboundMediaRecoveryOutcome { const requestId = this.gates.findExecutionRequestIdForEvent(context, companyId, connectionId, eventId); if (!requestId) return { kind: "conflict", ledgerId }; const gate = this.gates.recomputeExecutionMediaGate(context, companyId, connectionId, requestId, this.clock.now()); return gate.kind === "conflict" || gate.kind === "not_found" ? { kind: "conflict", ledgerId } : outcome; }
}

function retryDelay(attempts: number): number { return attempts <= 1 ? 30_000 : attempts === 2 ? 120_000 : 600_000; }
function mediaFailure(error: unknown): { code: WhatsAppInboundMediaFailure; retryable: boolean } { if (error instanceof WhatsAppInboundMediaDownloadStreamError) return error.kind === "too_large" ? { code: "media_too_large", retryable: false } : error.kind === "timeout" ? { code: "provider_temporary_failure", retryable: true } : { code: "media_mime_mismatch", retryable: false }; if (error instanceof MediaDomainError) return error.code === "media_too_large" ? { code: "media_too_large", retryable: false } : error.code === "media_type_unsupported" ? { code: "unsupported_media", retryable: false } : error.code === "media_type_mismatch" ? { code: "media_mime_mismatch", retryable: false } : error.code === "media_not_associable" ? { code: "association_failed", retryable: false } : { code: "media_ingest_failed", retryable: false }; return { code: "media_ingest_failed", retryable: false }; }
