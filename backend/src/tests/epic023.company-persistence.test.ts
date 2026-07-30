import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../config/migrations.js";
import { createDatabase } from "../config/database.js";
import { CompanyDomainRepository } from "../repositories/companyDomainRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { createCompany, reconstructCompany, updateCompanyBranding, type Company } from "../company/domain/company.js";
import type { CompanyEvent } from "../company/application/ports.js";

const createdAt = "2026-07-30T10:00:00.000Z";
function company(id: number, workspaceId: number, name = "Atlas Realty"): Company {
  return createCompany({ id, workspaceId, identity: { name, slug: name.toLowerCase().replaceAll(" ", "-"), website: `https://${id}.example` }, createdAt });
}
function event(company: Company, id: string, sequence = 1): CompanyEvent {
  return { id, type: "CompanyCreated", aggregateVersion: company.version, sequence, occurredAt: company.updatedAt, actorId: null, payload: { companyId: company.id } };
}

test("Company domain repository persists, lists and isolates aggregate reads by Workspace", () => {
  const db = createDatabase(":memory:"), workspaces = new WorkspaceRepository(db);
  const first = workspaces.resolveDefault(), second = workspaces.createForSystemUse({ key: "second", name: "Second" });
  const contextA = createWorkspaceContext(first), contextB = createWorkspaceContext(second), repository = new CompanyDomainRepository(db);
  const stored = repository.createWithEvents(contextA, company(501, first.id), [event(company(501, first.id), "evt-501")]);
  assert.equal(stored.status, "created");
  const other = company(502, second.id, "Atlas Realty");
  assert.equal(repository.createWithEvents(contextB, other, [event(other, "evt-502")]).status, "created");
  assert.equal(repository.findBySlug(contextA, company(501, first.id).slug)?.id, 501);
  assert.equal(repository.findById(contextB, company(501, first.id).id), null);
  assert.equal(repository.listByWorkspace(contextA).length, 1);
  assert.equal(repository.existsBySlug(contextA, company(501, first.id).slug), true);
  assert.equal(repository.existsByNormalizedName(contextB, other.normalizedName), true);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM company_events").get() as { count: number }).count, 2);
  db.close();
});

test("Company writes persist events atomically and enforce optimistic aggregate versions", () => {
  const db = createDatabase(":memory:"), workspace = new WorkspaceRepository(db).resolveDefault(), context = createWorkspaceContext(workspace), repository = new CompanyDomainRepository(db);
  const original = company(601, workspace.id);
  assert.equal(repository.createWithEvents(context, original, [event(original, "evt-601-create")]).status, "created");
  const updated = updateCompanyBranding(original, { publicName: "Atlas" }, "2026-07-30T11:00:00.000Z");
  const updateEvent: CompanyEvent = { ...event(updated, "evt-601-update"), type: "CompanyBrandingUpdated" };
  assert.equal(repository.saveWithEvents(context, updated, 1, [updateEvent]).status, "saved");
  const stale = updateCompanyBranding(updated, { publicName: "Atlas Two" }, "2026-07-30T12:00:00.000Z");
  assert.equal(repository.saveWithEvents(context, stale, 1, [{ ...event(stale, "evt-601-stale"), type: "CompanyBrandingUpdated" }]).status, "version_conflict");
  const jumpSource = company(603, workspace.id, "Version Jump");
  assert.equal(repository.createWithEvents(context, jumpSource, [event(jumpSource, "evt-603-create")]).status, "created");
  const jump = reconstructCompany({ ...jumpSource, version: 3 });
  assert.throws(() => repository.saveWithEvents(context, jump, 1, [{ ...event(jump, "evt-603-jump"), type: "CompanyBrandingUpdated" }]));
  const failed = company(602, workspace.id, "Atomic Failure");
  assert.throws(() => repository.createWithEvents(context, failed, [event(failed, "evt-601-create")]));
  assert.equal(repository.findById(context, failed.id), null);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM company_events WHERE company_id=602").get() as { count: number }).count, 0);
  db.close();
});

