import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { CompanyDomainRepositoryPort, CompanyEvent, CompanyEventType, CreateCompanyPersistenceResult, SaveCompanyPersistenceResult } from "../company/application/ports.js";
import { reconstructCompany, type Company, type CompanyConfigurationInput, type CompanyId, type CompanyState, type CompanySlug } from "../company/domain/company.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

interface CompanyRow {
  id: number; workspace_id: number; name: string; name_normalized: string; slug: string; description: string | null; website: string | null;
  public_name: string | null; logo_asset_ref: string | null; brand_colors_json: string;
  lifecycle_state: string; timezone: string | null; locale: string | null; country_code: string | null; currency_code: string | null;
  date_format: string | null; phone_format: string | null; business_hours_json: string;
  version: number; created_at: string; updated_at: string; lifecycle_changed_at: string; suspended_at: string | null; archived_at: string | null;
}

interface SqliteConstraintError extends Error { errcode?: number; }
export class CompanyDomainRepositoryContractError extends Error {}

const columns = `id, workspace_id, name, name_normalized, slug, description, website, public_name, logo_asset_ref, brand_colors_json,
  lifecycle_state, timezone, locale, country_code, currency_code, date_format, phone_format, business_hours_json,
  version, created_at, updated_at, lifecycle_changed_at, suspended_at, archived_at`;

function parseJson(value: string, label: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { throw new CompanyDomainRepositoryContractError(`${label} JSON is invalid.`); }
}

function mapCompany(row: CompanyRow): Company {
  const colors = parseJson(row.brand_colors_json, "Brand colors");
  const hours = parseJson(row.business_hours_json, "Business hours");
  return reconstructCompany({
    id: row.id, workspaceId: row.workspace_id, name: row.name, normalizedName: row.name_normalized, slug: row.slug, description: row.description, website: row.website,
    branding: { publicName: row.public_name, logoAssetReference: row.logo_asset_ref, colorTokens: colors as Record<string, string> },
    configuration: row.timezone === null ? null : { timezone: row.timezone, locale: required(row.locale, "Company locale"), operatingLocale: { countryCode: required(row.country_code, "Country code"), currencyCode: required(row.currency_code, "Currency code"), dateFormat: required(row.date_format, "Date format") as "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY", phoneFormat: required(row.phone_format, "Phone format") as "international" | "national" }, businessHours: hours as CompanyConfigurationInput["businessHours"] },
    lifecycle: row.lifecycle_state, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, lifecycleChangedAt: row.lifecycle_changed_at, suspendedAt: row.suspended_at, archivedAt: row.archived_at,
  } as unknown as CompanyState);
}

function required(value: string | null, label: string): string { if (value === null) throw new CompanyDomainRepositoryContractError(`${label} is missing.`); return value; }
function changed(value: number | bigint): boolean { return Number(value) > 0; }
function isConstraint(error: unknown, column: string): boolean { return error instanceof Error && (error as SqliteConstraintError).errcode === 2067 && error.message.includes(column); }
const eventTypes = new Set<CompanyEventType>(["CompanyCreated", "CompanyIdentityUpdated", "CompanyBrandingUpdated", "CompanyConfigurationUpdated", "CompanyConfigured", "CompanyActivated", "CompanyAttentionRequired", "CompanySuspended", "CompanyRestored", "CompanyArchived", "CompanyUpdated"]);

function strictIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return typeof value === "string" && !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export class CompanyDomainRepository implements CompanyDomainRepositoryPort {
  public constructor(private readonly db: SynchronousDatabase) {}

  public findById(context: WorkspaceContext, companyId: CompanyId): Company | null {
    const row = this.db.prepare(`SELECT ${columns} FROM companies WHERE workspace_id = ? AND id = ?`).get(context.workspaceId, companyId) as CompanyRow | undefined;
    return row ? mapCompany(row) : null;
  }

  public findBySlug(context: WorkspaceContext, slug: CompanySlug): Company | null {
    const row = this.db.prepare(`SELECT ${columns} FROM companies WHERE workspace_id = ? AND slug = ?`).get(context.workspaceId, slug) as CompanyRow | undefined;
    return row ? mapCompany(row) : null;
  }

  public listByWorkspace(context: WorkspaceContext): readonly Company[] {
    return (this.db.prepare(`SELECT ${columns} FROM companies WHERE workspace_id = ? ORDER BY id DESC`).all(context.workspaceId) as unknown as CompanyRow[]).map(mapCompany);
  }

  public existsBySlug(context: WorkspaceContext, slug: CompanySlug, excludingCompanyId?: CompanyId): boolean {
    const row = excludingCompanyId === undefined
      ? this.db.prepare("SELECT 1 FROM companies WHERE workspace_id = ? AND slug = ?").get(context.workspaceId, slug)
      : this.db.prepare("SELECT 1 FROM companies WHERE workspace_id = ? AND slug = ? AND id != ?").get(context.workspaceId, slug, excludingCompanyId);
    return row !== undefined;
  }

  public existsByNormalizedName(context: WorkspaceContext, normalizedName: string, excludingCompanyId?: CompanyId): boolean {
    const row = excludingCompanyId === undefined
      ? this.db.prepare("SELECT 1 FROM companies WHERE workspace_id = ? AND name_normalized = ?").get(context.workspaceId, normalizedName)
      : this.db.prepare("SELECT 1 FROM companies WHERE workspace_id = ? AND name_normalized = ? AND id != ?").get(context.workspaceId, normalizedName, excludingCompanyId);
    return row !== undefined;
  }

  public createWithEvents(context: WorkspaceContext, company: Company, events: readonly CompanyEvent[]): CreateCompanyPersistenceResult {
    const current = this.assertScope(context, company);
    this.assertEvents(current, events);
    try {
      this.transaction(() => {
        this.db.prepare(`INSERT INTO companies (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(...this.values(current));
        this.insertEvents(context, current, events);
      });
      const created = this.findById(context, current.id);
      if (!created) throw new CompanyDomainRepositoryContractError("Company could not be read after creation.");
      return { status: "created", company: created };
    } catch (error: unknown) {
      if (isConstraint(error, "companies.workspace_id, companies.slug")) return { status: "slug_conflict" };
      if (isConstraint(error, "companies.workspace_id, companies.name_normalized")) return { status: "name_conflict" };
      if (error instanceof Error && error.message === "workspace company creation is unavailable") return { status: "commercial_limit_reached" };
      throw error;
    }
  }

  public saveWithEvents(context: WorkspaceContext, company: Company, expectedVersion: number, events: readonly CompanyEvent[]): SaveCompanyPersistenceResult {
    const current = this.assertScope(context, company);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new CompanyDomainRepositoryContractError("Expected Company version is invalid.");
    this.assertEvents(current, events);
    try {
      let result: SaveCompanyPersistenceResult | null = null;
      this.transaction(() => {
        const stored = this.db.prepare("SELECT version FROM companies WHERE workspace_id = ? AND id = ?").get(context.workspaceId, current.id) as { version: number } | undefined;
        if (!stored) { result = { status: "not_found" }; return; }
        if (stored.version !== expectedVersion) { result = { status: "version_conflict" }; return; }
        if (current.version !== expectedVersion + 1) throw new CompanyDomainRepositoryContractError("Company version must advance exactly once from the expected version.");
        const write = this.db.prepare(`UPDATE companies SET name=?, name_normalized=?, slug=?, description=?, website=?, public_name=?, logo_asset_ref=?, brand_colors_json=?, lifecycle_state=?, timezone=?, locale=?, country_code=?, currency_code=?, date_format=?, phone_format=?, business_hours_json=?, version=?, updated_at=?, lifecycle_changed_at=?, suspended_at=?, archived_at=? WHERE workspace_id=? AND id=? AND version=?`)
          .run(...this.updateValues(current), context.workspaceId, current.id, expectedVersion);
        if (!changed(write.changes)) { result = { status: "version_conflict" }; return; }
        this.insertEvents(context, current, events);
      });
      if (result) return result;
      const saved = this.findById(context, current.id);
      if (!saved) throw new CompanyDomainRepositoryContractError("Company could not be read after save.");
      return { status: "saved", company: saved };
    } catch (error: unknown) {
      if (isConstraint(error, "companies.workspace_id, companies.slug")) return { status: "slug_conflict" };
      if (isConstraint(error, "companies.workspace_id, companies.name_normalized")) return { status: "name_conflict" };
      throw error;
    }
  }

  private values(company: Company): [number, number, string, string, string, string | null, string | null, string | null, string | null, string, string, string | null, string | null, string | null, string | null, string | null, string | null, string, number, string, string, string, string | null, string | null] {
    const configuration = company.configuration;
    return [company.id, company.workspaceId, company.name, company.normalizedName, company.slug, company.description, company.website, company.branding.publicName, company.branding.logoAssetReference, JSON.stringify(company.branding.colorTokens), company.lifecycle, configuration?.timezone ?? null, configuration?.locale ?? null, configuration?.operatingLocale.countryCode ?? null, configuration?.operatingLocale.currencyCode ?? null, configuration?.operatingLocale.dateFormat ?? null, configuration?.operatingLocale.phoneFormat ?? null, JSON.stringify(configuration?.businessHours ?? {}), company.version, company.createdAt, company.updatedAt, company.lifecycleChangedAt, company.suspendedAt, company.archivedAt];
  }

  private updateValues(company: Company): readonly (string | number | null)[] {
    const values = this.values(company);
    return [...values.slice(2, 19), ...values.slice(20)];
  }

  private assertScope(context: WorkspaceContext, company: Company): Company {
    const current = reconstructCompany(company as unknown as CompanyState);
    if (current.workspaceId !== context.workspaceId) throw new CompanyDomainRepositoryContractError("Company ownership does not match repository scope.");
    return current;
  }

  private assertEvents(company: Company, events: readonly CompanyEvent[]): void {
    if (events.length === 0) throw new CompanyDomainRepositoryContractError("Company persistence requires at least one event.");
    let expectedSequence = 1;
    for (const event of events) {
      if (!eventTypes.has(event.type) || !event.id.trim() || !Number.isInteger(event.aggregateVersion) || event.aggregateVersion !== company.version || event.sequence !== expectedSequence || !strictIsoTimestamp(event.occurredAt) || event.occurredAt !== company.updatedAt) {
        throw new CompanyDomainRepositoryContractError("Company event does not match aggregate persistence contract.");
      }
      if (typeof JSON.stringify(event.payload) !== "string") throw new CompanyDomainRepositoryContractError("Company event payload is not serializable.");
      expectedSequence += 1;
    }
  }

  private insertEvents(context: WorkspaceContext, company: Company, events: readonly CompanyEvent[]): void {
    const statement = this.db.prepare("INSERT INTO company_events (id, company_id, workspace_id, event_type, aggregate_version, event_sequence, occurred_at, actor_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const event of events) {
      const payload = JSON.stringify(event.payload);
      if (typeof payload !== "string") throw new CompanyDomainRepositoryContractError("Company event payload is not serializable.");
      statement.run(event.id, company.id, context.workspaceId, event.type, event.aggregateVersion, event.sequence, event.occurredAt, event.actorId, payload);
    }
  }

  private transaction(operation: () => void): void {
    if (this.db.isTransaction) throw new CompanyDomainRepositoryContractError("Company persistence requires an outermost transaction.");
    this.db.exec("BEGIN IMMEDIATE;");
    try { operation(); this.db.exec("COMMIT;"); }
    catch (error: unknown) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }
}
