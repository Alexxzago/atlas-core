import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApp } from "../app.js";
import type { AssistantExecutionRequest, AssistantExecutionResult } from "../assistant/application/assistantExecution.js";
import type { AssistantExecutionPort } from "../assistant/application/assistantExecutionPort.js";
import { AssistantProfileService } from "../assistant/services/assistantProfileService.js";
import { createProductionAppRouters } from "../composition.js";
import { database } from "../config/database.js";
import { geminiProvider } from "../providers/gemini.js";
import type { CredentialEnrollmentDeliveryPort, CredentialEnrollmentDeliveryRequest } from "../identity/application/ports.js";
import { reconstructUser, type UserId } from "../identity/domain/user.js";
import { SecureRandomProvider, ScryptPasswordProvider, Sha256CredentialEnrollmentHashProvider, Sha256SessionIdentifierProvider } from "../identity/infrastructure/securityProviders.js";
import { SystemClock } from "../identity/infrastructure/systemClock.js";
import { AuthenticationService } from "../identity/services/authenticationService.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { SqliteAuthenticationTransaction } from "../repositories/identityTransaction.js";
import { AssistantProfileRepository } from "../repositories/assistantProfileRepository.js";
import { UserRepository } from "../repositories/userRepository.js";
import { MembershipRepository } from "../repositories/workspaceAdministrationRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { publishKnowledgeFixture } from "./knowledgeTestFixture.js";
import type { Membership, MembershipId } from "../workspace/domain/membership.js";

class Delivery implements CredentialEnrollmentDeliveryPort {
  public request: CredentialEnrollmentDeliveryRequest | null = null;
  public async deliver(request: CredentialEnrollmentDeliveryRequest): Promise<"accepted"> { this.request = request; return "accepted"; }
}

class FakeExecution implements AssistantExecutionPort {
  public calls = 0;
  public async execute(_request: AssistantExecutionRequest): Promise<AssistantExecutionResult> {
    this.calls++;
    return { outcome: "answered", answer: "Fake operational answer" };
  }
}

