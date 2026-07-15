import type { Workspace } from "./workspace.js";

export interface WorkspaceContext {
  readonly workspaceId: number;
  readonly workspaceKey: string;
}

export function createWorkspaceContext(workspace: Workspace): WorkspaceContext {
  return Object.freeze({
    workspaceId: workspace.id,
    workspaceKey: workspace.key,
  });
}
