import type { DatabaseSync } from "node:sqlite";
import type { AssistantProfileRepositoryPort, CreateAssistantProfileResult, ListActiveAssistantProfilesResult, UpdateAssistantProfileResult } from "../assistant/application/ports.js";
import { reconstructAssistantProfile, type AssistantProfile, type AssistantProfileId, type AssistantLanguage, type AssistantProfileStatus, type AssistantTone } from "../assistant/domain/assistantProfile.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

interface AssistantProfileRow {
  id: string;
  company_id: number;
  name: string;
  normalized_name: string;
  description: string | null;
  business_role: string | null;
  objective: string | null;
  audience: string | null;
  tone: AssistantTone;
  assistant_language: AssistantLanguage;
  welcome_message: string | null;
  fallback_message: string;
  status: AssistantProfileStatus;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface SqliteConstraintError extends Error { errcode?: number; }
export class AssistantProfileRepositoryContractError extends Error {}

const columns = `p.id, p.company_id, p.name, p.normalized_name, p.description, p.business_role,
  p.objective, p.audience, p.tone, p.assistant_language, p.welcome_message,
  p.fallback_message, p.status, p.created_at, p.updated_at, p.archived_at`;

function mapProfile(row: AssistantProfileRow): AssistantProfile {
  return reconstructAssistantProfile({
    id: row.id as AssistantProfileId,
    companyId: row.company_id,
    name: row.name,
    normalizedName: row.normalized_name,
    description: row.description,
    businessRole: row.business_role,
    objective: row.objective,
    audience: row.audience,
    tone: row.tone,
    assistantLanguage: row.assistant_language,
    welcomeMessage: row.welcome_message,
    fallbackMessage: row.fallback_message,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  });
}

function isNameConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const sqlite = error as SqliteConstraintError;
  return sqlite.errcode === 2067 && error.message.includes("assistant_profiles.company_id, assistant_profiles.normalized_name");
}

export class AssistantProfileRepository implements AssistantProfileRepositoryPort {
  public constructor(private readonly db: DatabaseSync) {}

  public listActive(context: WorkspaceContext, companyId: number): ListActiveAssistantProfilesResult {
    const visible = this.db.prepare("SELECT 1 FROM companies WHERE workspace_id = ? AND id = ?")
      .get(context.workspaceId, companyId);
    if (!visible) return { status: "company_not_found" };
    const rows = this.db.prepare(`
      SELECT ${columns}
      FROM assistant_profiles p
      INNER JOIN companies c ON c.id = p.company_id
      WHERE c.workspace_id = ? AND c.id = ? AND p.status != 'archived'
      ORDER BY p.created_at DESC, p.id DESC
    `).all(context.workspaceId, companyId) as unknown as AssistantProfileRow[];
    return { status: "found", profiles: rows.map(mapProfile) };
  }

  public findById(context: WorkspaceContext, companyId: number, assistantProfileId: AssistantProfileId): AssistantProfile | null {
    const row = this.db.prepare(`
      SELECT ${columns}
      FROM assistant_profiles p
      INNER JOIN companies c ON c.id = p.company_id
      WHERE c.workspace_id = ? AND c.id = ? AND p.id = ?
    `).get(context.workspaceId, companyId, assistantProfileId) as AssistantProfileRow | undefined;
    return row ? mapProfile(row) : null;
  }

  public create(context: WorkspaceContext, companyId: number, profile: AssistantProfile): CreateAssistantProfileResult {
    this.assertOwnership(companyId, profile);
    try {
      const result = this.db.prepare(`
        INSERT INTO assistant_profiles (
          id, company_id, name, normalized_name, description, business_role, objective, audience,
          tone, assistant_language, welcome_message, fallback_message, status, created_at, updated_at, archived_at
        )
        SELECT ?, c.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM companies c
        WHERE c.id = ? AND c.workspace_id = ?
      `).run(
        profile.id, profile.name, profile.normalizedName, profile.description, profile.businessRole,
        profile.objective, profile.audience, profile.tone, profile.assistantLanguage,
        profile.welcomeMessage, profile.fallbackMessage, profile.status, profile.createdAt,
        profile.updatedAt, profile.archivedAt, companyId, context.workspaceId,
      );
      if (result.changes === 0) return { status: "company_not_found" };
      const created = this.findById(context, companyId, profile.id);
      if (!created) throw new Error("Assistant Profile could not be read after creation.");
      return { status: "created", profile: created };
    } catch (error: unknown) {
      if (isNameConflict(error)) return { status: "name_conflict" };
      throw error;
    }
  }

  public update(context: WorkspaceContext, companyId: number, profile: AssistantProfile): UpdateAssistantProfileResult {
    this.assertOwnership(companyId, profile);
    try {
      const result = this.db.prepare(`
        UPDATE assistant_profiles
        SET name = ?, normalized_name = ?, description = ?, business_role = ?, objective = ?, audience = ?,
          tone = ?, assistant_language = ?, welcome_message = ?, fallback_message = ?, status = ?,
          updated_at = ?, archived_at = ?
        WHERE id = ? AND company_id = ? AND company_id IN (
          SELECT id FROM companies WHERE id = ? AND workspace_id = ?
        )
      `).run(
        profile.name, profile.normalizedName, profile.description, profile.businessRole, profile.objective,
        profile.audience, profile.tone, profile.assistantLanguage, profile.welcomeMessage,
        profile.fallbackMessage, profile.status, profile.updatedAt, profile.archivedAt,
        profile.id, companyId, companyId, context.workspaceId,
      );
      if (result.changes === 0) return { status: "not_found" };
      const updated = this.findById(context, companyId, profile.id);
      if (!updated) throw new Error("Assistant Profile could not be read after update.");
      return { status: "updated", profile: updated };
    } catch (error: unknown) {
      if (isNameConflict(error)) return { status: "name_conflict" };
      throw error;
    }
  }

  private assertOwnership(companyId: number, profile: AssistantProfile): void {
    if (profile.companyId !== companyId) {
      throw new AssistantProfileRepositoryContractError("Assistant Profile ownership does not match repository scope.");
    }
  }
}
