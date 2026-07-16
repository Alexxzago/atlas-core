import assert from "node:assert/strict";
import test from "node:test";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";
import type { Clock } from "../identity/application/ports.js";
import type { AuthenticationService } from "../identity/services/authenticationService.js";
import type { UserRepositoryPort } from "../application/ports/repositories.js";
import type { AuthorizationService } from "../workspace/services/authorizationService.js";
import type { WorkspaceResolver } from "../workspace/services/workspaceResolver.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import type { AssistantProfileRepositoryPort, CreateAssistantProfileResult, UpdateAssistantProfileResult } from "../assistant/application/ports.js";
import type { AssistantProfile, AssistantProfileId } from "../assistant/domain/assistantProfile.js";
import { AssistantProfileService } from "../assistant/services/assistantProfileService.js";
import { createAssistantProfileController, createGetAssistantProfileController, createListAssistantProfilesController, createTransitionAssistantProfileController, createUpdateAssistantProfileController } from "../controllers/assistantProfileController.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { reconstructUser, type UserId } from "../identity/domain/user.js";
import { createDatabase } from "../config/database.js";
import { UserRepository } from "../repositories/userRepository.js";
import { SqliteAuthenticationTransaction } from "../repositories/identityTransaction.js";
import { AuthenticationService as RealAuthenticationService } from "../identity/services/authenticationService.js";
import { SecureRandomProvider, ScryptPasswordProvider, Sha256CredentialEnrollmentHashProvider, Sha256SessionIdentifierProvider } from "../identity/infrastructure/securityProviders.js";
import type { CredentialEnrollmentDeliveryPort, CredentialEnrollmentDeliveryRequest } from "../identity/application/ports.js";
import { SystemClock } from "../identity/infrastructure/systemClock.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { MembershipRepository } from "../repositories/workspaceAdministrationRepository.js";
import { AuthorizationService as RealAuthorizationService } from "../workspace/services/authorizationService.js";
import { WorkspaceResolver as RealWorkspaceResolver } from "../workspace/services/workspaceResolver.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { AssistantProfileRepository } from "../repositories/assistantProfileRepository.js";
import type { Membership, MembershipId, WorkspacePublicId } from "../workspace/domain/membership.js";

class FixedClock implements Clock { public now(): string { return "2026-07-16T12:00:00.000Z"; } }
class Profiles implements AssistantProfileRepositoryPort {
  public values: AssistantProfile[] = [];
  public listActive(_context: WorkspaceContext, companyId: number) { return { status: "found" as const, profiles: this.values.filter((p) => p.companyId === companyId && p.status !== "archived") }; }
  public findById(_context: WorkspaceContext, companyId: number, id: AssistantProfileId): AssistantProfile | null { return this.values.find((p) => p.companyId === companyId && p.id === id) ?? null; }
  public create(_context: WorkspaceContext, _companyId: number, profile: AssistantProfile): CreateAssistantProfileResult { if (this.values.some((p) => p.companyId === profile.companyId && p.normalizedName === profile.normalizedName)) return { status: "name_conflict" }; this.values.push(profile); return { status: "created", profile }; }
  public update(_context: WorkspaceContext, _companyId: number, profile: AssistantProfile): UpdateAssistantProfileResult { const index = this.values.findIndex((p) => p.id === profile.id); if (index < 0) return { status: "not_found" }; this.values[index] = profile; return { status: "updated", profile }; }
}
const context = Object.freeze({ workspaceId: 1, workspaceKey: "test" });
const user = reconstructUser({ id: "usr_test" as UserId, status: "active", locale: "en", authenticationIdentities: [{ id: "aid_test", email: "test@example.com", normalizedEmail: "test@example.com", emailVerified: true, createdAt: "2026-07-16T12:00:00.000Z", updatedAt: "2026-07-16T12:00:00.000Z" }], createdAt: "2026-07-16T12:00:00.000Z", updatedAt: "2026-07-16T12:00:00.000Z" });

async function startServer(allowManage = true) {
  const service = new AssistantProfileService(new Profiles(), new FixedClock());
  const noop: RequestHandler = (_req, res) => { res.status(501).send(); };
  const authentication = { cookieName: () => "atlas_dev_session", current: (raw: string) => raw === "valid" ? { userId: user.id } : null, validateCsrf: (raw: string, csrf: string) => raw === "valid" && csrf === "csrf" } as unknown as AuthenticationService;
  const users = { findById: () => user } as unknown as UserRepositoryPort;
  const authorization = { authorize: (_user: unknown, _workspace: string, permission: string) => { if (!allowManage && permission === "company:manage") throw new Error("denied"); return { userId: user.id, workspaceId: 1, workspacePublicId: "wsp_test", permission }; } } as unknown as AuthorizationService;
  const resolver = { resolve: () => context } as unknown as WorkspaceResolver;
  const app = express(); app.use(express.json());
  app.use("/workspaces", createAuthorizedCompaniesRouter({ authentication, users, authorization, resolver, controllers: { list: () => noop, create: () => noop, get: () => noop, update: () => noop, delete: () => noop, onboard: () => noop }, assistantControllers: { list: (c) => createListAssistantProfilesController(service, c), create: (c) => createAssistantProfileController(service, c), get: (c) => createGetAssistantProfileController(service, c), update: (c) => createUpdateAssistantProfileController(service, c), transition: (c) => createTransitionAssistantProfileController(service, c) } }));
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { listener.once("listening", resolve); listener.once("error", reject); });
  const address = listener.address() as AddressInfo, origin = `http://127.0.0.1:${address.port}`;
  return { origin, close: () => new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve())) };
}