test("production composition mounts the authorized operational route with an injected execution port", async () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
  const now = new Date().toISOString(), userId = `usr_composition_${suffix}` as UserId, email = `composition-${suffix}@example.com`;
  const users = new UserRepository(database);
  users.create(reconstructUser({ id: userId, status: "active", locale: "en", authenticationIdentities: [{ id: `aid_composition_${suffix}`, email, normalizedEmail: email, emailVerified: true, createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now }));
  const delivery = new Delivery();
  const authentication = new AuthenticationService(new SqliteAuthenticationTransaction(database), new SecureRandomProvider(), new Sha256CredentialEnrollmentHashProvider(), new ScryptPasswordProvider(), new Sha256SessionIdentifierProvider(), new SystemClock(), delivery, "http://localhost:5173", false);
  await authentication.requestEnrollment(email);
  await authentication.completeEnrollment(new URL(delivery.request!.enrollmentUrl).searchParams.get("proof")!, "composition password 123", "composition password 123");
  const grant = await authentication.login(email, "composition password 123", "127.0.0.1");
  const workspaces = new WorkspaceRepository(database), workspace = workspaces.createForSystemUse({ key: `composition-${suffix}`, name: "Composition" });
  new MembershipRepository(database).create({ id: `mem_composition_${suffix}` as MembershipId, workspaceId: workspace.id, userId, role: "operator", status: "active", version: 1, createdAt: now, activatedAt: now, suspendedAt: null, reactivatedAt: null, removedAt: null, roleChangedAt: null } satisfies Membership);
  const viewerId = `usr_composition_viewer_${suffix}` as UserId, viewerEmail = `composition-viewer-${suffix}@example.com`;
  users.create(reconstructUser({ id: viewerId, status: "active", locale: "en", authenticationIdentities: [{ id: `aid_composition_viewer_${suffix}`, email: viewerEmail, normalizedEmail: viewerEmail, emailVerified: true, createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now }));
  await authentication.requestEnrollment(viewerEmail);
  await authentication.completeEnrollment(new URL(delivery.request!.enrollmentUrl).searchParams.get("proof")!, "viewer password 123", "viewer password 123");
  const viewerGrant = await authentication.login(viewerEmail, "viewer password 123", "127.0.0.1");
  const viewerMembership = new MembershipRepository(database).create({ id: `mem_composition_viewer_${suffix}` as MembershipId, workspaceId: workspace.id, userId: viewerId, role: "viewer", status: "active", version: 1, createdAt: now, activatedAt: now, suspendedAt: null, reactivatedAt: null, removedAt: null, roleChangedAt: null } satisfies Membership);
  const administratorId = `usr_composition_administrator_${suffix}` as UserId, administratorEmail = `composition-administrator-${suffix}@example.com`;
  users.create(reconstructUser({ id: administratorId, status: "active", locale: "en", authenticationIdentities: [{ id: `aid_composition_administrator_${suffix}`, email: administratorEmail, normalizedEmail: administratorEmail, emailVerified: true, createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now }));
  await authentication.requestEnrollment(administratorEmail);
  await authentication.completeEnrollment(new URL(delivery.request!.enrollmentUrl).searchParams.get("proof")!, "administrator password 123", "administrator password 123");
  const administratorGrant = await authentication.login(administratorEmail, "administrator password 123", "127.0.0.1");
  new MembershipRepository(database).create({ id: `mem_composition_administrator_${suffix}` as MembershipId, workspaceId: workspace.id, userId: administratorId, role: "administrator", status: "active", version: 1, createdAt: now, activatedAt: now, suspendedAt: null, reactivatedAt: null, removedAt: null, roleChangedAt: null } satisfies Membership);
  const ownerId = `usr_composition_owner_${suffix}` as UserId, ownerEmail = `composition-owner-${suffix}@example.com`;
  users.create(reconstructUser({ id: ownerId, status: "active", locale: "en", authenticationIdentities: [{ id: `aid_composition_owner_${suffix}`, email: ownerEmail, normalizedEmail: ownerEmail, emailVerified: true, createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now }));
  await authentication.requestEnrollment(ownerEmail);
  await authentication.completeEnrollment(new URL(delivery.request!.enrollmentUrl).searchParams.get("proof")!, "owner password 123", "owner password 123");
  const ownerGrant = await authentication.login(ownerEmail, "owner password 123", "127.0.0.1");
  new MembershipRepository(database).create({ id: `mem_composition_owner_${suffix}` as MembershipId, workspaceId: workspace.id, userId: ownerId, role: "owner", status: "active", version: 1, createdAt: now, activatedAt: now, suspendedAt: null, reactivatedAt: null, removedAt: null, roleChangedAt: null } satisfies Membership);
  const context = { workspaceId: workspace.id, workspaceKey: workspace.key }, companies = new CompanyRepository(database);
  const company = companies.create(context, { name: "Composition", website: `https://composition-${suffix}.test`, status: "ready" });
  publishKnowledgeFixture(database, context, company.id, { company: { name: company.name, website: company.website, phone: "", email: "" }, business: { services: ["Service"], hours: "Always", locations: [] }, faq: [] });
  const profiles = new AssistantProfileRepository(database), profileService = new AssistantProfileService(profiles, new SystemClock());
  const profile = profileService.transition(context, company.id, profileService.create(context, company.id, { name: "Operational", assistantLanguage: "en", businessRole: "Sales", objective: "Help", welcomeMessage: "Welcome", fallbackMessage: "Fallback" }).id, "ready");
  const otherCompany = companies.create(context, { name: "Other", website: `https://other-${suffix}.test`, status: "ready" });
  const mismatchedProfile = profileService.create(context, otherCompany.id, { name: "Other operational", assistantLanguage: "en", businessRole: "Sales", objective: "Help", welcomeMessage: "Welcome", fallbackMessage: "Fallback" });
  const execution = new FakeExecution();
  assert.equal(Reflect.get(geminiProvider, "client"), null);
  const app = createApp(createProductionAppRouters(execution), { production: true, trustedLocalMode: false });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { listener.once("listening", resolve); listener.once("error", reject); });
  const origin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  const path = `${origin}/workspaces/${workspace.publicId}/companies/${company.id}/assistant/executions`;
  try {
    const denied = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    assert.equal(denied.status, 404); assert.equal(execution.calls, 0);
    const viewer = await fetch(path, { method: "POST", headers: { "content-type": "application/json", cookie: `${authentication.cookieName()}=${encodeURIComponent(viewerGrant.rawIdentifier)}`, origin, "x-csrf-token": viewerGrant.csrfToken, "sec-fetch-site": "same-origin" }, body: "{" });
    assert.equal(viewer.status, 404); assert.equal(execution.calls, 0);
    assert.equal(new MembershipRepository(database).update({ ...viewerMembership, status: "suspended", suspendedAt: now }, viewerMembership.version), true);
    const inactive = await fetch(path, { method: "POST", headers: { "content-type": "application/json", cookie: `${authentication.cookieName()}=${encodeURIComponent(viewerGrant.rawIdentifier)}`, origin, "x-csrf-token": viewerGrant.csrfToken, "sec-fetch-site": "same-origin" }, body: "{" });
    assert.equal(inactive.status, 404); assert.equal(execution.calls, 0);
    const foreignWorkspace = workspaces.createForSystemUse({ key: `composition-foreign-${suffix}`, name: "Foreign" });
    const foreign = await fetch(`${origin}/workspaces/${foreignWorkspace.publicId}/companies/${company.id}/assistant/executions`, { method: "POST", headers: { "content-type": "application/json", cookie: `${authentication.cookieName()}=${encodeURIComponent(grant.rawIdentifier)}`, origin, "x-csrf-token": grant.csrfToken, "sec-fetch-site": "same-origin" }, body: "{" });
    assert.equal(foreign.status, 404); assert.equal(execution.calls, 0);
    const requestHeaders = { "content-type": "application/json", cookie: `${authentication.cookieName()}=${encodeURIComponent(grant.rawIdentifier)}`, origin, "x-csrf-token": grant.csrfToken, "sec-fetch-site": "same-origin" };
    const malformedProfile = await fetch(path, { method: "POST", headers: requestHeaders, body: JSON.stringify({ assistantProfileId: "invalid", message: "Question" }) });
    assert.equal(malformedProfile.status, 400); assert.equal(execution.calls, 0);
    for (const assistantProfileId of ["asp_ffffffffffffffffffffffffffffffff", mismatchedProfile.id]) {
      const absent = await fetch(path, { method: "POST", headers: requestHeaders, body: JSON.stringify({ assistantProfileId, message: "Question" }) });
      assert.equal(absent.status, 404); assert.equal(execution.calls, 0);
    }
    for (const permitted of [administratorGrant, ownerGrant, grant]) {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", cookie: `${authentication.cookieName()}=${encodeURIComponent(permitted.rawIdentifier)}`, origin, "x-csrf-token": permitted.csrfToken, "sec-fetch-site": "same-origin" }, body: JSON.stringify({ assistantProfileId: profile.id, message: "Question" }) });
      assert.equal(response.status, 200);
    }
    assert.equal(execution.calls, 3);
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", cookie: `${authentication.cookieName()}=${encodeURIComponent(grant.rawIdentifier)}`, origin, "x-csrf-token": grant.csrfToken, "sec-fetch-site": "same-origin" }, body: JSON.stringify({ assistantProfileId: profile.id, message: "Question" }) });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: "answered", answer: "Fake operational answer" }); assert.equal(execution.calls, 4);
    assert.equal(Reflect.get(geminiProvider, "client"), null);
    assert.equal((await fetch(`${origin}/chat`)).status, 404);
  } finally { await new Promise<void>((resolve) => listener.close(() => resolve())); }
});
