import type { WorkspaceContext } from "../../types/workspaceContext.js";
import { integrationConnectionId } from "../../integrations/domain/integrationConnection.js";
import { IntegrationConnectionService } from "../../integrations/services/integrationConnectionService.js";
import type { AsyncWhatsAppCredentialResolverPort, AsyncWhatsAppLinkedIntegrationCredentialRepositoryPort } from "./ports.js";
import { whatsAppConnectionId } from "../domain/whatsappConnection.js";
import { WhatsAppConnectionService } from "../services/WhatsAppConnectionService.js";
import type { MetaEmbeddedSignupProvider, MetaEmbeddedSignupProviderFailure } from "../providers/MetaEmbeddedSignupProvider.js";
import { reconstructMetaWhatsAppIntegrationConfiguration } from "./metaEmbeddedSignupIntegration.js";
import type { MetaEmbeddedSignupOperationalAuditPort } from "./metaEmbeddedSignupAudit.js";

export type MetaWhatsAppReadinessOutcome =
  | { readonly kind: "ready" | "replayed"; readonly whatsAppConnectionId: string; readonly subscribed: true }
  | { readonly kind: "unready" | "reconnect_required" | "conflict" | "not_found" | "rate_limited" | "unavailable" | "timeout" | "invalid_response" | "validation_error" };

export class MetaWhatsAppReadinessService {
  public constructor(private readonly links: AsyncWhatsAppLinkedIntegrationCredentialRepositoryPort, private readonly credentials: AsyncWhatsAppCredentialResolverPort, private readonly integrations: IntegrationConnectionService, private readonly whatsApp: WhatsAppConnectionService, private readonly provider: MetaEmbeddedSignupProvider, private readonly audit?: MetaEmbeddedSignupOperationalAuditPort, private readonly clock: { now(): string } = { now: () => new Date().toISOString() }) {}
  public async ensureReady(input: { readonly workspaceId: number; readonly companyId: number; readonly whatsAppConnectionId: string; readonly setupSubscription: boolean }): Promise<MetaWhatsAppReadinessOutcome> {
    const context: WorkspaceContext = Object.freeze({ workspaceId: input.workspaceId, workspaceKey: "meta-whatsapp-readiness" });
    let connection;
    try { connection = await this.whatsApp.get(context, input.companyId, whatsAppConnectionId(input.whatsAppConnectionId)); } catch { return { kind: "not_found" }; }
    const linkedId = await this.links.findIntegrationConnectionId(context, input.companyId, connection.id);
    if (!linkedId) return { kind: "unready" };
    const inspected = await this.integrations.inspect(context, input.companyId, integrationConnectionId(linkedId));
    if (!inspected || !inspected.hasCurrentSecret || inspected.connection.provider !== "meta_whatsapp" || inspected.connection.kind !== "cloud_api" || inspected.state?.validationState !== "valid" || inspected.state.healthState !== "healthy") return { kind: "unready" };
    let config;
    try { config = reconstructMetaWhatsAppIntegrationConfiguration(inspected.connection.configuration); } catch { return { kind: "unready" }; }
    if (config.wabaId !== connection.whatsappBusinessAccountId || config.phoneNumberId !== connection.phoneNumberId) return { kind: "conflict" };
    try { if (inspected.connection.status !== "active") await this.integrations.activate(context, input.companyId, inspected.connection.id); } catch { return { kind: "unready" }; }
    const accessToken = await this.credentials.resolve(context, input.companyId, connection.id);
    if (!accessToken) return { kind: "reconnect_required" };
    try {
      const validation = await this.whatsApp.validate(context, input.companyId, connection.id);
      if (validation.validationState !== "valid") return { kind: "reconnect_required" };
    } catch { return { kind: "unready" }; }
    let subscriptionChanged = false;
    let subscription = await this.provider.inspectWabaSubscription({ wabaId: config.wabaId, accessToken, signal: new AbortController().signal });
    if (subscription.kind !== "success") return providerFailure(subscription.kind);
    if (!subscription.subscribed) {
      if (!input.setupSubscription) return { kind: "unready" };
      const mutation = await this.provider.subscribeWaba({ wabaId: config.wabaId, accessToken, signal: new AbortController().signal });
      if (mutation.kind !== "success") return providerFailure(mutation.kind);
      subscriptionChanged = true;
      subscription = await this.provider.inspectWabaSubscription({ wabaId: config.wabaId, accessToken, signal: new AbortController().signal });
      if (subscription.kind !== "success") return providerFailure(subscription.kind);
      if (!subscription.subscribed) return { kind: "unready" };
    }
    await this.audit?.record({ type: "meta_signup_waba_subscription_confirmed", workspaceId: input.workspaceId, companyId: input.companyId, integrationConnectionId: linkedId, whatsAppConnectionId: connection.id, subscriptionChanged, at: this.clock.now() });
    const wasActive = connection.status === "active";
    try { const activated = await this.whatsApp.activate(context, input.companyId, connection.id); if (activated.connection.status !== "active") return { kind: "unready" }; } catch { return { kind: "unready" }; }
    if (!wasActive) await this.audit?.record({ type: "meta_signup_whatsapp_activated", workspaceId: input.workspaceId, companyId: input.companyId, integrationConnectionId: linkedId, whatsAppConnectionId: connection.id, at: this.clock.now() });
    await this.audit?.record({ type: "meta_signup_ready", workspaceId: input.workspaceId, companyId: input.companyId, integrationConnectionId: linkedId, whatsAppConnectionId: connection.id, at: this.clock.now() });
    return Object.freeze({ kind: wasActive ? "replayed" : "ready", whatsAppConnectionId: connection.id, subscribed: true });
  }
}
function providerFailure(kind: MetaEmbeddedSignupProviderFailure): MetaWhatsAppReadinessOutcome {
  if (kind === "unauthorized" || kind === "forbidden") return { kind: "reconnect_required" };
  if (kind === "rate_limited" || kind === "unavailable" || kind === "timeout" || kind === "invalid_response" || kind === "validation_error" || kind === "not_found" || kind === "conflict") return { kind: kind === "not_found" || kind === "conflict" ? "unready" : kind };
  return { kind: "unready" };
}
