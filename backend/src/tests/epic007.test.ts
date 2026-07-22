import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { AtlasAgent } from "../agents/atlas.js";
import { createCompanyController, createDeleteCompanyController, createGetCompanyController, createListCompaniesController, createUpdateCompanyController } from "../controllers/companyController.js";
import { createOnboardingController } from "../controllers/onboarding.js";
import { createDatabase } from "../config/database.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { KnowledgeRepository } from "../repositories/knowledgeRepository.js";
import { publishKnowledgeFixture } from "./knowledgeTestFixture.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createCompaniesRouter } from "../routes/companies.js";
import { ChatService } from "../services/chatService.js";
import { CompanyNotFoundError } from "../services/companyValidation.js";
import { CompanyService } from "../services/companyService.js";
import { OnboardingService } from "../services/onboardingService.js";
import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { AnswerGenerator, KnowledgeExtractor, MarkdownDebugStore, WebsiteScraper } from "../types/ports.js";
import { createWorkspaceContext, type WorkspaceContext } from "../types/workspaceContext.js";

const knowledgeFixture: CompanyKnowledge = {
  company: { name: "Tenant A", website: "https://shared.test", phone: "", email: "" },
  business: { services: ["Private service"], hours: "Always", locations: ["Private"] },
  faq: [],
};

class TrackingGenerator implements AnswerGenerator {
  public calls = 0;
  public async execute(): Promise<import("../assistant/application/assistantExecution.js").AssistantExecutionResult> { this.calls += 1; return { outcome: "answered", answer: "private answer" }; }
}

class FakeDebugStore implements MarkdownDebugStore {
  public async save(_companyId: number, _markdown: string): Promise<void> {}
}

function createWorkspacePair(): {
  database: DatabaseSync;
  companies: CompanyRepository;
  knowledge: KnowledgeRepository;
  workspaceA: WorkspaceContext;
  workspaceB: WorkspaceContext;
} {
  const database = createDatabase(":memory:");
  const workspaces = new WorkspaceRepository(database);
  const workspaceA = createWorkspaceContext(workspaces.resolveDefault());
  const workspaceB = createWorkspaceContext(workspaces.createForSystemUse({ key: "workspace-b", name: "Workspace B" }));
  return {
    database,
    companies: new CompanyRepository(database),
    knowledge: new KnowledgeRepository(database),
    workspaceA,
    workspaceB,
  };
}

test("fresh database receives all migrations and the default workspace", () => {
  const database = createDatabase(":memory:");
  const migrations = database.prepare(`
    SELECT id, name, checksum, applied_at FROM schema_migrations ORDER BY id
  `).all() as Array<{ id: number; name: string; checksum: string; applied_at: string }>;
  assert.deepEqual(migrations.map(({ id, name }) => ({ id, name })), [
    { id: 1, name: "0001_baseline" },
    { id: 2, name: "0002_workspace_foundation" },
    { id: 3, name: "0003_identity_foundation" },
    { id: 4, name: "0004_email_verification" },
    { id: 5, name: "0005_authentication_sessions" },
    { id: 6, name: "0006_workspace_memberships_invitations" },
    { id: 7, name: "0007_assistant_profiles" },
    { id: 8, name: "0008_session_csrf_generation" },
    { id: 9, name: "0009_company_knowledge_foundation" },
    { id: 10, name: "0010_company_knowledge_runtime_cutover" },
  ]);
  assert.ok(migrations.every((migration) => migration.checksum.length === 64 && migration.applied_at.length > 0));
  assert.equal(new WorkspaceRepository(database).resolveDefault().key, "default");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  database.close();
});

