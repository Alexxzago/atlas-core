import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express, { type RequestHandler } from "express";
import type { AssistantExecutionRequest, AssistantExecutionResult } from "../assistant/application/assistantExecution.js";
import { AnswerGenerationUnavailableError } from "../assistant/application/assistantExecution.js";
import { AssistantPreviewService } from "../assistant/services/assistantPreviewService.js";
import { AssistantProfileService } from "../assistant/services/assistantProfileService.js";
import { AtlasAgent } from "../agents/atlas.js";
import { createDatabase } from "../config/database.js";
import { createAssistantPreviewController } from "../controllers/assistantPreviewController.js";
import type { CredentialEnrollmentDeliveryPort, CredentialEnrollmentDeliveryRequest } from "../identity/application/ports.js";
import { reconstructUser, type UserId } from "../identity/domain/user.js";
import { SecureRandomProvider, ScryptPasswordProvider, Sha256CredentialEnrollmentHashProvider, Sha256SessionIdentifierProvider } from "../identity/infrastructure/securityProviders.js";
import { SystemClock } from "../identity/infrastructure/systemClock.js";
import { AuthenticationService } from "../identity/services/authenticationService.js";
import { AssistantProfileRepository } from "../repositories/assistantProfileRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { SqliteAuthenticationTransaction } from "../repositories/identityTransaction.js";
import { KnowledgeRepository } from "../repositories/knowledgeRepository.js";
import { MembershipRepository } from "../repositories/workspaceAdministrationRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { UserRepository } from "../repositories/userRepository.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import type { AnswerGenerator } from "../types/ports.js";
import type { Membership, MembershipId } from "../workspace/domain/membership.js";
import { AuthorizationService } from "../workspace/services/authorizationService.js";
import { WorkspaceResolver } from "../workspace/services/workspaceResolver.js";

class EnrollmentDelivery implements CredentialEnrollmentDeliveryPort {
  public request: CredentialEnrollmentDeliveryRequest | null = null;
  public async deliver(request: CredentialEnrollmentDeliveryRequest) { this.request = request; return "accepted" as const; }
}

class ControlledGenerator implements AnswerGenerator {
  public unavailable = false;
  public outcome: AssistantExecutionResult = { outcome: "answered", answer: "Preview answer" };
  public request: AssistantExecutionRequest | null = null;
  public async execute(request: AssistantExecutionRequest): Promise<AssistantExecutionResult> {
    this.request = request;
    if (this.unavailable) throw new AnswerGenerationUnavailableError();
    return this.outcome;
  }
}

