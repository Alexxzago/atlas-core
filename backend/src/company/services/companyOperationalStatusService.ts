import type { CompanyRepositoryPort } from "../../application/ports/repositories.js";
import type { AssistantReadinessAssessmentRepositoryPort } from "../../assistant/application/assistantReadinessPorts.js";
import { normalizeOperationalError, operationalLogger } from "../../observability/operationalLogger.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { WhatsAppConnectionOperationalStateRepositoryPort, WhatsAppConnectionRepositoryPort } from "../../whatsapp/application/ports.js";

const maximumWhatsAppStatuses = 20;

export class CompanyOperationalStatusNotFoundError extends Error {}
export interface CompanyOperationalStatus { readonly assistant: { readonly status: "ready" | "blocked" | "unavailable"; readonly evaluatedAt: string | null; readonly blockers: readonly string[] }; readonly whatsApp: readonly { readonly connectionId: string; readonly status: "active" | "inactive"; readonly validationState: "not_validated" | "valid" | "invalid"; readonly healthState: "inactive" | "healthy" | "degraded" }[]; readonly voice: { readonly status: "unavailable" }; }

export class CompanyOperationalStatusService {
  public constructor(private readonly companies: CompanyRepositoryPort, private readonly assessments: AssistantReadinessAssessmentRepositoryPort, private readonly connections: WhatsAppConnectionRepositoryPort & WhatsAppConnectionOperationalStateRepositoryPort) {}
  public get(context: WorkspaceContext, companyId: number): CompanyOperationalStatus {
    try {
      if (!this.companies.findById(context, companyId)) throw new CompanyOperationalStatusNotFoundError();
      const assessment = this.assessments.findLatest(context, companyId, null);
      return Object.freeze({ assistant: Object.freeze(assessment ? { status: assessment.status, evaluatedAt: assessment.evaluatedAt, blockers: assessment.blockers } : { status: "unavailable", evaluatedAt: null, blockers: Object.freeze([]) }), whatsApp: Object.freeze(this.connections.listByCompany(context, companyId).slice(0, maximumWhatsAppStatuses).map((connection) => { const state = this.connections.findOperationalState(context, companyId, connection.id); return Object.freeze({ connectionId: connection.id, status: connection.status, validationState: state?.validationState ?? "not_validated", healthState: state?.healthState ?? "inactive" }); })), voice: Object.freeze({ status: "unavailable" }) });
    } catch (error: unknown) {
      if (!(error instanceof CompanyOperationalStatusNotFoundError)) operationalLogger.warn("company_operational_status_failed", { subsystem: "operational_status", companyId, safeErrorCategory: normalizeOperationalError(error) });
      throw error;
    }
  }
}
