import { createHash, randomUUID } from "node:crypto";
import type { CompanyRepositoryPort } from "../../application/ports/repositories.js";
import type { KnowledgeRepositoryPort } from "../../knowledge/application/ports.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { WhatsAppConnectionCredentialRepositoryPort, WhatsAppConnectionOperationalStateRepositoryPort, WhatsAppConnectionRepositoryPort } from "../../whatsapp/application/ports.js";
import type { WhatsAppConnectionId } from "../../whatsapp/domain/whatsappConnection.js";
import { assessAssistantReadiness, type AssistantReadinessAssessment } from "../domain/assistantReadiness.js";
import type { AssistantProfileRepositoryPort } from "../application/ports.js";
import type { AssistantReadinessAssessmentRepositoryPort } from "../application/assistantReadinessPorts.js";
import type { DefaultAssistantService } from "./defaultAssistantService.js";

export class AssistantReadinessNotFoundError extends Error {}

export class AssistantReadinessService {
  public constructor(private readonly companies: CompanyRepositoryPort, private readonly knowledge: KnowledgeRepositoryPort, private readonly profiles: AssistantProfileRepositoryPort, private readonly connections: WhatsAppConnectionRepositoryPort & WhatsAppConnectionCredentialRepositoryPort & WhatsAppConnectionOperationalStateRepositoryPort, private readonly assessments: AssistantReadinessAssessmentRepositoryPort, private readonly defaults: DefaultAssistantService, private readonly clock: { now(): string }) {}
  public get(context: WorkspaceContext, companyId: number): AssistantReadinessAssessment { return this.assess(context, companyId); }
  public assess(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId | null = null): AssistantReadinessAssessment { return this.evaluate(context, companyId, connectionId, false); }
  public refresh(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId | null = null): AssistantReadinessAssessment {
    return this.assessments.create(context, this.evaluate(context, companyId, connectionId, true));
  }
  private evaluate(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId | null, persistCompatibilityDefault: boolean): AssistantReadinessAssessment {
    if (!this.companies.findById(context, companyId)) throw new AssistantReadinessNotFoundError();
    const knowledge = this.knowledge.loadCurrentVersion(context, companyId);
    const listed = this.profiles.listActive(context, companyId), ready = listed.status === "found" ? listed.profiles.filter((profile) => profile.status === "ready") : [];
    const assignment = this.defaults.get(context, companyId) ?? (persistCompatibilityDefault ? this.defaults.bootstrap(context, companyId) : this.defaults.suggest(context, companyId));
    const profile = assignment?.assistantProfileId;
    const selected = profile ? this.profiles.findById(context, companyId, profile) : null;
    const connection = connectionId ? this.connections.findById(context, companyId, connectionId) : null;
    const credentials = !!connection && !!this.connections.findCredentials(context, companyId, connection.id);
    const validation = connection ? this.connections.findOperationalState(context, companyId, connection.id)?.validationState ?? "not_validated" : null;
    const assessment = assessAssistantReadiness({
      id: `ara_${randomUUID().replaceAll("-", "")}`,
      workspaceId: context.workspaceId,
      companyId,
      knowledge: knowledge ? { id: knowledge.id, snapshotDigest: knowledge.snapshotDigest } : null,
      readyProfileCount: ready.length,
      assignmentProfileId: profile ?? null,
      selectedProfile: selected,
      whatsApp: { requestedConnectionId: connectionId, connection, hasCredentials: credentials, validationState: validation },
      evaluatedAt: this.clock.now(),
      configurationDigest: digest({ knowledgeVersionId: knowledge?.id ?? null, knowledgeDigest: knowledge?.snapshotDigest ?? null, assistantProfileId: selected?.id ?? null, profileUpdatedAt: selected?.updatedAt ?? null, connectionId: connection?.id ?? connectionId, connectionUpdatedAt: connection?.updatedAt ?? null, credentials, validation }),
    });
    return assessment;
  }
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
