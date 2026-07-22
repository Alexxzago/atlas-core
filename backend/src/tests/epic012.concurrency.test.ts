import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { createDatabase } from "../config/database.js";
import { CompanyKnowledgeRepository } from "../repositories/companyKnowledgeRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

type RaceOperation = "reserve" | "terminal" | "archive" | "publication";
interface RaceInput { path: string; operation: RaceOperation; workspaceId: number; workspaceKey: string; companyId: number; sourceId?: string; revisionId?: string; expectedSourceVersion?: number; expectedKnowledgeVersionId?: string | null; revisionIds?: string[]; at: string; }

async function race(first: RaceInput, second: RaceInput): Promise<string[]> {
  const workers = [first, second].map(input => new Worker(new URL("./helpers/companyKnowledgeRaceWorker.ts", import.meta.url), { workerData: input }));
  const ready = workers.map(worker => new Promise<void>((resolve, reject) => {
    worker.once("message", message => (message as { status?: string }).status === "ready" ? resolve() : reject(new Error("Knowledge race worker did not become ready.")));
    worker.once("error", reject);
  }));
  await Promise.all(ready);
  const results = workers.map(worker => new Promise<string>((resolve, reject) => {
    worker.once("message", message => resolve((message as { result: string }).result));
    worker.once("error", reject);
    worker.postMessage("start");
  }));
  return Promise.all(results);
}

function readyRevision(repository: CompanyKnowledgeRepository, context: ReturnType<typeof createWorkspaceContext>, companyId: number, sourceId: string, revisionId: string, name: string): void {
  const at = "2026-07-20T00:00:00.000Z", extracted = { services: ["Service"], hours: "Always", locations: ["Remote"], faq: [] };
  repository.createSourceAndPending(context, companyId, { id: sourceId, revisionId, kind: "manual_text", name, normalizedName: name.toLowerCase(), locator: null, mediaType: "text/plain", inputBytes: 5, createdAt: at });
  assert.equal(repository.completeRevision(context, companyId, revisionId, { contentDigest: createHash("sha256").update(revisionId).digest("hex"), normalizedText: "facts", extracted, normalizedBytes: 5, normalizedCharacters: 5, pageCount: null, completedAt: at }), true);
}

test("real separate SQLite connections deterministically enforce every Knowledge CAS and allocation race", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-knowledge-races-")), path = join(directory, "atlas.sqlite"), db = createDatabase(path);
  try {
    const context = createWorkspaceContext(new WorkspaceRepository(db).resolveDefault()), company = new CompanyRepository(db).create(context, { name: "Race", website: "https://race.test" }), repository = new CompanyKnowledgeRepository(db), at = "2026-07-20T00:00:00.000Z", base = { path, workspaceId: context.workspaceId, workspaceKey: context.workspaceKey, companyId: company.id, at };
    readyRevision(repository, context, company.id, "ksrc_revision", "ksrv_base", "Revision");
    const revision = await race({ ...base, operation: "reserve", sourceId: "ksrc_revision", revisionId: "ksrv_race_a", expectedSourceVersion: 1 }, { ...base, operation: "reserve", sourceId: "ksrc_revision", revisionId: "ksrv_race_b", expectedSourceVersion: 1 });
    assert.deepEqual(revision.sort(), ["created:2", "error:knowledge_ingestion_in_progress"]);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM knowledge_source_revisions WHERE source_id='ksrc_revision' AND status='pending'").get() as { n: number }).n, 1);
    const pendingId = (db.prepare("SELECT id FROM knowledge_source_revisions WHERE source_id='ksrc_revision' AND status='pending'").get() as { id: string }).id;
    const terminal = await race({ ...base, operation: "terminal", revisionId: pendingId }, { ...base, operation: "terminal", revisionId: pendingId });
    assert.deepEqual(terminal.sort(), ["changed:0", "changed:1"]);
    const source = await race({ ...base, operation: "archive", sourceId: "ksrc_revision", expectedSourceVersion: 2 }, { ...base, operation: "archive", sourceId: "ksrc_revision", expectedSourceVersion: 2 });
    assert.deepEqual(source.sort(), ["changed:0", "changed:1"]);
    for (const [sourceId, revisionId, name] of [["ksrc_publish_a", "ksrv_publish_a", "Publish A"], ["ksrc_publish_b", "ksrv_publish_b", "Publish B"], ["ksrc_publish_c", "ksrv_publish_c", "Publish C"], ["ksrc_publish_d", "ksrv_publish_d", "Publish D"], ["ksrc_publish_equal", "ksrv_publish_equal", "Publish Equal"]] as const) readyRevision(repository, context, company.id, sourceId, revisionId, name);
    const publication = { ...base, operation: "publication" as const };
    const first = await race({ ...publication, expectedKnowledgeVersionId: null, revisionIds: ["ksrv_publish_a"] }, { ...publication, expectedKnowledgeVersionId: null, revisionIds: ["ksrv_publish_b"] });
    assert.deepEqual(first.sort(), ["changed", "created"]);
    const current = (db.prepare("SELECT knowledge_version_id FROM company_knowledge_publications WHERE company_id=?").get(company.id) as { knowledge_version_id: string }).knowledge_version_id;
    const stale = await race({ ...publication, expectedKnowledgeVersionId: current, revisionIds: ["ksrv_publish_c"] }, { ...publication, expectedKnowledgeVersionId: current, revisionIds: ["ksrv_publish_d"] });
    assert.deepEqual(stale.sort(), ["changed", "created"]);
    const after = (db.prepare("SELECT knowledge_version_id FROM company_knowledge_publications WHERE company_id=?").get(company.id) as { knowledge_version_id: string }).knowledge_version_id;
    const concurrentEqual = await race({ ...publication, expectedKnowledgeVersionId: after, revisionIds: ["ksrv_publish_equal"] }, { ...publication, expectedKnowledgeVersionId: after, revisionIds: ["ksrv_publish_equal"] });
    assert.deepEqual(concurrentEqual.sort(), ["created", "idempotent"]);
    const equalCurrent = (db.prepare("SELECT knowledge_version_id FROM company_knowledge_publications WHERE company_id=?").get(company.id) as { knowledge_version_id: string }).knowledge_version_id;
    const equal = await race({ ...publication, expectedKnowledgeVersionId: equalCurrent, revisionIds: ["ksrv_publish_equal"] }, { ...publication, expectedKnowledgeVersionId: equalCurrent, revisionIds: ["ksrv_publish_equal"] });
    assert.deepEqual(equal, ["idempotent", "idempotent"]);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM company_knowledge_versions WHERE company_id=?").get(company.id) as { n: number }).n, 3);
    assert.equal((db.prepare("SELECT version_number FROM company_knowledge_versions WHERE company_id=? ORDER BY version_number DESC LIMIT 1").get(company.id) as { version_number: number }).version_number, 3);
    assert.equal((db.prepare("SELECT status FROM companies WHERE id=?").get(company.id) as { status: string }).status, "ready");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
