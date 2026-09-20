import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { AssistantReadinessAssessment } from "../domain/assistantReadiness.js";

export interface AssistantReadinessAssessmentRepositoryPort {
  create(context: WorkspaceContext, assessment: AssistantReadinessAssessment): Promise<AssistantReadinessAssessment>;
  findLatest(context: WorkspaceContext, companyId: number, whatsAppConnectionId: string | null): Promise<AssistantReadinessAssessment | null>;
}
