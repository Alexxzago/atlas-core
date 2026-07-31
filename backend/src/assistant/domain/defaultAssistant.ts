import type { AssistantProfileId } from "./assistantProfile.js";

export interface DefaultAssistantAssignment { readonly workspaceId:number; readonly companyId:number; readonly assistantProfileId:AssistantProfileId; readonly version:number; readonly assignedAt:string; readonly updatedAt:string; readonly assignedByActorId:string|null; readonly source:string|null; }
