import type{Workspace}from"../../types/workspace.js";import{createWorkspaceContext,type WorkspaceContext}from"../../types/workspaceContext.js";import type{AuthorizationDecision}from"./authorizationService.js";
export class WorkspaceResolutionError extends Error{}
interface WorkspaceReadPort{findById(id:number):Workspace|null|Promise<Workspace|null>;}
export class WorkspaceResolver{public constructor(private readonly workspaces:WorkspaceReadPort){}public async resolve(decision:AuthorizationDecision):Promise<WorkspaceContext>{const workspace=await this.workspaces.findById(decision.workspaceId);if(!workspace||workspace.publicId!==decision.workspacePublicId)throw new WorkspaceResolutionError();return createWorkspaceContext(workspace);}}
