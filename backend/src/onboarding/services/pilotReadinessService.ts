import type { AssistantReadinessService } from "../../assistant/services/assistantReadinessService.js";
import type { BillingPilotReadiness } from "../../billing/services/billingEntitlementService.js";
import type { CompanyDomainRepositoryPort } from "../../company/application/ports.js";
import type { KnowledgeRepositoryPort } from "../../knowledge/application/ports.js";
import type { ProactiveActionRepositoryPort } from "../../proactive/application/ports.js";
import type { SchedulingConfigurationService } from "../../scheduling/services/schedulingConfigurationService.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { WebChatConnectionRepositoryPort } from "../../webChat/application/ports.js";
import type { WhatsAppConnectionCredentialRepositoryPort, WhatsAppConnectionOperationalStateRepositoryPort, WhatsAppConnectionRepositoryPort } from "../../whatsapp/application/ports.js";
import { operationalLogger } from "../../observability/operationalLogger.js";
import { assessPilotReadiness, type PilotReadinessAssessment, type PilotReadinessFacts } from "../domain/pilotReadiness.js";

export class PilotReadinessNotFoundError extends Error {}
export class PilotReadinessUnavailableError extends Error {}

export interface PilotReadinessProjection extends PilotReadinessAssessment { readonly evaluatedAt: string; }
export interface PilotReadinessPlatformCapabilities { readonly whatsAppEmbeddedSignupAvailable: boolean; }
export interface PilotReadinessBillingPort { pilotReadiness(workspaceId: number): BillingPilotReadiness; }

export class PilotReadinessService {
  private readonly classifications = new Map<string, PilotReadinessProjection["classification"]>();

  public constructor(
    private readonly companies: CompanyDomainRepositoryPort,
    private readonly assistantReadiness: AssistantReadinessService,
    private readonly knowledge: KnowledgeRepositoryPort,
    private readonly webChat: WebChatConnectionRepositoryPort,
    private readonly whatsApp: WhatsAppConnectionRepositoryPort & WhatsAppConnectionCredentialRepositoryPort & WhatsAppConnectionOperationalStateRepositoryPort,
    private readonly billing: PilotReadinessBillingPort,
    private readonly platform: PilotReadinessPlatformCapabilities,
    private readonly clock: { now(): string },
    private readonly optional: { readonly scheduling?: SchedulingConfigurationService; readonly proactive?: ProactiveActionRepositoryPort } = {},
  ) {}

  public async get(context: WorkspaceContext, companyId: number): Promise<PilotReadinessProjection> {
    try {
      const company = this.companies.findById(context, companyId as import("../../company/domain/company.js").CompanyId);
      if (!company) throw new PilotReadinessNotFoundError();
      const assistant = this.assistantReadiness.assess(context, companyId);
      const facts: PilotReadinessFacts = {
        workspaceContextValid: true,
        company: company.lifecycle === "suspended" ? "suspended" : company.lifecycle === "archived" ? "archived" : "active",
        defaultAssistantExecutable: assistant.assistantProfileId !== null && !assistant.blockers.some((blocker) => blocker.startsWith("default_assistant_")),
        publishedKnowledge: this.knowledge.loadCurrentVersion(context, companyId) !== null,
        commercial: this.billing.pilotReadiness(context.workspaceId),
        webChat: this.webChatState(context, companyId, assistant.assistantProfileId),
        whatsApp: this.whatsAppState(context, companyId, assistant.assistantProfileId),
        ...(await this.optionalFacts(context, companyId)),
      };
      const projection = Object.freeze({ ...assessPilotReadiness(facts), evaluatedAt: this.clock.now() });
      this.recordEvaluation(context, companyId, projection);
      return projection;
    } catch (error: unknown) {
      if (error instanceof PilotReadinessNotFoundError) throw error;
      throw new PilotReadinessUnavailableError();
    }
  }

  private recordEvaluation(context: WorkspaceContext, companyId: number, projection: PilotReadinessProjection): void {
    const fields = { workspaceId: context.workspaceId, companyId, outcome: projection.classification } as const;
    operationalLogger.info("pilot_readiness_evaluated", fields);
    const key = `${context.workspaceId}:${companyId}`, previous = this.classifications.get(key);
    if (previous === projection.classification) return;
    this.classifications.set(key, projection.classification);
    operationalLogger.info("pilot_readiness_classification_changed", fields);
    if (projection.checks.some((check) => check.required && check.status !== "complete")) operationalLogger.info("pilot_readiness_required_blocked", fields);
    if (projection.classification === "external_provider_blocked") operationalLogger.info("pilot_readiness_external_provider_blocked", fields);
    if (projection.classification === "pilot_ready") operationalLogger.info("pilot_readiness_pilot_ready_reached", fields);
  }

  private webChatState(context: WorkspaceContext, companyId: number, defaultProfileId: string | null): PilotReadinessFacts["webChat"] {
    if (this.webChat.listByCompany(context, companyId).some((connection) => connection.status === "active" && connection.assistantProfileId === defaultProfileId)) return "operational";
    return this.webChat.listByCompany(context, companyId).some((connection) => connection.status === "inactive") ? "inactive" : "absent";
  }

  private whatsAppState(context: WorkspaceContext, companyId: number, defaultProfileId: string | null): PilotReadinessFacts["whatsApp"] {
    const connections = this.whatsApp.listByCompany(context, companyId);
    for (const connection of connections) {
      const state = this.whatsApp.findOperationalState(context, companyId, connection.id);
      const credentials = this.whatsApp.findCredentials(context, companyId, connection.id);
      if (connection.status === "active" && connection.assistantProfileId === defaultProfileId && credentials && state?.validationState === "valid" && state.healthState === "healthy") return "operational";
    }
    if (connections.some((connection) => this.whatsApp.findOperationalState(context, companyId, connection.id)?.healthState === "degraded")) return "health_degraded";
    if (connections.some((connection) => this.whatsApp.findOperationalState(context, companyId, connection.id)?.validationState === "invalid")) return "validation_failed";
    if (connections.some((connection) => connection.status === "inactive")) return "inactive";
    return connections.length ? "inactive" : this.platform.whatsAppEmbeddedSignupAvailable ? "absent" : "platform_configuration_unavailable";
  }

  private async optionalFacts(context: WorkspaceContext, companyId: number): Promise<Pick<PilotReadinessFacts, "schedulingRelevant" | "schedulingConfigured" | "proactiveRelevant" | "proactiveConfigured">> {
    let schedulingRelevant = false, schedulingConfigured = false;
    if (this.optional.scheduling) {
      const configuration = await this.optional.scheduling.read(context, companyId).catch(() => null);
      if (configuration) { schedulingRelevant = true; schedulingConfigured = (configuration.readiness as { state?: unknown } | undefined)?.state === "locally_configured"; }
    }
    const policy = this.optional.proactive?.findPolicy(context, companyId) ?? null;
    return { schedulingRelevant, schedulingConfigured, proactiveRelevant: policy !== null, proactiveConfigured: policy !== null };
  }
}
