import { createHash, randomUUID } from "node:crypto";
import type { CompanyRepositoryPort } from "../../application/ports/repositories.js";
import type { KnowledgeRepositoryPort } from "../../knowledge/application/ports.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { WhatsAppConnectionCredentialRepositoryPort, WhatsAppConnectionOperationalStateRepositoryPort, WhatsAppConnectionRepositoryPort } from "../../whatsapp/application/ports.js";
import type { WhatsAppConnectionId } from "../../whatsapp/domain/whatsappConnection.js";
import { AssistantProfileExecutionPolicy } from "../domain/assistantProfilePolicies.js";
import { assistantReadinessPolicyVersion, defaultAssistantIdentifier, type AssistantReadinessAssessment, type AssistantReadinessBlocker } from "../domain/assistantReadiness.js";
import type { AssistantProfileRepositoryPort } from "../application/ports.js";
import type { AssistantReadinessAssessmentRepositoryPort } from "../application/assistantReadinessPorts.js";
import type { DefaultAssistantService } from "./defaultAssistantService.js";

export class AssistantReadinessNotFoundError extends Error {}

export class AssistantReadinessService {
  private readonly policy = new AssistantProfileExecutionPolicy();
  public constructor(private readonly companies: CompanyRepositoryPort, private readonly knowledge: KnowledgeRepositoryPort, private readonly profiles: AssistantProfileRepositoryPort, private readonly connections: WhatsAppConnectionRepositoryPort & WhatsAppConnectionCredentialRepositoryPort & WhatsAppConnectionOperationalStateRepositoryPort, private readonly assessments: AssistantReadinessAssessmentRepositoryPort, private readonly defaults: DefaultAssistantService, private readonly clock: { now(): string }) {}
  public get(context: WorkspaceContext, companyId: number): AssistantReadinessAssessment { const value = this.assessments.findLatest(context, companyId, null); if (!value) throw new AssistantReadinessNotFoundError(); return value; }
  public refresh(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId | null = null): AssistantReadinessAssessment {
    if (!this.companies.findById(context, companyId)) throw new AssistantReadinessNotFoundError();
    const blockers: AssistantReadinessBlocker[] = [], knowledge = this.knowledge.loadCurrentVersion(context, companyId);
    if (!knowledge) blockers.push("published_knowledge_missing");
    const listed = this.profiles.listActive(context, companyId), ready = listed.status === "found" ? listed.profiles.filter((profile) => profile.status === "ready") : [];
    const assignment = this.defaults.get(context, companyId) ?? this.defaults.bootstrap(context, companyId);
    if (!assignment) blockers.push(ready.length > 1 ? "default_assistant_ambiguous" : "default_assistant_missing");
    const profile = assignment?.assistantProfileId;
    const selected = profile ? this.profiles.findById(context, companyId, profile) : null;
    if (assignment && !selected) blockers.push("default_assistant_not_found");
    else if (selected) { try { this.policy.assert(selected); } catch { blockers.push("default_assistant_not_executable"); } }
    const connection = connectionId ? this.connections.findById(context, companyId, connectionId) : null;
    if (connectionId) {
      if (!connection || !selected || connection.assistantProfileId !== selected.id) blockers.push("whatsapp_connection_inconsistent");
      if (!connection) blockers.push("whatsapp_connection_missing");
      else {
        if (!this.connections.findCredentials(context, companyId, connection.id)) blockers.push("whatsapp_credentials_missing");
        if (this.connections.findOperationalState(context, companyId, connection.id)?.validationState !== "valid") blockers.push("whatsapp_validation_missing");
      }
    }
    const evaluatedAt = this.clock.now(), ordered = [...new Set(blockers)].sort() as AssistantReadinessBlocker[];
    const assessment: AssistantReadinessAssessment = Object.freeze({ id: `ara_${randomUUID().replaceAll("-", "")}`, assistantIdentifier: defaultAssistantIdentifier, workspaceId: context.workspaceId, companyId, status: ordered.length === 0 ? "ready" : "blocked", blockers: Object.freeze(ordered), knowledgeVersionId: knowledge?.id ?? null, assistantProfileId: selected?.id ?? null, whatsAppConnectionId: connection?.id ?? connectionId, policyVersion: assistantReadinessPolicyVersion, configurationDigest: digest({ knowledgeVersionId: knowledge?.id ?? null, knowledgeDigest: knowledge?.snapshotDigest ?? null, assistantProfileId: selected?.id ?? null, profileUpdatedAt: selected?.updatedAt ?? null, connectionId: connection?.id ?? connectionId, connectionUpdatedAt: connection?.updatedAt ?? null, credentials: !!connection && !!this.connections.findCredentials(context, companyId, connection.id), validation: connection ? this.connections.findOperationalState(context, companyId, connection.id)?.validationState ?? "not_validated" : null }), evaluatedAt });
    return this.assessments.create(context, assessment);
  }
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
