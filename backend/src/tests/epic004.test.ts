import assert from "node:assert/strict";
import { test } from "node:test";
import { AtlasAgent } from "../agents/atlas.js";
import { createDatabase } from "../config/database.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { KnowledgeRepository } from "../repositories/knowledgeRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { ChatService } from "../services/chatService.js";
import { OnboardingError, OnboardingService } from "../services/onboardingService.js";
import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { AnswerGenerator, KnowledgeExtractor, MarkdownDebugStore, WebsiteScraper } from "../types/ports.js";
import { AnswerGenerationUnavailableError } from "../assistant/application/assistantExecution.js";
import { createWorkspaceContext, type WorkspaceContext } from "../types/workspaceContext.js";

const alphaKnowledge: CompanyKnowledge = {
  company: { name: "Alpha", website: "https://alpha.test", phone: "", email: "" },
  business: { services: ["Alpha service"], hours: "Nine to five", locations: ["Alpha City"] },
  faq: [],
};

interface TestRepositories {
  companies: CompanyRepository;
  knowledge: KnowledgeRepository;
  context: WorkspaceContext;
}

function createRepositories(): TestRepositories {
  const database = createDatabase(":memory:");
  const workspaces = new WorkspaceRepository(database);
  return {
    companies: new CompanyRepository(database),
    knowledge: new KnowledgeRepository(database),
    context: createWorkspaceContext(workspaces.resolveDefault()),
  };
}

class FakeAnswerGenerator implements AnswerGenerator {
  public receivedKnowledge: CompanyKnowledge | null = null;
  public async execute(request: import("../assistant/application/assistantExecution.js").AssistantExecutionRequest): Promise<import("../assistant/application/assistantExecution.js").AssistantExecutionResult> {
    this.receivedKnowledge = request.knowledge as CompanyKnowledge;
    return { outcome: "answered", answer: `Answer for ${request.knowledge.company.name}` };
  }
}

class FakeDebugStore implements MarkdownDebugStore {
  public async save(_companyId: number, _markdown: string): Promise<void> {}
}

test("chat keeps company knowledge isolated", async () => {
  const { companies, knowledge, context } = createRepositories();
  const alpha = companies.create(context, { name: "Alpha", website: "https://alpha.test", status: "ready" });
  const beta = companies.create(context, { name: "Beta", website: "https://beta.test", status: "ready" });
  knowledge.save(context, alpha.id, alphaKnowledge);
  knowledge.save(context, beta.id, { ...alphaKnowledge, company: { ...alphaKnowledge.company, name: "Beta", website: "https://beta.test" } });
  const generator = new FakeAnswerGenerator();
  const service = new ChatService(companies, knowledge, new AtlasAgent(generator));

  const result = await service.chat(context, alpha.id, "Tell me about the company");

  assert.equal(result.kind, "answered");
  assert.equal(result.answer, "Answer for Alpha");
  assert.equal(generator.receivedKnowledge?.company.name, "Alpha");
});

test("onboarding moves a company from processing to ready", async () => {
  const { companies, knowledge, context } = createRepositories();
  let statusDuringScrape: string | undefined;
  const scraper: WebsiteScraper = {
    async scrape(url: string): Promise<{ markdown: string }> {
      statusDuringScrape = companies.findByWebsite(context, url)?.status;
      return { markdown: "# Alpha\n\nUseful content" };
    },
  };
  const extractor: KnowledgeExtractor = { async extract(): Promise<unknown> { return alphaKnowledge; } };
  const service = new OnboardingService(companies, knowledge, scraper, extractor, (markdown) => markdown.trim(), new FakeDebugStore());
  const company = companies.create(context, { name: "Alpha", website: "https://old-alpha.test" });

  const result = await service.onboard(context, company.id, " HTTPS://ALPHA.TEST/ ");

  assert.equal(statusDuringScrape, "processing");
  assert.equal(result.status, "ready");
  assert.equal(companies.findById(context, result.companyId)?.status, "ready");
  assert.ok(knowledge.load(context, result.companyId));
});

test("failed onboarding marks the company as failed", async () => {
  const { companies, knowledge, context } = createRepositories();
  const scraper: WebsiteScraper = { async scrape(): Promise<never> { throw new Error("scrape unavailable"); } };
  const extractor: KnowledgeExtractor = { async extract(): Promise<unknown> { return alphaKnowledge; } };
  const service = new OnboardingService(companies, knowledge, scraper, extractor, (markdown) => markdown, new FakeDebugStore());
  const company = companies.create(context, { name: "Failure", website: "https://failure.test" });

  await assert.rejects(service.onboard(context, company.id, company.website), OnboardingError);
  assert.equal(companies.findById(context, company.id)?.status, "failed");
});

test("a failed retry invalidates old knowledge and keeps a previously ready company unavailable", async () => {
  const { companies, knowledge, context } = createRepositories();
  const company = companies.create(context, { name: "Ready", website: "https://ready.test", status: "ready" });
  knowledge.save(context, company.id, alphaKnowledge);
  const scraper: WebsiteScraper = { async scrape(): Promise<never> { throw new Error("SCRAPE_ALL_ENGINES_FAILED"); } };
  const extractor: KnowledgeExtractor = { async extract(): Promise<unknown> { return alphaKnowledge; } };
  const generator = new FakeAnswerGenerator();
  const onboarding = new OnboardingService(companies, knowledge, scraper, extractor, (markdown) => markdown, new FakeDebugStore());

  await assert.rejects(onboarding.onboard(context, company.id, company.website), OnboardingError);

  assert.equal(companies.findById(context, company.id)?.status, "failed");
  assert.equal(knowledge.load(context, company.id), null);
  const chat = await new ChatService(companies, knowledge, new AtlasAgent(generator)).chat(context, company.id, "Old question");
  assert.equal(chat.kind, "company_not_ready");
  assert.equal(generator.receivedKnowledge, null);
});

test("chat returns a controlled response for a missing company", async () => {
  const { companies, knowledge, context } = createRepositories();
  const result = await new ChatService(companies, knowledge, new AtlasAgent(new FakeAnswerGenerator())).chat(context, 999, "Hello");
  assert.equal(result.kind, "company_not_found");
  assert.match(result.answer, /human agent/i);
});

test("chat returns a controlled response when company knowledge is missing", async () => {
  const { companies, knowledge, context } = createRepositories();
  const company = companies.create(context, { name: "Empty", website: "https://empty.test", status: "ready" });
  const result = await new ChatService(companies, knowledge, new AtlasAgent(new FakeAnswerGenerator())).chat(context, company.id, "Hello");
  assert.equal(result.kind, "knowledge_not_found");
  assert.match(result.answer, /human agent/i);
});

test("chat preserves its released temporary answer when generation is unavailable", async () => {
  const { companies, knowledge, context } = createRepositories();
  const company = companies.create(context, { name: "Alpha", website: "https://alpha.test", status: "ready" });
  knowledge.save(context, company.id, alphaKnowledge);
  const unavailable: AnswerGenerator = { async execute() { throw new AnswerGenerationUnavailableError(); } };
  const result = await new ChatService(companies, knowledge, new AtlasAgent(unavailable)).chat(context, company.id, "Hello");
  assert.deepEqual(result, { kind: "answered", answer: "I'm temporarily unable to check that information. I can connect you with a human agent." });
});
