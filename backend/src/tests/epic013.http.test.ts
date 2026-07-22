import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express, { type RequestHandler } from "express";
import { createApp } from "../app.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { createDatabase } from "../config/database.js";
import { UserRepository } from "../repositories/userRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { MembershipRepository } from "../repositories/workspaceAdministrationRepository.js";
import { AuthorizationService } from "../workspace/services/authorizationService.js";
import { WorkspaceResolver } from "../workspace/services/workspaceResolver.js";
import { AuthenticationService } from "../identity/services/authenticationService.js";
import { SqliteAuthenticationTransaction } from "../repositories/identityTransaction.js";
import { SecureRandomProvider, ScryptPasswordProvider, Sha256CredentialEnrollmentHashProvider, Sha256SessionIdentifierProvider } from "../identity/infrastructure/securityProviders.js";
import { SystemClock } from "../identity/infrastructure/systemClock.js";
import { reconstructUser, type UserId } from "../identity/domain/user.js";
import type { CredentialEnrollmentDeliveryPort, CredentialEnrollmentDeliveryRequest } from "../identity/application/ports.js";
import type { Membership, MembershipId } from "../workspace/domain/membership.js";

class Delivery implements CredentialEnrollmentDeliveryPort { public request: CredentialEnrollmentDeliveryRequest | null = null; public async deliver(request: CredentialEnrollmentDeliveryRequest) { this.request = request; return "accepted" as const; } }
test("operational route authorizes before route-local parsing", async () => {
  const db = createDatabase(":memory:"), users = new UserRepository(db), now = new Date().toISOString(), userId = "usr_epic013" as UserId;
  users.create(reconstructUser({ id: userId, status: "active", locale: "en", authenticationIdentities: [{ id: "aid_epic013", email: "epic013@example.com", normalizedEmail: "epic013@example.com", emailVerified: true, createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now }));
  const delivery = new Delivery(), auth = new AuthenticationService(new SqliteAuthenticationTransaction(db), new SecureRandomProvider(), new Sha256CredentialEnrollmentHashProvider(), new ScryptPasswordProvider(), new Sha256SessionIdentifierProvider(), new SystemClock(), delivery, "http://localhost:5173", false);
  await auth.requestEnrollment("epic013@example.com"); await auth.completeEnrollment(new URL(delivery.request!.enrollmentUrl).searchParams.get("proof")!, "password 123456", "password 123456"); const grant = await auth.login("epic013@example.com", "password 123456", "127.0.0.1");
  const workspaces = new WorkspaceRepository(db), workspace = workspaces.createForSystemUse({ key: "epic013", name: "EPIC 013" }), memberships = new MembershipRepository(db);
  memberships.create({ id: "mem_epic013" as MembershipId, workspaceId: workspace.id, userId, role: "operator", status: "active", version: 1, createdAt: now, activatedAt: now, suspendedAt: null, reactivatedAt: null, removedAt: null, roleChangedAt: null } satisfies Membership);
  let calls = 0; const noop: RequestHandler = (_req, res) => res.status(404).end(); const execution: RequestHandler = (_req, res) => { calls++; res.json({ status: "answered", answer: "safe" }); };
  const authorizedCompaniesRouter = createAuthorizedCompaniesRouter({ authentication: auth, users, authorization: new AuthorizationService(memberships, workspaces), resolver: new WorkspaceResolver(workspaces), controllers: { list: () => noop, create: () => noop, get: () => noop, update: () => noop, delete: () => noop, onboard: () => noop }, assistantControllers: { list: () => noop, create: () => noop, get: () => noop, update: () => noop, transition: () => noop, preview: () => noop, execution: () => execution } });
  const empty = express.Router(), app = createApp({ authorizedCompaniesRouter, chatRouter: empty, companiesRouter: empty, identityRouter: empty, knowledgeRouter: empty, scrapeRouter: empty, workspacesRouter: empty }, { production: true, trustedLocalMode: false });
  const listener = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => listener.once("listening", resolve)); const origin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`, path = `${origin}/workspaces/${workspace.publicId}/companies/1/assistant/executions`;
  try {
    const variants = [`${path}/`, path.replace("/workspaces/", "/WORKSPACES/")];
    for (const variant of variants) {
      const denied = await fetch(variant, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
      assert.equal(denied.status, 404); assert.equal(calls, 0);
    }
    const headers = { "content-type": "application/json", cookie: `${auth.cookieName()}=${encodeURIComponent(grant.rawIdentifier)}`, origin, "x-csrf-token": grant.csrfToken, "sec-fetch-site": "same-origin" };
    for (const fetchMetadata of [undefined, "invalid"]) {
      const metadataHeaders = { ...headers, ...(fetchMetadata === undefined ? {} : { "sec-fetch-site": fetchMetadata }) };
      if (fetchMetadata === undefined) delete (metadataHeaders as Record<string, string>)["sec-fetch-site"];
      const denied = await fetch(path, { method: "POST", headers: metadataHeaders, body: "{" });
      assert.equal(denied.status, 404); assert.equal(denied.headers.get("cache-control"), "no-store, private"); assert.equal(calls, 0);
    }
    const invalidCsrf = await fetch(path, { method: "POST", headers: { ...headers, "x-csrf-token": "invalid" }, body: "{" });
    assert.equal(invalidCsrf.status, 404); assert.equal(calls, 0);
    const invalidOrigin = await fetch(path, { method: "POST", headers: { ...headers, origin: "http://invalid.test" }, body: "{" });
    assert.equal(invalidOrigin.status, 404); assert.equal(calls, 0);
    for (const variant of variants) {
      const malformed = await fetch(variant, { method: "POST", headers, body: "{" });
      assert.equal(malformed.status, 400); assert.equal(calls, 0);
    }
    const unsupported = await fetch(path, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" });
    assert.equal(unsupported.status, 415); assert.equal(unsupported.headers.get("cache-control"), "no-store, private"); assert.equal(calls, 0);
    const oversized = await fetch(path, { method: "POST", headers, body: "x".repeat(9 * 1024) });
    assert.equal(oversized.status, 413); assert.equal(oversized.headers.get("cache-control"), "no-store, private"); assert.equal(calls, 0);
    const success = await fetch(path, { method: "POST", headers, body: "{}" }); assert.equal(success.status, 200); assert.equal(calls, 1);
  } finally { await new Promise<void>((resolve) => listener.close(() => resolve())); }
});
