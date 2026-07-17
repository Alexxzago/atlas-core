import assert from "node:assert/strict";
import test from "node:test";
import { AtlasAgent } from "../agents/atlas.js";
import type { AssistantExecutionRequest, AssistantExecutionResult } from "../assistant/application/assistantExecution.js";
import { assistantProfileId, reconstructAssistantProfile, type AssistantProfile } from "../assistant/domain/assistantProfile.js";
import { AssistantPreviewKnowledgeUnavailableError, AssistantPreviewNotFoundError, AssistantPreviewService, AssistantPreviewValidationError, AssistantProfileNotExecutableError } from "../assistant/services/assistantPreviewService.js";
import type { AssistantProfileRepositoryPort } from "../assistant/application/ports.js";
import { GeminiProvider } from "../providers/gemini.js";
import type { CompanyRepositoryPort, KnowledgeRepositoryPort } from "../application/ports/repositories.js";
import type { AnswerGenerator } from "../types/ports.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import { PermissionPolicy } from "../workspace/domain/membership.js";

const context = Object.freeze({ workspaceId: 1, workspaceKey: "one" });
const knowledge = { company: { name: "Atlas", website: "https://atlas.test", phone: "", email: "" }, business: { services: ["Sales"], hours: "Always", locations: ["Remote"] }, faq: [{ question: "Exact?", answer: "Stored" }] };

function profile(status: AssistantProfile["status"] = "ready"): AssistantProfile {
  return reconstructAssistantProfile({ id: assistantProfileId("asp_00000000000000000000000000000000"), companyId: 1, name: "Sales", normalizedName: "sales", description: "Administrative", businessRole: "Sales assistant", objective: "Qualify requests", audience: "Customers", tone: "friendly", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Safe fallback", status, createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z", archivedAt: status === "archived" ? "2026-07-18T00:00:00.000Z" : null });
}

class CapturingGenerator implements AnswerGenerator {
  public request: AssistantExecutionRequest | null = null;
  public async execute(request: AssistantExecutionRequest): Promise<AssistantExecutionResult> { this.request = request; return { outcome: "answered", answer: "Generated" }; }
}

function setup(profileValue: AssistantProfile | null = profile(), withKnowledge = true) {
  const companies = { findById: (_context: WorkspaceContext, id: number) => id === 1 ? { id: 1, workspaceId: 1, name: "Atlas", website: "https://atlas.test", phone: "", email: "", status: "ready" as const, createdAt: "now" } : null } as CompanyRepositoryPort;
  const knowledgeRepository = { load: () => withKnowledge ? knowledge : null } as unknown as KnowledgeRepositoryPort;
  const profiles = { findById: () => profileValue } as unknown as AssistantProfileRepositoryPort;
  const generator = new CapturingGenerator();
  return { generator, service: new AssistantPreviewService(companies, knowledgeRepository, profiles, new AtlasAgent(generator)) };
}

test("preview creates a frozen minimal contract and never uses the legacy FAQ shortcut", async () => {
  const { service, generator } = setup();
  const result = await service.preview(context, 1, "asp_00000000000000000000000000000000", { message: "Exact?" });
  assert.deepEqual(result, { outcome: "answered", answer: "Generated" });
  assert.ok(generator.request);
  assert.equal(generator.request.message, "Exact?");
  assert.equal(generator.request.purpose, "preview");
  assert.equal(Object.isFrozen(generator.request), true);
  assert.equal(Object.isFrozen(generator.request.behavior), true);
  assert.equal(Object.isFrozen(generator.request.knowledge.faq), true);
  assert.deepEqual(Object.keys(generator.request.behavior).sort(), ["assistantLanguage", "audience", "businessRole", "fallbackMessage", "objective", "tone"]);
  assert.equal("id" in generator.request.behavior, false);
  assert.equal("name" in generator.request.behavior, false);
  assert.equal("description" in generator.request.behavior, false);
  assert.equal("welcomeMessage" in generator.request.behavior, false);
});

test("preview validates input, ownership, executable state and knowledge before provider execution", async () => {
  const draft = setup(profile("draft"));
  await assert.rejects(() => draft.service.preview(context, 1, "asp_00000000000000000000000000000000", { message: "Hello" }), AssistantProfileNotExecutableError);
  assert.equal(draft.generator.request, null);
  const missing = setup(null);
  await assert.rejects(() => missing.service.preview(context, 1, "asp_00000000000000000000000000000000", { message: "Hello" }), AssistantPreviewNotFoundError);
  const noKnowledge = setup(profile(), false);
  await assert.rejects(() => noKnowledge.service.preview(context, 1, "asp_00000000000000000000000000000000", { message: "Hello" }), AssistantPreviewKnowledgeUnavailableError);
  const valid = setup();
  await assert.rejects(() => valid.service.preview(context, 1, "asp_00000000000000000000000000000000", { message: "😀".repeat(2001) }), AssistantPreviewValidationError);
  await assert.rejects(() => valid.service.preview(context, 1, "asp_00000000000000000000000000000000", { message: "Hello", provider: "gemini" }), AssistantPreviewValidationError);
});

test("dedicated preview permission is derived for operators and denied to viewers", () => {
  const policy = new PermissionPolicy();
  for (const role of ["owner", "administrator", "operator"] as const) assert.equal(policy.allows(role, "assistant:preview"), true);
  assert.equal(policy.allows("viewer", "assistant:preview"), false);
  assert.equal(policy.allows("viewer", "chat:use"), false);
});

test("Gemini adapter alone translates the contract and omits internal identifiers", async () => {
  let prompt = "";
  const client = { models: { generateContent: async (input: { contents: string }) => { prompt = input.contents; return { text: "Generated" }; } } };
  const adapter = new GeminiProvider(client);
  const request = setup().generator;
  await setup().service.preview(context, 1, "asp_00000000000000000000000000000000", { message: "Hello" });
  const execution: AssistantExecutionRequest = Object.freeze({ purpose: "preview", behavior: Object.freeze({ businessRole: "Sales", objective: "Help", audience: null, tone: "professional", assistantLanguage: "en", fallbackMessage: "Fallback" }), knowledge, message: "Hello" });
  assert.deepEqual(await adapter.execute(execution), { outcome: "answered", answer: "Generated" });
  assert.match(prompt, /ATLAS RULES/);
  assert.match(prompt, /COMPANY KNOWLEDGE/);
  assert.match(prompt, /ASSISTANT CONFIGURATION/);
  assert.doesNotMatch(prompt, /asp_00000000000000000000000000000000/);
  assert.equal(request.request, null);
});

test("Gemini adapter returns deterministic fallback for an empty response", async () => {
  const adapter = new GeminiProvider({ models: { generateContent: async () => ({ text: "" }) } });
  const execution: AssistantExecutionRequest = Object.freeze({ purpose: "preview", behavior: Object.freeze({ businessRole: "Sales", objective: "Help", audience: null, tone: "professional", assistantLanguage: "en", fallbackMessage: "Fallback" }), knowledge, message: "Unknown" });
  assert.deepEqual(await adapter.execute(execution), { outcome: "safe_fallback", answer: "Fallback" });
});
