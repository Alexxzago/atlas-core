import type { SqlDatabase } from "../../config/sqlDatabase.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export interface PlatformReadinessCompany { readonly id: number; readonly name: string; }

/** Async-only persistence used by the platform readiness fanout. */
export class AsyncPlatformPilotReadinessPersistence {
  public constructor(private readonly database: SqlDatabase) {}

  public async workspaceContext(publicId: string): Promise<WorkspaceContext | null> {
    const rows = await this.database.query<{ id: number; key: string }>("SELECT id,key FROM workspaces WHERE public_id=?", [publicId]);
    const row = rows[0];
    return row ? Object.freeze({ workspaceId: Number(row.id), workspaceKey: String(row.key) }) : null;
  }

  public async readinessCompanies(context: WorkspaceContext): Promise<readonly PlatformReadinessCompany[]> {
    return Object.freeze((await this.database.query<{ id: number; name: string }>("SELECT id,name FROM companies WHERE workspace_id=? ORDER BY id DESC", [context.workspaceId])).map((row) => Object.freeze({ id: Number(row.id), name: String(row.name) })));
  }
}

export function createAsyncPlatformPilotReadinessPersistence(database: SqlDatabase): AsyncPlatformPilotReadinessPersistence {
  return new AsyncPlatformPilotReadinessPersistence(database);
}