function mutationHeaders(origin: string): Record<string, string> { return { "content-type": "application/json", cookie: "atlas_dev_session=valid", origin, "x-csrf-token": "csrf", "sec-fetch-site": "same-origin" }; }

test("authenticated Assistant Profile HTTP contracts cover management, lifecycle and safe DTOs", async () => {
  const running = await startServer();
  try {
    const base = `${running.origin}/workspaces/wsp_test/companies/1/assistant-profiles`;
    const createdResponse = await fetch(base, { method: "POST", headers: mutationHeaders(running.origin), body: JSON.stringify({ name: "Sales", assistantLanguage: "en", businessRole: "Sales", objective: "Qualify", welcomeMessage: "Welcome" }) });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as Record<string, unknown>;
    assert.match(String(created.id), /^asp_/); assert.equal(created.status, "draft"); assert.equal("companyId" in created, false); assert.equal("normalizedName" in created, false);
    const id = String(created.id);
    assert.equal((await fetch(base, { headers: { cookie: "atlas_dev_session=valid" } })).status, 200);
    assert.equal((await fetch(`${base}/${id}`, { headers: { cookie: "atlas_dev_session=valid" } })).status, 200);
    assert.equal((await fetch(`${base}/${id}`, { method: "PATCH", headers: mutationHeaders(running.origin), body: JSON.stringify({ status: "ready" }) })).status, 400);
    assert.equal((await fetch(`${base}/${id}/transitions`, { method: "POST", headers: mutationHeaders(running.origin), body: JSON.stringify({ targetStatus: "ready" }) })).status, 200);
    assert.equal((await fetch(`${base}/${id}/transitions`, { method: "POST", headers: mutationHeaders(running.origin), body: JSON.stringify({ targetStatus: "ready" }) })).status, 409);
    assert.equal((await fetch(`${base}/${id}/transitions`, { method: "POST", headers: mutationHeaders(running.origin), body: JSON.stringify({ targetStatus: "archived" }) })).status, 200);
    assert.deepEqual(await (await fetch(base, { headers: { cookie: "atlas_dev_session=valid" } })).json(), []);
    assert.equal((await fetch(`${base}/${id}`, { method: "PATCH", headers: mutationHeaders(running.origin), body: JSON.stringify({ name: "No" }) })).status, 409);
    assert.equal((await fetch(`${base}/${id}/transitions`, { method: "POST", headers: mutationHeaders(running.origin), body: JSON.stringify({ targetStatus: "draft" }) })).status, 200);
    assert.equal((await fetch(`${base}/${id}/preview`, { method: "POST", headers: mutationHeaders(running.origin), body: "{}" })).status, 404);
  } finally { await running.close(); }
});

test("authorized router preserves session, permission, CSRF and Origin non-disclosure", async () => {
  const running = await startServer(false);
  try {
    const base = `${running.origin}/workspaces/wsp_test/companies/1/assistant-profiles`;
    assert.equal((await fetch(base)).status, 404);
    assert.equal((await fetch(base, { headers: { cookie: "atlas_dev_session=valid" } })).status, 200);
    assert.equal((await fetch(base, { method: "POST", headers: { cookie: "atlas_dev_session=valid", "content-type": "application/json" }, body: JSON.stringify({ name: "A", assistantLanguage: "en" }) })).status, 404);
    assert.equal((await fetch(base, { method: "POST", headers: mutationHeaders(running.origin), body: JSON.stringify({ name: "A", assistantLanguage: "en" }) })).status, 404);
  } finally { await running.close(); }
});

class EnrollmentDelivery implements CredentialEnrollmentDeliveryPort {
  public request: CredentialEnrollmentDeliveryRequest | null = null;
  public async deliver(request: CredentialEnrollmentDeliveryRequest) { this.request = request; return "accepted" as const; }
}

