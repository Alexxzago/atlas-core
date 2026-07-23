import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../config/database.js";
import { createAuthenticationControllers, createPlatformBootstrapControllers, createRegistrationController, createResendVerificationController, createVerifyEmailController } from "../controllers/identityController.js";
import { SecureRandomProvider, ScryptPasswordProvider, Sha256CredentialEnrollmentHashProvider, Sha256SessionIdentifierProvider, Sha256VerificationHashProvider } from "../identity/infrastructure/securityProviders.js";
import { SystemClock } from "../identity/infrastructure/systemClock.js";
import { ExactRequestOriginPolicy } from "../identity/infrastructure/requestOriginPolicy.js";
import { AuthenticationService } from "../identity/services/authenticationService.js";
import { PlatformBootstrapConflict, PlatformBootstrapService } from "../identity/services/platformBootstrapService.js";
import { SqliteAuthenticationTransaction, SqliteIdentityTransaction } from "../repositories/identityTransaction.js";
import { SqlitePlatformBootstrapTransaction } from "../repositories/platformBootstrapTransaction.js";
import { createIdentityRouter } from "../routes/identity.js";
import { RegistrationService } from "../identity/services/registrationService.js";
import { ResendEmailVerificationService } from "../identity/services/resendEmailVerificationService.js";
import { VerifyEmailService } from "../identity/services/verifyEmailService.js";
import { InMemoryVerificationDelivery } from "../identity/infrastructure/testingAdapters.js";

const secret = "bootstrap-secret-that-is-longer-than-thirty-two-characters";

function setup() {
  const database = createDatabase(":memory:");
  const random = new SecureRandomProvider();
  const clock = new SystemClock();
  const sessionIdentifiers = new Sha256SessionIdentifierProvider();
  const delivery = new InMemoryVerificationDelivery();
  const authentication = new AuthenticationService(new SqliteAuthenticationTransaction(database), random, new Sha256CredentialEnrollmentHashProvider(), new ScryptPasswordProvider(), sessionIdentifiers, clock, { async deliver() { return "accepted" as const; } }, "http://atlas.test", false);
  const bootstrap = new PlatformBootstrapService(new SqlitePlatformBootstrapTransaction(database), random, new ScryptPasswordProvider(), sessionIdentifiers, clock, secret);
  return { database, authentication, bootstrap, random, clock, delivery };
}

test("platform bootstrap atomically creates the first verified owner, selected default workspace, credential, and session", async () => {
  const { database, authentication, bootstrap } = setup();
  assert.equal(bootstrap.initialized(), false);
  const result = await bootstrap.bootstrap({ email: "owner@example.com", locale: "es", password: "frase inicial muy segura", confirmation: "frase inicial muy segura", setupSecret: secret });
  assert.equal(bootstrap.initialized(), true);
  assert.equal(authentication.current(result.rawSessionIdentifier)?.email, "owner@example.com");
  assert.equal((database.prepare("SELECT status FROM users").get() as { status: string }).status, "active");
  assert.equal((database.prepare("SELECT email_verified FROM authentication_identities").get() as { email_verified: number }).email_verified, 1);
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM password_credentials WHERE state='active'").get() as { count: number }).count, 1);
  assert.equal((database.prepare("SELECT role FROM memberships").get() as { role: string }).role, "owner");
  assert.equal((database.prepare("SELECT workspace_id FROM workspace_selections").get() as { workspace_id: number }).workspace_id, (database.prepare("SELECT id FROM workspaces WHERE key='default'").get() as { id: number }).id);
  assert.equal((database.prepare("SELECT claimed_by_user_id FROM platform_bootstrap").get() as { claimed_by_user_id: string }).claimed_by_user_id.startsWith("usr_"), true);
  database.close();
});

