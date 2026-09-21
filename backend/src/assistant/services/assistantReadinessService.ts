import { createHash, randomUUID } from "node:crypto";
import type { AsyncCompanyLookupPort } from "../../company/application/ports.js";
import type { KnowledgeRepositoryPort } from "../../knowledge/application/ports.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { AsyncWhatsAppConnectionCredentialRepositoryPort, AsyncWhatsAppConnectionOperationalStateRepositoryPort, AsyncWhatsAppConnectionRepositoryPort, WhatsAppConnectionCredentialRepositoryPort, WhatsAppConnectionOperationalStateRepositoryPort, WhatsAppConnectionRepositoryPort } from "../../whatsapp/application/ports.js";
import type { WhatsAppConnectionId } from "../../whatsapp/domain/whatsappConnection.js";
import { assessAssistantReadiness, type AssistantReadinessAssessment } from "../domain/assistantReadiness.js";
import type { AssistantProfileRepositoryPort } from "../application/ports.js";
import type { AssistantReadinessAssessmentRepositoryPort } from "../application/assistantReadinessPorts.js";
import type { DefaultAssistantService } from "./defaultAssistantService.js";

export class AssistantReadinessNotFoundError extends Error {}

export class AssistantReadinessService {
  public constructor(private readonly companies: AsyncCompanyLookupPort, private readonly knowledge: KnowledgeRepositoryPort, private readonly profiles: AssistantProfileRepositoryPort, private readonly connections: (WhatsAppConnectionRepositoryPort & WhatsAppConnectionCredentialRepositoryPort & WhatsAppConnectionOperationalStateRepositoryPort) | (AsyncWhatsAppConnectionRepositoryPort & AsyncWhatsAppConnectionCredentialRepositoryPort & AsyncWhatsAppConnectionOperationalStateRepositoryPort), private readonly assessments: AssistantReadinessAssessmentRepositoryPort, private readonly defaults: DefaultAssistantService, private readonly clock: { now(): string }) {}
  public async get(context: WorkspaceContext, companyId: number): Promise<AssistantReadinessAssessment> { return this.assess(context, companyId); }
  public async assess(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId | null = null): Promise<AssistantReadinessAssessment> { return this.evaluate(context, companyId, connectionId, false); }
  public async refresh(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId | null = null): Promise<AssistantReadinessAssessment> {
    return this.assessments.create(context, await this.evaluate(context, companyId, connectionId, true));
  }
  private async evaluate(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId | null, persistCompatibilityDefault: boolean): Promise<AssistantReadinessAssessment> {
    if (!await this.companies.findById(context, companyId as import("../../company/domain/company.js").CompanyId)) throw new AssistantReadinessNotFoundError();
    const knowledge = await this.knowledge.loadCurrentVersion(context, companyId);
    const listed = await this.profiles.listActive(context, companyId), ready = listed.status === "found" ? listed.profiles.filter((profile) => profile.status === "ready") : [];
    const assignment = await this.defaults.get(context, companyId) ?? (persistCompatibilityDefault ? await this.defaults.bootstrap(context, companyId) : await this.defaults.suggest(context, companyId));
    const profile = assignment?.assistantProfileId;
    const selected = profile ? await this.profiles.findById(context, companyId, profile) : null;
    const connection = connectionId ? await this.connections.findById(context, companyId, connectionId) : null;
    const credentials = !!connection && !!await this.connections.findCredentials(context, companyId, connection.id);
    const validation = connection ? (await this.connections.findOperationalState(context, companyId, connection.id))?.validationState ?? "not_validated" : null;
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