test("real Assistant Preview endpoint freezes authentication, authorization, HTTP and tenant contracts", async () => {
  const database = createDatabase(":memory:");
  const users = new UserRepository(database), userId = "usr_preview_http" as UserId;
  const now = new Date().toISOString();
  users.create(reconstructUser({ id: userId, status: "active", locale: "en", authenticationIdentities: [{ id: "aid_preview_http", email: "preview@example.com", normalizedEmail: "preview@example.com", emailVerified: true, createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now }));
  const delivery = new EnrollmentDelivery();
  const authentication = new AuthenticationService(new SqliteAuthenticationTransaction(database), new SecureRandomProvider(), new Sha256CredentialEnrollmentHashProvider(), new ScryptPasswordProvider(), new Sha256SessionIdentifierProvider(), new SystemClock(), delivery, "http://localhost:5173", false);
  await authentication.requestEnrollment("preview@example.com");
  const proof = new URL(delivery.request!.enrollmentUrl).searchParams.get("proof")!;
  await authentication.completeEnrollment(proof, "preview password 🔐", "preview password 🔐");
  const grant = await authentication.login("preview@example.com", "preview password 🔐", "127.0.0.1");

  const workspaces = new WorkspaceRepository(database);
  const workspace = workspaces.createForSystemUse({ key: "preview", name: "Preview" });
  const foreignWorkspace = workspaces.createForSystemUse({ key: "preview-foreign", name: "Foreign" });
  const memberships = new MembershipRepository(database);
  const membership: Membership = { id: "mem_preview_http" as MembershipId, workspaceId: workspace.id, userId, role: "owner", status: "active", version: 1, createdAt: now, activatedAt: now, suspendedAt: null, reactivatedAt: null, removedAt: null, roleChangedAt: null };
  memberships.create(membership);

  const companies = new CompanyRepository(database), knowledge = new KnowledgeRepository(database), profiles = new AssistantProfileRepository(database);
  const context = { workspaceId: workspace.id, workspaceKey: workspace.key }, foreignContext = { workspaceId: foreignWorkspace.id, workspaceKey: foreignWorkspace.key };
  const readyCompany = companies.create(context, { name: "Ready", website: "https://ready.test", status: "ready" });
  const processingCompany = companies.create(context, { name: "Processing", website: "https://processing.test", status: "processing" });
  const noKnowledgeCompany = companies.create(context, { name: "No Knowledge", website: "https://no-knowledge.test", status: "ready" });
  const otherCompany = companies.create(context, { name: "Other", website: "https://other.test", status: "ready" });
  const foreignCompany = companies.create(foreignContext, { name: "Foreign", website: "https://foreign.test", status: "ready" });
  const knowledgeValue = { company: { name: "Ready", website: "https://ready.test", phone: "", email: "" }, business: { services: ["Service"], hours: "Always", locations: ["Remote"] }, faq: [] };
  for (const company of [readyCompany, processingCompany, otherCompany, foreignCompany]) knowledge.save(company.workspaceId === workspace.id ? context : foreignContext, company.id, { ...knowledgeValue, company: { ...knowledgeValue.company, name: company.name, website: company.website } });

  const profileService = new AssistantProfileService(profiles, new SystemClock());
  let profileSequence = 0;
  const createProfile = (companyId: number, makeReady: boolean) => {
    let profile = profileService.create(companyId === foreignCompany.id ? foreignContext : context, companyId, { name: `Profile ${companyId}-${++profileSequence}`, assistantLanguage: "en", businessRole: "Sales", objective: "Help customers", welcomeMessage: "Welcome", fallbackMessage: "Safe fallback" });
    if (makeReady) profile = profileService.transition(companyId === foreignCompany.id ? foreignContext : context, companyId, profile.id, "ready");
    return profile;
  };
  const readyProfile = createProfile(readyCompany.id, true);
  const draftProfile = createProfile(readyCompany.id, false);
  const processingProfile = createProfile(processingCompany.id, true);
  const noKnowledgeProfile = createProfile(noKnowledgeCompany.id, true);
  const otherProfile = createProfile(otherCompany.id, true);
  const foreignProfile = createProfile(foreignCompany.id, true);

  const generator = new ControlledGenerator();
  const previewService = new AssistantPreviewService(companies, knowledge, profiles, new AtlasAgent(generator));
  const noop: RequestHandler = (_req, res) => { res.status(501).send(); };
  const app = express(); app.use(express.json());
  app.use("/workspaces", createAuthorizedCompaniesRouter({ authentication, users, authorization: new AuthorizationService(memberships, workspaces), resolver: new WorkspaceResolver(workspaces), controllers: { list: () => noop, create: () => noop, get: () => noop, update: () => noop, delete: () => noop, onboard: () => noop }, assistantControllers: { list: () => noop, create: () => noop, get: () => noop, update: () => noop, transition: () => noop, preview: (trusted) => createAssistantPreviewController(previewService, trusted) } }));
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { listener.once("listening", resolve); listener.once("error", reject); });
  const address = listener.address() as AddressInfo, origin = `http://127.0.0.1:${address.port}`;
  const cookie = `${authentication.cookieName()}=${encodeURIComponent(grant.rawIdentifier)}`;
  const headers = { "content-type": "application/json", cookie, origin, "x-csrf-token": grant.csrfToken, "sec-fetch-site": "same-origin" };
  const url = (companyId: number | string, profileId: string, workspaceId = workspace.publicId) => `${origin}/workspaces/${workspaceId}/companies/${companyId}/assistant-profiles/${profileId}/preview`;
  const post = (target: string, body: unknown, overrides: Record<string, string> = headers) => fetch(target, { method: "POST", headers: overrides, body: JSON.stringify(body) });

  try {
    const success = await post(url(readyCompany.id, readyProfile.id), { message: "Hello" });
    assert.equal(success.status, 200);
    assert.equal(success.headers.get("cache-control"), "no-store, private");
    assert.equal(success.headers.get("pragma"), "no-cache");
    assert.deepEqual(await success.json(), { status: "answered", answer: "Preview answer" });
    assert.equal(generator.request?.purpose, "preview");

    generator.outcome = { outcome: "safe_fallback", answer: "Safe fallback" };
    assert.deepEqual(await (await post(url(readyCompany.id, readyProfile.id), { message: "Unknown" })).json(), { status: "safe_fallback", answer: "Safe fallback" });
    generator.outcome = { outcome: "answered", answer: "Preview answer" };

    assert.equal((await post(url(readyCompany.id, readyProfile.id), { message: "", extra: true })).status, 400);
    assert.equal((await post(url("bad", readyProfile.id), { message: "Hello" })).status, 404);
    assert.equal((await post(url(readyCompany.id, "bad"), { message: "Hello" })).status, 404);
    assert.equal((await post(url(999999, readyProfile.id), { message: "Hello" })).status, 404);
    assert.equal((await post(url(readyCompany.id, otherProfile.id), { message: "Hello" })).status, 404);
    assert.equal((await post(url(readyCompany.id, foreignProfile.id), { message: "Hello" })).status, 404);
    assert.equal((await post(url(foreignCompany.id, foreignProfile.id, foreignWorkspace.publicId), { message: "Hello" })).status, 404);

    assert.equal((await post(url(readyCompany.id, draftProfile.id), { message: "Hello" })).status, 409);
    assert.equal((await post(url(processingCompany.id, processingProfile.id), { message: "Hello" })).status, 409);
    assert.equal((await post(url(noKnowledgeCompany.id, noKnowledgeProfile.id), { message: "Hello" })).status, 409);
    generator.unavailable = true;
    assert.equal((await post(url(readyCompany.id, readyProfile.id), { message: "Hello" })).status, 503);
    generator.unavailable = false;

    assert.equal((await post(url(readyCompany.id, readyProfile.id), { message: "Hello" }, { ...headers, "x-csrf-token": "invalid" })).status, 404);
    assert.equal((await post(url(readyCompany.id, readyProfile.id), { message: "Hello" }, { ...headers, origin: "https://evil.example" })).status, 404);
    assert.equal((await post(url(readyCompany.id, readyProfile.id), { message: "Hello" }, { ...headers, origin: `https://127.0.0.1:${address.port}` })).status, 404);
    assert.equal((await post(url(readyCompany.id, readyProfile.id), { message: "Hello" }, { ...headers, "sec-fetch-site": "same-site" })).status, 404);
    assert.equal((await post(url(readyCompany.id, readyProfile.id), { message: "Hello" }, { ...headers, "sec-fetch-site": "cross-site" })).status, 404);
    assert.equal((await post(url(readyCompany.id, readyProfile.id), { message: "Hello" }, { ...headers, cookie: `${authentication.cookieName()}=invalid` })).status, 404);

    database.prepare("UPDATE memberships SET role='viewer' WHERE id=?").run(membership.id);
    assert.equal((await post(url(readyCompany.id, readyProfile.id), { message: "Hello" })).status, 404);
    database.prepare("UPDATE memberships SET role='owner',status='suspended' WHERE id=?").run(membership.id);
    assert.equal((await post(url(readyCompany.id, readyProfile.id), { message: "Hello" })).status, 404);
    database.prepare("UPDATE memberships SET status='removed' WHERE id=?").run(membership.id);
    assert.equal((await post(url(readyCompany.id, readyProfile.id), { message: "Hello" })).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    database.close();
  }
});
