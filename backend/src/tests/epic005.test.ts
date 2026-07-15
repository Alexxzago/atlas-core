import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { createCompanyController, createDeleteCompanyController, createGetCompanyController, createListCompaniesController, createUpdateCompanyController } from "../controllers/companyController.js";
import { createOnboardingController } from "../controllers/onboarding.js";
import { createDatabase } from "../config/database.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { KnowledgeRepository } from "../repositories/knowledgeRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createCompaniesRouter } from "../routes/companies.js";
import { CompanyService } from "../services/companyService.js";
import { OnboardingService } from "../services/onboardingService.js";
import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { KnowledgeExtractor, MarkdownDebugStore, WebsiteScraper } from "../types/ports.js";
import { createWorkspaceContext, type WorkspaceContext } from "../types/workspaceContext.js";

const extractedKnowledge: CompanyKnowledge = {
  company: { name: "Extracted Company", website: "", phone: "+54 11", email: "info@example.test" },
  business: { services: ["Consulting"], hours: "9 to 17", locations: ["Buenos Aires"] },
  faq: [{ question: "Hours?", answer: "9 to 17" }],
};

class FakeDebugStore implements MarkdownDebugStore {
  public async save(_companyId: number, _markdown: string): Promise<void> {}
}

interface TestContext {
  companies: CompanyRepository;
  knowledge: KnowledgeRepository;
  context: WorkspaceContext;
  baseUrl: string;
}

async function withApi(
  run: (context: TestContext) => Promise<void>,
  options?: { scraper?: WebsiteScraper }
): Promise<void> {
  const database = createDatabase(":memory:");
  const companies = new CompanyRepository(database);
  const knowledge = new KnowledgeRepository(database);
  const context = createWorkspaceContext(new WorkspaceRepository(database).resolveDefault());
  const companyService = new CompanyService(companies);
  const defaultScraper: WebsiteScraper = {
    async scrape(): Promise<{ markdown: string }> { return { markdown: "# Useful company content" }; },
  };
  const scraper = options?.scraper ?? defaultScraper;
  const extractor: KnowledgeExtractor = {
    async extract(): Promise<unknown> { return extractedKnowledge; },
  };
  const onboardingService = new OnboardingService(
    companies,
    knowledge,
    scraper,
    extractor,
    (markdown) => markdown,
    new FakeDebugStore()
  );
  const app = express();
  app.use(express.json());
  app.use("/companies", createCompaniesRouter({
    list: createListCompaniesController(companyService, context),
    create: createCompanyController(companyService, context),
    get: createGetCompanyController(companyService, context),
    update: createUpdateCompanyController(companyService, context),
    delete: createDeleteCompanyController(companyService, context),
    onboard: createOnboardingController(onboardingService, context),
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;

  try {
    await run({ companies, knowledge, context, baseUrl: `http://127.0.0.1:${address.port}` });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    database.close();
  }
}

test("GET returns an existing company", async () => {
  await withApi(async ({ companies, context, baseUrl }) => {
    const company = companies.create(context, { name: "Alpha", website: "https://alpha.test" });
    const response = await fetch(`${baseUrl}/companies/${company.id}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { id: number }).id, company.id);
  });
});

test("GET returns not found for a missing company", async () => {
  await withApi(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/companies/999`);
    assert.equal(response.status, 404);
  });
});

test("PATCH updates allowed company fields and preserves status", async () => {
  await withApi(async ({ companies, context, baseUrl }) => {
    const company = companies.create(context, { name: "Old", website: "https://old.test", status: "ready" });
    const response = await fetch(`${baseUrl}/companies/${company.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New", website: " HTTPS://NEW.TEST/ ", phone: "123" }),
    });
    const updated = await response.json() as { name: string; website: string; status: string };
    assert.equal(response.status, 200);
    assert.equal(updated.name, "New");
    assert.equal(updated.website, "https://new.test");
    assert.equal(updated.status, "ready");
  });
});

test("PATCH rejects a duplicate website", async () => {
  await withApi(async ({ companies, context, baseUrl }) => {
    const alpha = companies.create(context, { name: "Alpha", website: "https://alpha.test" });
    companies.create(context, { name: "Beta", website: "https://beta.test" });
    const response = await fetch(`${baseUrl}/companies/${alpha.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ website: "https://beta.test/" }),
    });
    assert.equal(response.status, 409);
  });
});

test("DELETE removes the company and cascades related knowledge", async () => {
  await withApi(async ({ companies, knowledge, context, baseUrl }) => {
    const company = companies.create(context, { name: "Alpha", website: "https://alpha.test" });
    knowledge.save(context, company.id, { ...extractedKnowledge, company: { ...extractedKnowledge.company, website: company.website } });
    const response = await fetch(`${baseUrl}/companies/${company.id}`, { method: "DELETE" });
    assert.equal(response.status, 204);
    assert.equal(companies.findById(context, company.id), null);
    assert.equal(knowledge.load(context, company.id), null);
  });
});

test("company-targeted onboarding updates the same company without creating another", async () => {
  await withApi(async ({ companies, knowledge, context, baseUrl }) => {
    const company = companies.create(context, { name: "Original", website: "https://old.test" });
    const response = await fetch(`${baseUrl}/companies/${company.id}/onboard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: " HTTPS://NEW.TEST/ " }),
    });
    const result = await response.json() as { companyId: number; status: string };
    assert.equal(response.status, 200);
    assert.equal(result.companyId, company.id);
    assert.equal(result.status, "ready");
    assert.equal(companies.list(context).length, 1);
    assert.equal(companies.findById(context, company.id)?.website, "https://new.test");
    assert.ok(knowledge.load(context, company.id));
  });
});

test("invalid companyId returns a controlled validation error", async () => {
  await withApi(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/companies/not-a-number`);
    assert.equal(response.status, 400);
  });
});

test("company-targeted onboarding rejects an invalid URL", async () => {
  await withApi(async ({ companies, context, baseUrl }) => {
    const company = companies.create(context, { name: "Alpha", website: "https://alpha.test" });
    const response = await fetch(`${baseUrl}/companies/${company.id}/onboard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "ftp://invalid.test" }),
    });
    assert.equal(response.status, 400);
  });
});

test("failed onboarding returns a controlled error and exposes failed status", async () => {
  const failedScraper: WebsiteScraper = {
    async scrape(): Promise<never> { throw new Error("SCRAPE_ALL_ENGINES_FAILED"); },
  };
  await withApi(async ({ companies, knowledge, context, baseUrl }) => {
    const company = companies.create(context, { name: "Ready", website: "https://ready.test", status: "ready" });
    knowledge.save(context, company.id, { ...extractedKnowledge, company: { ...extractedKnowledge.company, website: company.website } });

    const onboardingResponse = await fetch(`${baseUrl}/companies/${company.id}/onboard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: company.website }),
    });
    const errorBody = await onboardingResponse.json() as { error: string };
    const companyResponse = await fetch(`${baseUrl}/companies/${company.id}`);
    const refreshed = await companyResponse.json() as { status: string };

    assert.equal(onboardingResponse.status, 500);
    assert.equal(errorBody.error, "Unable to onboard company.");
    assert.equal(refreshed.status, "failed");
    assert.equal(knowledge.load(context, company.id), null);
  }, { scraper: failedScraper });
});
