import type { DatabaseSync } from "node:sqlite";
import type { KnowledgeRepositoryPort } from "../application/ports/repositories.js";
import { database } from "../config/database.js";
import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

interface KnowledgeRow {
  company_id: number;
  name: string;
  website: string;
  phone: string;
  email: string;
  services_json: string;
  hours: string;
  locations_json: string;
  faq_json: string;
}

export class KnowledgeRepository implements KnowledgeRepositoryPort {
  public constructor(private readonly db: DatabaseSync) {}

  public save(context: WorkspaceContext, companyId: number, knowledge: CompanyKnowledge): boolean {
    if (!this.companyExists(context, companyId)) return false;
    this.db.prepare(`
      INSERT INTO company_knowledge (
        company_id, services_json, hours, locations_json, faq_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(company_id) DO UPDATE SET
        services_json = excluded.services_json,
        hours = excluded.hours,
        locations_json = excluded.locations_json,
        faq_json = excluded.faq_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      companyId,
      JSON.stringify(knowledge.business.services),
      knowledge.business.hours,
      JSON.stringify(knowledge.business.locations),
      JSON.stringify(knowledge.faq)
    );
    return true;
  }

  public load(context: WorkspaceContext, companyId: number): CompanyKnowledge | null {
    const row = this.db.prepare(`
      SELECT
        k.company_id,
        c.name,
        c.website,
        c.phone,
        c.email,
        k.services_json,
        k.hours,
        k.locations_json,
        k.faq_json
      FROM company_knowledge k
      INNER JOIN companies c ON c.id = k.company_id
      WHERE c.workspace_id = ? AND c.id = ?
    `).get(context.workspaceId, companyId) as KnowledgeRow | undefined;
    if (!row) return null;
    return {
      company: { name: row.name, website: row.website, phone: row.phone, email: row.email },
      business: {
        services: JSON.parse(row.services_json) as string[],
        hours: row.hours,
        locations: JSON.parse(row.locations_json) as string[],
      },
      faq: JSON.parse(row.faq_json) as CompanyKnowledge["faq"],
    };
  }

  public delete(context: WorkspaceContext, companyId: number): boolean {
    const result = this.db.prepare(`
      DELETE FROM company_knowledge
      WHERE company_id IN (
        SELECT id FROM companies WHERE workspace_id = ? AND id = ?
      )
    `).run(context.workspaceId, companyId);
    return result.changes > 0;
  }

  private companyExists(context: WorkspaceContext, companyId: number): boolean {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM companies WHERE workspace_id = ? AND id = ?
    `).get(context.workspaceId, companyId));
  }
}

export const knowledgeRepository = new KnowledgeRepository(database);
