import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { createDatabase } from "../config/database.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { AssistantProfileRepository, AssistantProfileRepositoryContractError } from "../repositories/assistantProfileRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { reconstructAssistantProfile, type AssistantProfile, type AssistantProfileId } from "../assistant/domain/assistantProfile.js";

function profile(id: string, companyId: number, name: string, status: AssistantProfile["status"] = "draft", at = "2026-07-16T12:00:00.000Z"): AssistantProfile {
  return reconstructAssistantProfile({ id: id as AssistantProfileId, companyId, name, normalizedName: name.trim().toLowerCase(), description: null, businessRole: null, objective: null, audience: null, tone: "professional", assistantLanguage: "en", welcomeMessage: null, fallbackMessage: "Safe fallback", status, createdAt: at, updatedAt: at, archivedAt: status === "archived" ? at : null });
}

test("migration 7 creates the constrained indexed schema without bootstrap profiles", () => {
  const db = createDatabase(":memory:");
  const historicalChecksums = db.prepare("SELECT id,checksum FROM schema_migrations WHERE id<=6 ORDER BY id").all()
    .map((row) => ({ ...(row as { id: number; checksum: string }) }));
  assert.deepEqual(historicalChecksums, [
    { id: 1, checksum: "7c452be718c116d2300c98fa1806bbe7d88744b4c46aa4a74cec3b70f5e17cd6" },
    { id: 2, checksum: "f8ec82f27038e087046770d66af6be0b38978b7f2b719e28e583b753d72dce4d" },
    { id: 3, checksum: "825d93b6fb46470be2ce53b185a8a9ebb2747fa6306017fe47e25fd4cb092a49" },
    { id: 4, checksum: "8524b02f515e80cc69aaaa6f22ccca6986fa73d64cff141fa8b92938b6504333" },
    { id: 5, checksum: "17e9c535141a010e24e6a0368c271b4450a8d6d910c5f4993c3c83685f298892" },
    { id: 6, checksum: "a4106984a62fab22793896040603f215ae21e628689a68632bf009c65b6b4423" },
  ]);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count, 8);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM assistant_profiles").get() as { count: number }).count, 0);
  const indexes = db.prepare("PRAGMA index_list(assistant_profiles)").all() as Array<{ name: string }>;
  assert.ok(indexes.some((index) => index.name === "idx_assistant_profiles_company_status_created"));
  assert.ok(indexes.some((index) => index.name.startsWith("sqlite_autoindex_assistant_profiles")));
  assert.throws(() => db.prepare(`INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at) VALUES('asp_30000000000000000000000000000001',1,'A','a','unknown','en','Safe','draft','2026-07-16T12:00:00.000Z','2026-07-16T12:00:00.000Z')`).run());
  assert.throws(() => db.prepare(`INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at) VALUES('asp_30000000000000000000000000000002',1,'A','a','professional','fr','Safe','draft','2026-07-16T12:00:00.000Z','2026-07-16T12:00:00.000Z')`).run());
  assert.throws(() => db.prepare(`INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at,archived_at) VALUES('asp_30000000000000000000000000000003',1,'A','a','professional','en','Safe','archived','2026-07-16T12:00:00.000Z','2026-07-16T12:00:00.000Z',NULL)`).run());
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("migration 7 upgrades schema 6 data, restarts safely, cascades, and rolls back on failure", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-assistant-migration-")), path = join(directory, "atlas.sqlite");
  try {
    const initial = createDatabase(path), context = createWorkspaceContext(new WorkspaceRepository(initial).resolveDefault());
    const company = new CompanyRepository(initial).create(context, { name: "Preserved", website: "https://preserved.test" });
    const checksums = initial.prepare("SELECT id,checksum FROM schema_migrations WHERE id<=6 ORDER BY id").all();
    initial.exec("DROP TABLE assistant_profiles; DELETE FROM schema_migrations WHERE id=7;");
    initial.close();

    const upgraded = createDatabase(path);
    assert.deepEqual(upgraded.prepare("SELECT id,checksum FROM schema_migrations WHERE id<=6 ORDER BY id").all(), checksums);
    assert.equal((upgraded.prepare("SELECT COUNT(*) AS count FROM companies WHERE id=?").get(company.id) as { count: number }).count, 1);
    assert.equal((upgraded.prepare("SELECT COUNT(*) AS count FROM assistant_profiles").get() as { count: number }).count, 0);
    const repository = new AssistantProfileRepository(upgraded);
    assert.equal(repository.create(context, company.id, profile("asp_40000000000000000000000000000001", company.id, "Cascade")).status, "created");
    new CompanyRepository(upgraded).delete(context, company.id);
    assert.equal((upgraded.prepare("SELECT COUNT(*) AS count FROM assistant_profiles").get() as { count: number }).count, 0);
    upgraded.close();

    const restarted = createDatabase(path);
    assert.equal((restarted.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count, 8);
    restarted.exec("DROP TABLE assistant_profiles; DELETE FROM schema_migrations WHERE id=7; CREATE TABLE migration_7_blocker(id INTEGER); CREATE INDEX idx_assistant_profiles_company_status_created ON migration_7_blocker(id);");
    restarted.close();
    assert.throws(() => createDatabase(path));
    const blocked = new DatabaseSync(path);
    blocked.exec("PRAGMA foreign_keys=ON;");
    assert.equal((blocked.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE id=7").get() as { count: number }).count, 0);
    assert.equal(blocked.prepare("SELECT type FROM sqlite_master WHERE name='assistant_profiles'").get(), undefined);
    assert.equal((blocked.prepare("SELECT tbl_name FROM sqlite_master WHERE name='idx_assistant_profiles_company_status_created'").get() as { tbl_name: string }).tbl_name, "migration_7_blocker");
    assert.equal((blocked.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys, 1);
    blocked.exec("DROP TABLE migration_7_blocker;");
    blocked.close();
    const inspection = createDatabase(path);
    assert.equal((inspection.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE id=7").get() as { count: number }).count, 1);
    inspection.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("repository supports multiple profiles, stable ordering, archived reads and tenant isolation", () => {
  const db = createDatabase(":memory:"), workspaces = new WorkspaceRepository(db);
  const workspaceA = workspaces.resolveDefault(), workspaceB = workspaces.createForSystemUse({ key: "other", name: "Other" });
  const contextA = createWorkspaceContext(workspaceA), contextB = createWorkspaceContext(workspaceB);
  const companies = new CompanyRepository(db);
  const companyA = companies.create(contextA, { name: "A", website: "https://a.test" });
  const companyB = companies.create(contextA, { name: "B", website: "https://b.test" });
  const companyOther = companies.create(contextB, { name: "Other", website: "https://other.test" });
  const repository = new AssistantProfileRepository(db);
  const older = profile("asp_00000000000000000000000000000001", companyA.id, "Sales", "draft", "2026-07-16T11:00:00.000Z");
  const newer = profile("asp_00000000000000000000000000000002", companyA.id, "Support", "draft", "2026-07-16T12:00:00.000Z");
  assert.equal(repository.create(contextA, companyA.id, older).status, "created");
  assert.equal(repository.create(contextA, companyA.id, newer).status, "created");
  assert.equal(repository.create(contextA, companyB.id, profile("asp_00000000000000000000000000000003", companyB.id, "Sales")).status, "created");
  assert.equal(repository.create(contextB, companyOther.id, profile("asp_00000000000000000000000000000004", companyOther.id, "Other")).status, "created");
  const listed = repository.listActive(contextA, companyA.id);
  assert.equal(listed.status, "found");
  assert.deepEqual(listed.status === "found" ? listed.profiles.map((item) => item.id) : [], [newer.id, older.id]);
  assert.equal(repository.findById(contextA, companyB.id, older.id), null);
  assert.equal(repository.findById(contextB, companyA.id, older.id), null);
  assert.equal(repository.create(contextB, companyA.id, profile("asp_00000000000000000000000000000005", companyA.id, "Hidden")).status, "company_not_found");
  const archived = reconstructAssistantProfile({ ...newer, status: "archived", archivedAt: newer.updatedAt });
  assert.equal(repository.update(contextA, companyA.id, archived).status, "updated");
  const active = repository.listActive(contextA, companyA.id);
  assert.deepEqual(active.status === "found" ? active.profiles.map((item) => item.id) : [], [older.id]);
  assert.equal(repository.findById(contextA, companyA.id, archived.id)?.status, "archived");
  assert.equal(repository.listActive(contextB, companyA.id).status, "company_not_found");
  assert.equal(repository.listActive(contextA, 999999).status, "company_not_found");
  db.close();
});

test("normalized-name constraints control create and update conflicts", () => {
  const db = createDatabase(":memory:"), workspace = new WorkspaceRepository(db).resolveDefault();
  const context = createWorkspaceContext(workspace), company = new CompanyRepository(db).create(context, { name: "A", website: "https://a.test" });
  const repository = new AssistantProfileRepository(db);
  const first = profile("asp_10000000000000000000000000000001", company.id, "Sales");
  const second = profile("asp_10000000000000000000000000000002", company.id, "sales");
  assert.equal(repository.create(context, company.id, first).status, "created");
  assert.equal(repository.create(context, company.id, second).status, "name_conflict");
  const support = profile("asp_10000000000000000000000000000003", company.id, "Support");
  assert.equal(repository.create(context, company.id, support).status, "created");
  assert.equal(repository.update(context, company.id, reconstructAssistantProfile({ ...support, name: "SALES", normalizedName: "sales" })).status, "name_conflict");
  db.close();
});

test("repository rejects aggregate ownership mismatches before executing SQL", () => {
  const db = createDatabase(":memory:"), context = createWorkspaceContext(new WorkspaceRepository(db).resolveDefault());
  const companies = new CompanyRepository(db), companyA = companies.create(context, { name: "A", website: "https://ownership-a.test" }), companyB = companies.create(context, { name: "B", website: "https://ownership-b.test" });
  const repository = new AssistantProfileRepository(db), inconsistent = profile("asp_50000000000000000000000000000001", companyB.id, "Mismatch");
  assert.throws(() => repository.create(context, companyA.id, inconsistent), AssistantProfileRepositoryContractError);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM assistant_profiles").get() as { count: number }).count, 0);
  const stored = profile("asp_50000000000000000000000000000002", companyA.id, "Stored");
  assert.equal(repository.create(context, companyA.id, stored).status, "created");
  assert.throws(() => repository.update(context, companyB.id, stored), AssistantProfileRepositoryContractError);
  assert.equal(repository.findById(context, companyA.id, stored.id)?.name, "Stored");
  db.close();
});

test("two worker-thread connections race and yield one created result and one controlled conflict", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-assistant-race-")), path = join(directory, "atlas.sqlite");
  try {
    const firstDb = createDatabase(path), context = createWorkspaceContext(new WorkspaceRepository(firstDb).resolveDefault());
    const company = new CompanyRepository(firstDb).create(context, { name: "A", website: "https://a.test" });
    firstDb.close();
    const common = { path, workspaceId: context.workspaceId, workspaceKey: context.workspaceKey, companyId: company.id };
    const workers = [
      new Worker(new URL("./helpers/assistantProfileCreateWorker.ts", import.meta.url), { workerData: { ...common, id: "asp_20000000000000000000000000000001", name: "Sales" } }),
      new Worker(new URL("./helpers/assistantProfileCreateWorker.ts", import.meta.url), { workerData: { ...common, id: "asp_20000000000000000000000000000002", name: "sales" } }),
    ];
    await Promise.all(workers.map(waitUntilReady));
    const attempts = workers.map(waitForResult);
    workers.forEach((worker) => worker.postMessage("start"));
    const results = await Promise.all(attempts);
    assert.equal(results.filter((result) => result === "created").length, 1);
    assert.equal(results.filter((result) => result === "name_conflict").length, 1);
    const inspection = createDatabase(path);
    assert.equal((inspection.prepare("SELECT COUNT(*) AS count FROM assistant_profiles").get() as { count: number }).count, 1);
    assert.equal((inspection.prepare("SELECT COUNT(*) AS count FROM assistant_profiles p LEFT JOIN companies c ON c.id=p.company_id WHERE c.id IS NULL").get() as { count: number }).count, 0);
    inspection.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function waitUntilReady(worker: Worker): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: { status?: string }): void => { if (message.status === "ready") { worker.off("error", reject); resolve(); } };
    worker.once("message", onMessage); worker.once("error", reject);
  });
}

function waitForResult(worker: Worker): Promise<string> {
  return new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.on("message", (message: { status?: string; result?: string; error?: string }) => {
      if (message.status === "result" && message.result) resolve(message.result);
      if (message.status === "error") reject(new Error(`Worker leaked an internal error category: ${message.error ?? "unknown"}`));
    });
  });
}
