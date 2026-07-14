import assert from "node:assert/strict";
import { test } from "node:test";
import { AtlasAgent } from "../agents/atlas.js";
import { createDatabase } from "../config/database.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { KnowledgeRepository } from "../repositories/knowledgeRepository.js";
import { ChatService } from "../services/chatService.js";
import { OnboardingError, OnboardingService } from "../services/onboardingService.js";
import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { AnswerGenerator, KnowledgeExtractor, MarkdownDebugStore, WebsiteScraper } from "../types/ports.js";

const alphaKnowledge: CompanyKnowledge = {
  company: { name: "Alpha", website: "https://alpha.test", phone: "", email: "" },
  business: { services: ["Alpha service"], hours: "Nine to five", locations: ["Alpha City"] },
  faq: [],
};

function createRepositories(): { companies: CompanyRepository; knowledge: KnowledgeRepository } {
  const database = createDatabase(":memory:");
  const companies = new CompanyRepository(database);
  return { companies, knowledge: new KnowledgeRepository(database, companies) };
}

class FakeAnswerGenerator implements AnswerGenerator {
  public receivedKnowledge: CompanyKnowledge | null = null;
  public async generate(_message: string, knowledge: CompanyKnowledge): Promise<string> {
    this.receivedKnowledge = knowledge;
    return `Answer for ${knowledge.company.name}`;
  }
}

class FakeDebugStore implements MarkdownDebugStore {
  public async save(_companyId: number, _markdown: string): Promise<void> {}
}

test("chat keeps company knowledge isolated", async () => {
  const { companies, knowledge } = createRepositories();
  const alpha = companies.save({ name: "Alpha", website: "https://alpha.test", status: "ready" });
  const beta = companies.save({ name: "Beta", website: "https://beta.test", status: "ready" });
  knowledge.save(alpha.id, alphaKnowledge);
  knowledge.save(beta.id, {
    ...alphaKnowledge,
    company: { ...alphaKnowledge.company, name: "Beta", website: "https://beta.test" },
  });
  const generator = new FakeAnswerGenerator();
  const service = new ChatService(companies, knowledge, new AtlasAgent(generator));

  const result = await service.chat(alpha.id, "Tell me about the company");

  assert.equal(result.kind, "answered");
  assert.equal(result.answer, "Answer for Alpha");
  assert.equal(generator.receivedKnowledge?.company.name, "Alpha");
});

test("onboarding moves a company from processing to ready", async () => {
  const { companies, knowledge } = createRepositories();
  let statusDuringScrape: string | undefined;
  const scraper: WebsiteScraper = {
    async scrape(url: string): Promise<{ markdown: string }> {
      statusDuringScrape = companies.findByWebsite(url)?.status;
      return { markdown: "# Alpha\n\nUseful content" };
    },
  };
  const extractor: KnowledgeExtractor = {
    async extract(): Promise<unknown> { return alphaKnowledge; },
  };
  const service = new OnboardingService(
    companies, knowledge, scraper, extractor, (markdown) => markdown.trim(), new FakeDebugStore()
  );

  const result = await service.onboard(" HTTPS://ALPHA.TEST/ ");

  assert.equal(statusDuringScrape, "processing");
  assert.equal(result.status, "ready");
  assert.equal(companies.findById(result.companyId)?.status, "ready");
  assert.ok(knowledge.load(result.companyId));
});

test("failed onboarding marks the company as failed", async () => {
  const { companies, knowledge } = createRepositories();
  const scraper: WebsiteScraper = {
    async scrape(): Promise<never> { throw new Error("scrape unavailable"); },
  };
  const extractor: KnowledgeExtractor = {
    async extract(): Promise<unknown> { return alphaKnowledge; },
  };
  const service = new OnboardingService(
    companies, knowledge, scraper, extractor, (markdown) => markdown, new FakeDebugStore()
  );

  await assert.rejects(service.onboard("https://failure.test"), OnboardingError);
  assert.equal(companies.findByWebsite("https://failure.test")?.status, "failed");
});

test("chat returns a controlled response for a missing company", async () => {
  const { companies, knowledge } = createRepositories();
  const service = new ChatService(companies, knowledge, new AtlasAgent(new FakeAnswerGenerator()));

  const result = await service.chat(999, "Hello");

  assert.equal(result.kind, "company_not_found");
  assert.match(result.answer, /human agent/i);
});

test("chat returns a controlled response when company knowledge is missing", async () => {
  const { companies, knowledge } = createRepositories();
  const company = companies.save({ name: "Empty", website: "https://empty.test", status: "ready" });
  const service = new ChatService(companies, knowledge, new AtlasAgent(new FakeAnswerGenerator()));

  const result = await service.chat(company.id, "Hello");

  assert.equal(result.kind, "knowledge_not_found");
  assert.match(result.answer, /human agent/i);
});
