import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import { randomUUID } from "node:crypto";
import type { WorkspaceRepositoryPort } from "../application/ports/repositories.js";
import { database } from "../config/database.js";
import type { Workspace } from "../types/workspace.js";

interface WorkspaceRow {
  id: number;
  public_id: string;
  key: string;
  name: string;
  timezone: string | null;
  default_locale: "en" | "es" | null;
  created_at: string;
}

function mapWorkspace(row: WorkspaceRow): Workspace {
  return { id: row.id, publicId: row.public_id, key: row.key, name: row.name, timezone: row.timezone, defaultLocale: row.default_locale, createdAt: row.created_at };
}

export class WorkspaceRepository implements WorkspaceRepositoryPort {
  private settingsAvailable: boolean | null = null;
  public constructor(private readonly db: SynchronousDatabase) {}

  public findById(workspaceId: number): Workspace | null {
    const row = this.db.prepare(`
       SELECT ${this.columns()}
      FROM workspaces
      WHERE id = ?
    `).get(workspaceId) as WorkspaceRow | undefined;
    return row ? mapWorkspace(row) : null;
  }

  public findByKey(workspaceKey: string): Workspace | null {
    const row = this.db.prepare(`
       SELECT ${this.columns()}
      FROM workspaces
      WHERE key = ?
    `).get(workspaceKey) as WorkspaceRow | undefined;
    return row ? mapWorkspace(row) : null;
  }

  public findByPublicId(publicId:string):Workspace|null{const row=this.db.prepare(`SELECT ${this.columns()} FROM workspaces WHERE public_id=?`).get(publicId) as WorkspaceRow|undefined;return row?mapWorkspace(row):null;}

  public resolveDefault(): Workspace {
    const workspace = this.findByKey("default");
    if (!workspace) throw new Error("Default workspace is not available.");
    return workspace;
  }

  public createForSystemUse(input: { key: string; name: string }): Workspace {
    return this.create({publicId:`wsp_${randomUUID().replaceAll("-","")}`,...input,timezone:null,defaultLocale:null});
  }

  public create(input:{publicId:string;key:string;name:string;timezone:string|null;defaultLocale:"en"|"es"|null}):Workspace{
    const result = this.db.prepare(`
      INSERT INTO workspaces (public_id, key, name, timezone, default_locale)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.publicId,input.key, input.name, input.timezone, input.defaultLocale);
    const workspace = this.findById(Number(result.lastInsertRowid));
    if (!workspace) throw new Error("Workspace could not be created.");
    return workspace;
  }
  private columns(): string { if (this.settingsAvailable === null) this.settingsAvailable = (this.db.prepare("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>).some((column) => column.name === "timezone"); return this.settingsAvailable ? "id, public_id, key, name, timezone, default_locale, created_at" : "id, public_id, key, name, NULL AS timezone, NULL AS default_locale, created_at"; }
}

export const workspaceRepository = new WorkspaceRepository(database);
