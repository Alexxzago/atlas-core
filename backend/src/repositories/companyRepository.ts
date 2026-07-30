import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { CompanyRepositoryPort } from "../application/ports/repositories.js";
import { database } from "../config/database.js";
import type { Company, CompanyCreateInput, CompanyPersistenceInput, CompanyStatus } from "../types/company.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import { normalizeCompanyName } from "../company/domain/company.js";
import { randomUUID } from "node:crypto";

interface CompanyRow { id: number; workspace_id: number; name: string; website: string; phone: string; email: string; status: CompanyStatus; created_at: string; }
function mapCompany(row: CompanyRow): Company { return { id: row.id, workspaceId: row.workspace_id, name: row.name, website: row.website, phone: row.phone, email: row.email, status: row.status, createdAt: row.created_at }; }

export class CompanyRepository implements CompanyRepositoryPort {
  private hasDomainColumns: boolean | null = null;
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
    if (!this.domainColumnsAvailable()) {
      const result = this.db.prepare("INSERT INTO companies (workspace_id, name, website, phone, email, status) VALUES (?, ?, ?, ?, ?, ?)").run(context.workspaceId, input.name, input.website, input.phone ?? "", input.email ?? "", input.status ?? "processing");
      const company = this.findById(context, Number(result.lastInsertRowid));
      if (!company) throw new Error("Company could not be created.");
      return company;
    }
    const timestamp = new Date().toISOString();
    let companyId = 0;
    this.transaction(() => {
      const result = this.db.prepare("INSERT INTO companies (workspace_id, name, name_normalized, slug, website, phone, email, status, lifecycle_state, version, created_at, updated_at, lifecycle_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?)").run(context.workspaceId, input.name, normalizeCompanyName(input.name), `legacy-${randomUUID().replaceAll("-", "")}`, input.website, input.phone ?? "", input.email ?? "", input.status ?? "processing", timestamp, timestamp, timestamp);
      companyId = Number(result.lastInsertRowid);
      this.recordLegacyEvent(context, companyId, 1, timestamp, "CompanyCreated", { status: input.status ?? "processing" });
    });
    const company = this.findById(context, companyId);
    if (!company) throw new Error("Company could not be created.");
    return company;
  }
  public update(context: WorkspaceContext, companyId: number, input: CompanyPersistenceInput): Company | null {
    if (!this.domainColumnsAvailable()) {
      const result = this.db.prepare("UPDATE companies SET name = ?, website = ?, phone = ?, email = ?, status = ? WHERE workspace_id = ? AND id = ?").run(input.name, input.website, input.phone, input.email, input.status, context.workspaceId, companyId);
      return result.changes === 0 ? null : this.findById(context, companyId);
    }
    let updated = false;
    this.transaction(() => {
      const current = this.db.prepare("SELECT version FROM companies WHERE workspace_id = ? AND id = ?").get(context.workspaceId, companyId) as { version: number } | undefined;
      if (!current) return;
      const timestamp = new Date().toISOString(), version = current.version + 1;
      const result = this.db.prepare("UPDATE companies SET name = ?, name_normalized = ?, website = ?, phone = ?, email = ?, status = ?, version = ?, updated_at = ? WHERE workspace_id = ? AND id = ? AND version = ?").run(input.name, normalizeCompanyName(input.name), input.website, input.phone, input.email, input.status, version, timestamp, context.workspaceId, companyId, current.version);
      if (result.changes === 0) return;
      this.recordLegacyEvent(context, companyId, version, timestamp, "CompanyUpdated", { area: "legacy_update" });
      updated = true;
    });
    return updated ? this.findById(context, companyId) : null;
  }
  public delete(context: WorkspaceContext, companyId: number): boolean { return this.db.prepare("DELETE FROM companies WHERE workspace_id = ? AND id = ?").run(context.workspaceId, companyId).changes > 0; }
  public updateStatus(context: WorkspaceContext, companyId: number, status: CompanyStatus): Company | null {
    if (!this.domainColumnsAvailable()) {
      const result = this.db.prepare("UPDATE companies SET status = ? WHERE workspace_id = ? AND id = ?").run(status, context.workspaceId, companyId);
      return result.changes === 0 ? null : this.findById(context, companyId);
    }
    let updated = false;
    this.transaction(() => {
      const current = this.db.prepare("SELECT version FROM companies WHERE workspace_id = ? AND id = ?").get(context.workspaceId, companyId) as { version: number } | undefined;
      if (!current) return;
      const timestamp = new Date().toISOString(), version = current.version + 1;
      const result = this.db.prepare("UPDATE companies SET status = ?, version = ?, updated_at = ? WHERE workspace_id = ? AND id = ? AND version = ?").run(status, version, timestamp, context.workspaceId, companyId, current.version);
      if (result.changes === 0) return;
      this.recordLegacyEvent(context, companyId, version, timestamp, "CompanyUpdated", { area: "legacy_status" });
      updated = true;
    });
    return updated ? this.findById(context, companyId) : null;
  }

  private domainColumnsAvailable(): boolean {
    if (this.hasDomainColumns !== null) return this.hasDomainColumns;
    const columns = this.db.prepare("PRAGMA table_info(companies)").all() as Array<{ name: string }>;
    this.hasDomainColumns = columns.some((column) => column.name === "name_normalized");
    return this.hasDomainColumns;
  }

  private recordLegacyEvent(context: WorkspaceContext, companyId: number, version: number, occurredAt: string, eventType: "CompanyCreated" | "CompanyUpdated", payload: Readonly<Record<string, string>>): void {
    this.db.prepare("INSERT INTO company_events (id, company_id, workspace_id, event_type, aggregate_version, event_sequence, occurred_at, actor_id, payload_json) VALUES (?, ?, ?, ?, ?, 1, ?, NULL, ?)").run(`legacy-${randomUUID()}`, companyId, context.workspaceId, eventType, version, occurredAt, JSON.stringify(payload));
  }

  private transaction(operation: () => void): void {
    if (this.db.isTransaction) throw new Error("Legacy Company persistence requires an outermost transaction.");
    this.db.exec("BEGIN IMMEDIATE;");
    try { operation(); this.db.exec("COMMIT;"); }
    catch (error: unknown) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }
}
export const companyRepository = new CompanyRepository(database);
