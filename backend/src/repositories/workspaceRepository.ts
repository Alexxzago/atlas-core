import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceRepositoryPort } from "../application/ports/repositories.js";
import { database } from "../config/database.js";
import type { Workspace } from "../types/workspace.js";

interface WorkspaceRow {
  id: number;
  key: string;
  name: string;
  created_at: string;
}

function mapWorkspace(row: WorkspaceRow): Workspace {
  return { id: row.id, key: row.key, name: row.name, createdAt: row.created_at };
}

export class WorkspaceRepository implements WorkspaceRepositoryPort {
  public constructor(private readonly db: DatabaseSync) {}

  public findById(workspaceId: number): Workspace | null {
    const row = this.db.prepare(`
      SELECT id, key, name, created_at
      FROM workspaces
      WHERE id = ?
    `).get(workspaceId) as WorkspaceRow | undefined;
    return row ? mapWorkspace(row) : null;
  }

  public findByKey(workspaceKey: string): Workspace | null {
    const row = this.db.prepare(`
      SELECT id, key, name, created_at
      FROM workspaces
      WHERE key = ?
    `).get(workspaceKey) as WorkspaceRow | undefined;
    return row ? mapWorkspace(row) : null;
  }

  public resolveDefault(): Workspace {
    const workspace = this.findByKey("default");
    if (!workspace) throw new Error("Default workspace is not available.");
    return workspace;
  }

  public createForSystemUse(input: { key: string; name: string }): Workspace {
    const result = this.db.prepare(`
      INSERT INTO workspaces (key, name)
      VALUES (?, ?)
    `).run(input.key, input.name);
    const workspace = this.findById(Number(result.lastInsertRowid));
    if (!workspace) throw new Error("Workspace could not be created.");
    return workspace;
  }
}

export const workspaceRepository = new WorkspaceRepository(database);