test("real Session, Membership, PermissionPolicy and WorkspaceResolver protect Assistant Profile HTTP routes", async () => {
  const database = createDatabase(":memory:"), now = "2026-07-16T12:00:00.000Z";
  const users = new UserRepository(database), userId = "usr_pipeline" as UserId;
  users.create(reconstructUser({ id: userId, status: "active", locale: "en", authenticationIdentities: [{ id: "aid_pipeline", email: "pipeline@example.com", normalizedEmail: "pipeline@example.com", emailVerified: true, createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now }));
  const delivery = new EnrollmentDelivery();
  const authentication = new RealAuthenticationService(new SqliteAuthenticationTransaction(database), new SecureRandomProvider(), new Sha256CredentialEnrollmentHashProvider(), new ScryptPasswordProvider(), new Sha256SessionIdentifierProvider(), new SystemClock(), delivery, "http://localhost:5173", false);
  await authentication.requestEnrollment("pipeline@example.com");
  assert.ok(delivery.request);
  const proof = new URL(delivery.request.enrollmentUrl).searchParams.get("proof");
  assert.ok(proof);
  await authentication.completeEnrollment(proof, "pipeline password 🔐", "pipeline password 🔐");
  const grant = await authentication.login("pipeline@example.com", "pipeline password 🔐", "127.0.0.1");

  const workspaces = new WorkspaceRepository(database), workspace = workspaces.createForSystemUse({ key: "pipeline", name: "Pipeline" }), otherWorkspace = workspaces.createForSystemUse({ key: "other-pipeline", name: "Other" });
  const memberships = new MembershipRepository(database), membership: Membership = { id: "mem_pipeline" as MembershipId, workspaceId: workspace.id, userId, role: "owner", status: "active", version: 1, createdAt: now, activatedAt: now, suspendedAt: null, reactivatedAt: null, removedAt: null, roleChangedAt: null };
  memberships.create(membership);
  const companyRepository = new CompanyRepository(database), workspaceContext = { workspaceId: workspace.id, workspaceKey: workspace.key }, otherContext = { workspaceId: otherWorkspace.id, workspaceKey: otherWorkspace.key };
  const company = companyRepository.create(workspaceContext, { name: "Pipeline Company", website: "https://pipeline.test" });
  const foreignCompany = companyRepository.create(otherContext, { name: "Foreign Company", website: "https://foreign-pipeline.test" });
  const service = new AssistantProfileService(new AssistantProfileRepository(database), new SystemClock());
  const noop: RequestHandler = (_req, res) => { res.status(501).send(); };
  const app = express(); app.use(express.json());
  app.use("/workspaces", createAuthorizedCompaniesRouter({ authentication, users, authorization: new RealAuthorizationService(memberships, workspaces), resolver: new RealWorkspaceResolver(workspaces), controllers: { list: () => noop, create: () => noop, get: () => noop, update: () => noop, delete: () => noop, onboard: () => noop }, assistantControllers: { list: (c) => createListAssistantProfilesController(service, c), create: (c) => createAssistantProfileController(service, c), get: (c) => createGetAssistantProfileController(service, c), update: (c) => createUpdateAssistantProfileController(service, c), transition: (c) => createTransitionAssistantProfileController(service, c) } }));
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { listener.once("listening", resolve); listener.once("error", reject); });
  const address = listener.address() as AddressInfo, origin = `http://127.0.0.1:${address.port}`;
  const cookie = `${authentication.cookieName()}=${encodeURIComponent(grant.rawIdentifier)}`;
  const headers = { "content-type": "application/json", cookie, origin, "x-csrf-token": grant.csrfToken, "sec-fetch-site": "same-origin" };
  const base = `${origin}/workspaces/${workspace.publicId}/companies/${company.id}/assistant-profiles`;
  try {
    assert.equal((await fetch(base, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(base, { method: "POST", headers, body: JSON.stringify({ name: "Real", assistantLanguage: "en" }) })).status, 201);
    assert.equal((await fetch(base, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${origin}/workspaces/${workspace.publicId}/companies/999999/assistant-profiles`, { headers: { cookie } })).status, 404);
    assert.equal((await fetch(base, { headers: { cookie: `${authentication.cookieName()}=invalid` } })).status, 404);
    assert.equal((await fetch(base, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ name: "No CSRF", assistantLanguage: "en" }) })).status, 404);

    database.prepare("UPDATE memberships SET role='viewer' WHERE id=?").run(membership.id);
    assert.equal((await fetch(base, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(base, { method: "POST", headers, body: JSON.stringify({ name: "Denied", assistantLanguage: "en" }) })).status, 404);
    database.prepare("UPDATE memberships SET role='owner',status='suspended' WHERE id=?").run(membership.id);
    assert.equal((await fetch(base, { headers: { cookie } })).status, 404);
    database.prepare("UPDATE memberships SET status='removed' WHERE id=?").run(membership.id);
    assert.equal((await fetch(base, { headers: { cookie } })).status, 404);
    database.prepare("UPDATE memberships SET status='active' WHERE id=?").run(membership.id);

    assert.equal((await fetch(`${origin}/workspaces/${otherWorkspace.publicId}/companies/${foreignCompany.id}/assistant-profiles`, { headers: { cookie } })).status, 404);
    assert.equal((await fetch(`${origin}/workspaces/${workspace.publicId}/companies/${foreignCompany.id}/assistant-profiles`, { headers: { cookie } })).status, 404);
    database.prepare("UPDATE users SET status='disabled' WHERE id=?").run(userId);
    assert.equal((await fetch(base, { headers: { cookie } })).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    database.close();
  }
});
