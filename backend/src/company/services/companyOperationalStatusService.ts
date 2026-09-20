import type { AsyncCompanyLookupPort } from "../application/ports.js";
import type { AssistantReadinessAssessmentRepositoryPort } from "../../assistant/application/assistantReadinessPorts.js";
import { normalizeOperationalError, operationalLogger } from "../../observability/operationalLogger.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { AsyncWhatsAppConnectionOperationalStateRepositoryPort, AsyncWhatsAppConnectionRepositoryPort, WhatsAppConnectionOperationalStateRepositoryPort, WhatsAppConnectionRepositoryPort } from "../../whatsapp/application/ports.js";

const maximumWhatsAppStatuses = 20;

export class CompanyOperationalStatusNotFoundError extends Error {}
export interface CompanyOperationalStatus { readonly assistant: { readonly status: "ready" | "blocked" | "unavailable"; readonly evaluatedAt: string | null; readonly blockers: readonly string[] }; readonly whatsApp: readonly { readonly connectionId: string; readonly status: "active" | "inactive"; readonly validationState: "not_validated" | "valid" | "invalid"; readonly healthState: "inactive" | "healthy" | "degraded" }[]; readonly voice: { readonly status: "unavailable" }; }

export class CompanyOperationalStatusService {
  public constructor(private readonly companies: AsyncCompanyLookupPort, private readonly assessments: AssistantReadinessAssessmentRepositoryPort, private readonly connections: (WhatsAppConnectionRepositoryPort & WhatsAppConnectionOperationalStateRepositoryPort) | (AsyncWhatsAppConnectionRepositoryPort & AsyncWhatsAppConnectionOperationalStateRepositoryPort)) {}
  public async get(context: WorkspaceContext, companyId: number): Promise<CompanyOperationalStatus> {
    try {
      if (!await this.companies.findById(context, companyId as import("../domain/company.js").CompanyId)) throw new CompanyOperationalStatusNotFoundError();
      const assessment = await this.assessments.findLatest(context, companyId, null);
      const connections = (await this.connections.listByCompany(context, companyId)).slice(0, maximumWhatsAppStatuses);
      const whatsApp = await Promise.all(connections.map(async (connection) => {
        const state = await this.connections.findOperationalState(context, companyId, connection.id);
        return Object.freeze({ connectionId: connection.id, status: connection.status, validationState: state?.validationState ?? "not_validated", healthState: state?.healthState ?? "inactive" });
      }));
      return Object.freeze({ assistant: Object.freeze(assessment ? { status: assessment.status, evaluatedAt: assessment.evaluatedAt, blockers: assessment.blockers } : { status: "unavailable", evaluatedAt: null, blockers: Object.freeze([]) }), whatsApp: Object.freeze(whatsApp), voice: Object.freeze({ status: "unavailable" }) });
    } catch (error: unknown) {
      if (!(error instanceof CompanyOperationalStatusNotFoundError)) operationalLogger.warn("company_operational_status_failed", { subsystem: "operational_status", companyId, safeErrorCategory: normalizeOperationalError(error) });
      throw error;
    }
  }
}