test("Company repository maps uniqueness conflicts and persists ordered event batches", () => {
  const db = createDatabase(":memory:"), workspace = new WorkspaceRepository(db).resolveDefault(), context = createWorkspaceContext(workspace), repository = new CompanyDomainRepository(db);
  const first = company(701, workspace.id, "First Company");
  assert.equal(repository.createWithEvents(context, first, [event(first, "evt-701")]).status, "created");
  const sameSlug = createCompany({ id: 702, workspaceId: workspace.id, identity: { name: "Different Name", slug: first.slug, website: "https://702.example" }, createdAt });
  assert.equal(repository.createWithEvents(context, sameSlug, [event(sameSlug, "evt-702")]).status, "slug_conflict");
  const sameName = createCompany({ id: 703, workspaceId: workspace.id, identity: { name: first.name, slug: "different-slug", website: "https://703.example" }, createdAt });
  assert.equal(repository.createWithEvents(context, sameName, [event(sameName, "evt-703")]).status, "name_conflict");
  const updated = updateCompanyBranding(first, { publicName: "First" }, "2026-07-30T11:00:00.000Z");
  const events: readonly CompanyEvent[] = [{ ...event(updated, "evt-701-1", 1), type: "CompanyBrandingUpdated" }, { ...event(updated, "evt-701-2", 2), type: "CompanyUpdated", payload: { area: "branding" } }];
  assert.equal(repository.saveWithEvents(context, updated, 1, events).status, "saved");
  assert.equal((db.prepare("SELECT event_sequence FROM company_events WHERE company_id=701 AND aggregate_version=2 ORDER BY event_sequence").all() as Array<{ event_sequence: number }>).map((row) => row.event_sequence).join(","), "1,2");
  const invalid = updateCompanyBranding(updated, { publicName: "Again" }, "2026-07-30T12:00:00.000Z");
  assert.throws(() => repository.saveWithEvents(context, invalid, 2, [{ ...event(invalid, "evt-701-invalid", 2), type: "CompanyBrandingUpdated" }]));
  db.close();
});

test("migration 26 backfills Company core columns, validates names and preserves legacy status", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  runMigrations(db, 25);
  const workspace = db.prepare("SELECT id FROM workspaces WHERE key='default'").get() as { id: number };
  db.prepare("INSERT INTO companies(workspace_id,name,website,status,created_at) VALUES(?,?,?,?,?)").run(workspace.id, "Legacy Company", "https://legacy.example", "ready", "2026-01-01 00:00:00");
  runMigrations(db);
  const row = db.prepare("SELECT slug,name_normalized,lifecycle_state,status,version,created_at,updated_at FROM companies").get() as { slug: string; name_normalized: string; lifecycle_state: string; status: string; version: number; created_at: string; updated_at: string };
  assert.equal(row.slug, "legacy-company");
  assert.equal(row.name_normalized, "legacy company");
  assert.equal(row.lifecycle_state, "draft");
  assert.equal(row.status, "ready");
  assert.equal(row.version, 1);
  assert.match(row.created_at, /T.*Z$/);
  assert.equal(row.updated_at, row.created_at);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("migration 26 rejects duplicate normalized legacy names without recording the migration", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON;");
  runMigrations(db, 25);
  const workspace = db.prepare("SELECT id FROM workspaces WHERE key='default'").get() as { id: number };
  db.prepare("INSERT INTO companies(workspace_id,name,website,status) VALUES(?,?,?,?)").run(workspace.id, "Atlas", "https://first.example", "ready");
  db.prepare("INSERT INTO companies(workspace_id,name,website,status) VALUES(?,?,?,?)").run(workspace.id, " atlas ", "https://second.example", "ready");
  assert.throws(() => runMigrations(db));
  assert.equal(db.prepare("SELECT id FROM schema_migrations WHERE id=26").get(), undefined);
  assert.equal((db.prepare("PRAGMA table_info(companies)").all() as Array<{ name: string }>).some((column) => column.name === "slug"), false);
  db.close();
});

test("Company event foreign keys reject missing and tenant-mismatched references", () => {
  const db = createDatabase(":memory:"), workspaces = new WorkspaceRepository(db), first = workspaces.resolveDefault(), second = workspaces.createForSystemUse({ key: "other", name: "Other" });
  const context = createWorkspaceContext(first), repository = new CompanyDomainRepository(db), stored = company(801, first.id);
  assert.equal(repository.createWithEvents(context, stored, [event(stored, "evt-801")]).status, "created");
  assert.throws(() => db.prepare("INSERT INTO company_events(id,company_id,workspace_id,event_type,aggregate_version,event_sequence,occurred_at,payload_json) VALUES(?,?,?,?,?,?,?,?)").run("bad-missing", 999, first.id, "CompanyCreated", 1, 1, createdAt, "{}"));
  assert.throws(() => db.prepare("INSERT INTO company_events(id,company_id,workspace_id,event_type,aggregate_version,event_sequence,occurred_at,payload_json) VALUES(?,?,?,?,?,?,?,?)").run("bad-tenant", stored.id, second.id, "CompanyCreated", 1, 1, createdAt, "{}"));
  db.close();
});
