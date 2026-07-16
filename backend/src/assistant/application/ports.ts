import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { AssistantProfile, AssistantProfileId } from "../domain/assistantProfile.js";

export type CreateAssistantProfileResult =
  | { status: "created"; profile: AssistantProfile }
  | { status: "company_not_found" }
  | { status: "name_conflict" };

export type UpdateAssistantProfileResult =
  | { status: "updated"; profile: AssistantProfile }
  | { status: "not_found" }
  | { status: "name_conflict" };

export type ListActiveAssistantProfilesResult =
  | { status: "found"; profiles: readonly AssistantProfile[] }
  | { status: "company_not_found" };

export interface AssistantProfileRepositoryPort {
  listActive(context: WorkspaceContext, companyId: number): ListActiveAssistantProfilesResult;
  findById(context: WorkspaceContext, companyId: number, assistantProfileId: AssistantProfileId): AssistantProfile | null;
  create(context: WorkspaceContext, companyId: number, profile: AssistantProfile): CreateAssistantProfileResult;
  update(context: WorkspaceContext, companyId: number, profile: AssistantProfile): UpdateAssistantProfileResult;
}