test("platform bootstrap rejects a second attempt and creates no additional state", async () => {
  const { database, bootstrap } = setup();
  const input = { email: "owner@example.com", locale: "en", password: "first administrator password", confirmation: "first administrator password", setupSecret: secret };
  await bootstrap.bootstrap(input);
  await assert.rejects(() => bootstrap.bootstrap({ ...input, email: "second@example.com" }), PlatformBootstrapConflict);
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count, 1);
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM memberships").get() as { count: number }).count, 1);
  database.close();
});

test("platform bootstrap rejects an invalid setup secret without creating a user", async () => {
  const { database, bootstrap } = setup();
  await assert.rejects(() => bootstrap.bootstrap({ email: "owner@example.com", locale: "en", password: "first administrator password", confirmation: "first administrator password", setupSecret: "incorrect" }));
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count, 0);
  database.close();
});

test("concurrent platform bootstrap attempts across SQLite connections produce exactly one owner", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-bootstrap-"));
  const path = join(directory, "atlas.sqlite");
  const firstDatabase = createDatabase(path);
  const secondDatabase = createDatabase(path);
  try {
    const createService = (database: ReturnType<typeof createDatabase>) => new PlatformBootstrapService(new SqlitePlatformBootstrapTransaction(database), new SecureRandomProvider(), new ScryptPasswordProvider(), new Sha256SessionIdentifierProvider(), new SystemClock(), secret);
    const first = createService(firstDatabase);
    const second = createService(secondDatabase);
    const input = { email: "owner@example.com", locale: "en", password: "first administrator password", confirmation: "first administrator password", setupSecret: secret };
    const outcomes = await Promise.allSettled([first.bootstrap(input), second.bootstrap(input)]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal((firstDatabase.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count, 1);
    assert.equal((firstDatabase.prepare("SELECT COUNT(*) AS count FROM memberships WHERE role='owner' AND status='active'").get() as { count: number }).count, 1);
  } finally {
    firstDatabase.close();
    secondDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bootstrap status and creation endpoint expose only initialized state and issue an authenticated cookie", async () => {
  const { database, authentication, bootstrap, random, clock, delivery } = setup();
  const identity = new SqliteIdentityTransaction(database);
  const registration = new RegistrationService(identity, random, new Sha256VerificationHashProvider(), clock, delivery, "http://atlas.test", 3_600_000);
  const resend = new ResendEmailVerificationService(identity, random, new Sha256VerificationHashProvider(), clock, delivery, "http://atlas.test", 3_600_000, 60_000);
  const verify = new VerifyEmailService(identity, new Sha256VerificationHashProvider(), clock);
  const app = express();
  app.use(express.json());
  app.use("/identity", createIdentityRouter({ register: createRegistrationController(registration), resend: createResendVerificationController(resend), verify: createVerifyEmailController(verify), ...createAuthenticationControllers(authentication, new ExactRequestOriginPolicy(["http://atlas.test"], false)), bootstrapStatus: createPlatformBootstrapControllers(bootstrap, authentication).status, platformBootstrap: createPlatformBootstrapControllers(bootstrap, authentication).bootstrap }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/identity`;
  try {
    assert.deepEqual(await (await fetch(`${url}/bootstrap/status`)).json(), { initialized: false });
    const created = await fetch(`${url}/bootstrap`, { method: "POST", headers: { "content-type": "application/json", "x-atlas-bootstrap-secret": secret }, body: JSON.stringify({ email: "owner@example.com", locale: "en", password: "first administrator password", confirmation: "first administrator password" }) });
    assert.equal(created.status, 201);
    assert.ok(created.headers.get("set-cookie")?.includes("atlas_dev_session="));
    assert.deepEqual(await (await fetch(`${url}/bootstrap/status`)).json(), { initialized: true });
    assert.equal((await fetch(`${url}/bootstrap`, { method: "POST", headers: { "content-type": "application/json", "x-atlas-bootstrap-secret": secret }, body: JSON.stringify({ email: "second@example.com", locale: "en", password: "second administrator password", confirmation: "second administrator password" }) })).status, 409);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    database.close();
  }
});
