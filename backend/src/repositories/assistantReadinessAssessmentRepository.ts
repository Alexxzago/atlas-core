import type { AssistantReadinessAssessmentRepositoryPort } from "../assistant/application/assistantReadinessPorts.js";
import { assistantReadinessPolicyVersion, defaultAssistantIdentifier, type AssistantReadinessAssessment, type AssistantReadinessBlocker } from "../assistant/domain/assistantReadiness.js";
import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

type Row = { id:string; assistant_identifier:string; workspace_id:number; company_id:number; status:"ready"|"blocked"; blockers_json:string; knowledge_version_id:string|null; assistant_profile_id:string|null; whatsapp_connection_id:string|null; policy_version:string; configuration_digest:string; evaluated_at:string; };
function map(row: Row): AssistantReadinessAssessment { return Object.freeze({ id: row.id, assistantIdentifier: defaultAssistantIdentifier, workspaceId: row.workspace_id, companyId: row.company_id, status: row.status, blockers: Object.freeze(JSON.parse(row.blockers_json) as AssistantReadinessBlocker[]), knowledgeVersionId: row.knowledge_version_id, assistantProfileId: row.assistant_profile_id, whatsAppConnectionId: row.whatsapp_connection_id, policyVersion: assistantReadinessPolicyVersion, configurationDigest: row.configuration_digest, evaluatedAt: row.evaluated_at }); }

export class AssistantReadinessAssessmentRepository implements AssistantReadinessAssessmentRepositoryPort {
  public constructor(private readonly db: SynchronousDatabase) {}
  public create(context: WorkspaceContext, value: AssistantReadinessAssessment): AssistantReadinessAssessment {
    const result = this.db.prepare("INSERT INTO assistant_readiness_assessments(id,assistant_identifier,workspace_id,company_id,status,blockers_json,knowledge_version_id,assistant_profile_id,whatsapp_connection_id,policy_version,configuration_digest,evaluated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM companies WHERE id=? AND workspace_id=?)").run(value.id, value.assistantIdentifier, value.workspaceId, value.companyId, value.status, JSON.stringify(value.blockers), value.knowledgeVersionId, value.assistantProfileId, value.whatsAppConnectionId, value.policyVersion, value.configurationDigest, value.evaluatedAt, value.companyId, context.workspaceId);
    if (result.changes !== 1) throw new Error("Assistant readiness company scope is invalid.");
    return value;
  }
  public findLatest(context: WorkspaceContext, companyId: number, connectionId: string | null): AssistantReadinessAssessment | null {
    const row = this.db.prepare("SELECT * FROM assistant_readiness_assessments WHERE workspace_id=? AND company_id=? AND assistant_identifier='default' AND ((whatsapp_connection_id IS NULL AND ? IS NULL) OR whatsapp_connection_id=?) ORDER BY evaluated_at DESC,id DESC LIMIT 1").get(context.workspaceId, companyId, connectionId, connectionId) as Row | undefined;
    return row ? map(row) : null;
  }
}