test("legacy companies and knowledge are backfilled without changing identifiers", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-legacy-"));
  const path = join(directory, "legacy.sqlite");
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        website TEXT NOT NULL UNIQUE,
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'processing',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE company_knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL UNIQUE,
        services_json TEXT NOT NULL DEFAULT '[]',
        hours TEXT NOT NULL DEFAULT '',
        locations_json TEXT NOT NULL DEFAULT '[]',
        faq_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
      );
      INSERT INTO companies (id, name, website, status)
        VALUES (42, 'Legacy Compañía', 'https://legacy.test', 'ready');
      INSERT INTO companies (id, name, website, status)
        VALUES (43, 'Sin conocimiento', 'https://empty-legacy.test', 'processing');
      INSERT INTO company_knowledge (id, company_id, services_json, hours, locations_json, faq_json)
        VALUES (7, 42, '["Servicio legado","Unicode 🚀"]', '', '["Buenos Aires"]', '[{"question":"¿Horario?","answer":"A confirmar"}]');
    `);
    legacy.close();

    const migrated = createDatabase(path);
    const context = createWorkspaceContext(new WorkspaceRepository(migrated).resolveDefault());
    const company = new CompanyRepository(migrated).findById(context, 42);
    const knowledge = new KnowledgeRepository(migrated).load(context, 42);

    assert.equal(company?.id, 42);
    assert.equal(company?.workspaceId, context.workspaceId);
    assert.deepEqual(knowledge,{company:{name:"Legacy Compañía",website:"https://legacy.test",phone:"",email:""},business:{services:["Servicio legado","Unicode 🚀"],hours:"",locations:["Buenos Aires"]},faq:[{question:"¿Horario?",answer:"A confirmar"}]});
    for(const table of["knowledge_sources","knowledge_source_revisions","company_knowledge_versions","company_knowledge_version_sources","company_knowledge_publications"])assert.equal((migrated.prepare(`SELECT COUNT(*) count FROM ${table}`).get()as{count:number}).count,1);
    assert.equal((migrated.prepare("SELECT COUNT(*) count FROM company_knowledge_publications WHERE company_id=43").get()as{count:number}).count,0);
    assert.equal((migrated.prepare("SELECT COUNT(*) AS count FROM company_knowledge_legacy").get() as { count: number }).count, 1);
    assert.equal(migrated.prepare("SELECT 1 FROM sqlite_master WHERE name='company_knowledge' AND type='view'").get(),undefined);
    assert.deepEqual(migrated.prepare("PRAGMA foreign_key_check").all(), []);
    migrated.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an already migrated database restarts idempotently", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-restart-"));
  const path = join(directory, "atlas.sqlite");
  try {
    createDatabase(path).close();
    const restarted = createDatabase(path);
    const migrationCount = restarted.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number };
    const workspaceCount = restarted.prepare("SELECT COUNT(*) AS count FROM workspaces WHERE key = 'default'").get() as { count: number };
    assert.equal(migrationCount.count, 10);
    assert.equal(workspaceCount.count, 1);
    assert.deepEqual(restarted.prepare("PRAGMA foreign_key_check").all(), []);
    restarted.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("company reads, updates, deletes, knowledge and listing are workspace isolated", () => {
  const { database, companies, knowledge, workspaceA, workspaceB } = createWorkspacePair();
  const companyA = companies.create(workspaceA, { name: "Tenant A", website: "https://shared.test", status: "ready" });
  const companyB = companies.create(workspaceB, { name: "Tenant B", website: "https://shared.test", status: "ready" });
  publishKnowledgeFixture(database,workspaceA,companyA.id,knowledgeFixture);

  assert.equal(companies.findById(workspaceB, companyA.id), null);
  assert.equal(companies.update(workspaceB, companyA.id, { name: "Intrusion", website: companyA.website, phone: "", email: "", status: "ready" }), null);
  assert.equal(companies.delete(workspaceB, companyA.id), false);
  assert.equal(knowledge.load(workspaceB, companyA.id), null);
  assert.equal(companies.findById(workspaceA, companyA.id)?.name, "Tenant A");
  assert.ok(knowledge.load(workspaceA, companyA.id));
  assert.deepEqual(companies.list(workspaceA).map((company) => company.id), [companyA.id]);
  assert.deepEqual(companies.list(workspaceB).map((company) => company.id), [companyB.id]);
  database.close();
});

test("chat cannot answer with a company from another workspace", async () => {
  const { database, companies, knowledge, workspaceA, workspaceB } = createWorkspacePair();
  const company = companies.create(workspaceA, { name: "Tenant A", website: "https://a.test", status: "ready" });
  publishKnowledgeFixture(database,workspaceA,company.id,knowledgeFixture);
  const generator = new TrackingGenerator();

  const result = await new ChatService(companies, knowledge, new AtlasAgent(generator)).chat(workspaceB, company.id, "Private question");

  assert.equal(result.kind, "company_not_found");
  assert.equal(generator.calls, 0);
  database.close();
});

test("onboarding cannot target or mutate a company from another workspace", async () => {
  const { database, companies, knowledge, workspaceA, workspaceB } = createWorkspacePair();
  const company = companies.create(workspaceA, { name: "Tenant A", website: "https://a.test", status: "ready" });
  publishKnowledgeFixture(database,workspaceA,company.id,knowledgeFixture);
  let scrapeCalls = 0;
  const scraper: WebsiteScraper = { async scrape(): Promise<{ markdown: string }> { scrapeCalls += 1; return { markdown: "private" }; } };
  const extractor: KnowledgeExtractor = { async extract(): Promise<unknown> { return knowledgeFixture; } };
  const onboarding = new OnboardingService(companies, knowledge, scraper, extractor, (markdown) => markdown, new FakeDebugStore());

  await assert.rejects(onboarding.onboard(workspaceB, company.id, company.website), CompanyNotFoundError);

  assert.equal(scrapeCalls, 0);
  assert.equal(companies.findById(workspaceA, company.id)?.status, "ready");
  assert.ok(knowledge.load(workspaceA, company.id));
  database.close();
});

test("existing HTTP company contracts work without workspace identifiers", async () => {
  const database = createDatabase(":memory:");
  const context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault());
  const companies = new CompanyRepository(database);
  const service = new CompanyService(companies);
  const app = express();
  app.use(express.json());
  const unavailableOnboarding: WebsiteScraper = { async scrape(): Promise<never> { throw new Error("not used"); } };
  const extractor: KnowledgeExtractor = { async extract(): Promise<unknown> { return knowledgeFixture; } };
  const onboarding = new OnboardingService(companies, new KnowledgeRepository(database), unavailableOnboarding, extractor, (markdown) => markdown, new FakeDebugStore());
  app.use("/companies", createCompaniesRouter({
    list: createListCompaniesController(service, context),
    create: createCompanyController(service, context),
    get: createGetCompanyController(service, context),
    update: createUpdateCompanyController(service, context),
    delete: createDeleteCompanyController(service, context),
    onboard: createOnboardingController(onboarding, context),
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const address = server.address() as AddressInfo;
  try {
    const createResponse = await fetch(`http://127.0.0.1:${address.port}/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Portal Company", website: "https://portal.test", workspaceId: 999 }),
    });
    assert.equal(createResponse.status, 400);

    const compatibleResponse = await fetch(`http://127.0.0.1:${address.port}/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Portal Company", website: "https://portal.test" }),
    });
    const created = await compatibleResponse.json() as Record<string, unknown>;
    assert.equal(compatibleResponse.status, 201);
    assert.equal(created.name, "Portal Company");
    assert.equal("workspaceId" in created, false);
    assert.deepEqual((await (await fetch(`http://127.0.0.1:${address.port}/companies`)).json() as unknown[]).length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    database.close();
  }
});
