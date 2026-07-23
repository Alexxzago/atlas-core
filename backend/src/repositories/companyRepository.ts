import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { CompanyRepositoryPort } from "../application/ports/repositories.js";
import { database } from "../config/database.js";
import type { Company, CompanyCreateInput, CompanyPersistenceInput, CompanyStatus } from "../types/company.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

interface CompanyRow { id: number; workspace_id: number; name: string; website: string; phone: string; email: string; status: CompanyStatus; created_at: string; }
function mapCompany(row: CompanyRow): Company { return { id: row.id, workspaceId: row.workspace_id, name: row.name, website: row.website, phone: row.phone, email: row.email, status: row.status, createdAt: row.created_at }; }

export class CompanyRepository implements CompanyRepositoryPort {
  public constructor(private readonly db: SynchronousDatabase) {}
  public findById(context: WorkspaceContext, companyId: number): Company | null {
    const row = this.db.prepare("SELECT id, workspace_id, name, website, phone, email, status, created_at FROM companies WHERE workspace_id = ? AND id = ?").get(context.workspaceId, companyId) as CompanyRow | undefined;
    return row ? mapCompany(row) : null;
  }
  public findByWebsite(context: WorkspaceContext, website: string): Company | null {
    const row = this.db.prepare("SELECT id, workspace_id, name, website, phone, email, status, created_at FROM companies WHERE workspace_id = ? AND website = ?").get(context.workspaceId, website) as CompanyRow | undefined;
    return row ? mapCompany(row) : null;
  }
  public list(context: WorkspaceContext): Company[] { return (this.db.prepare("SELECT id, workspace_id, name, website, phone, email, status, created_at FROM companies WHERE workspace_id = ? ORDER BY id DESC").all(context.workspaceId) as unknown as CompanyRow[]).map(mapCompany); }
  public create(context: WorkspaceContext, input: CompanyCreateInput): Company {
    const result = this.db.prepare("INSERT INTO companies (workspace_id, name, website, phone, email, status) VALUES (?, ?, ?, ?, ?, ?)").run(context.workspaceId, input.name, input.website, input.phone ?? "", input.email ?? "", input.status ?? "processing");
    const company = this.findById(context, Number(result.lastInsertRowid));
    if (!company) throw new Error("Company could not be created.");
    return company;
  }
  public update(context: WorkspaceContext, companyId: number, input: CompanyPersistenceInput): Company | null {
    const result = this.db.prepare("UPDATE companies SET name = ?, website = ?, phone = ?, email = ?, status = ? WHERE workspace_id = ? AND id = ?").run(input.name, input.website, input.phone, input.email, input.status, context.workspaceId, companyId);
    return result.changes === 0 ? null : this.findById(context, companyId);
  }
  public delete(context: WorkspaceContext, companyId: number): boolean { return this.db.prepare("DELETE FROM companies WHERE workspace_id = ? AND id = ?").run(context.workspaceId, companyId).changes > 0; }
  public updateStatus(context: WorkspaceContext, companyId: number, status: CompanyStatus): Company | null {
    const result = this.db.prepare("UPDATE companies SET status = ? WHERE workspace_id = ? AND id = ?").run(status, context.workspaceId, companyId);
    return result.changes === 0 ? null : this.findById(context, companyId);
  }
}
export const companyRepository = new CompanyRepository(database);
