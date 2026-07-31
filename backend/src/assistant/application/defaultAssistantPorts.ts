import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { DefaultAssistantAssignment } from "../domain/defaultAssistant.js";
export interface DefaultAssistantRepositoryPort { find(context:WorkspaceContext,companyId:number):DefaultAssistantAssignment|null; assign(context:WorkspaceContext,value:DefaultAssistantAssignment,expectedVersion:number|null):DefaultAssistantAssignment|null; }
