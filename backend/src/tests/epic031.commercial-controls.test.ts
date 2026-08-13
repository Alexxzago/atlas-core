import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import { test } from "node:test";
import { runMigrations } from "../config/migrations.js";
import { createWhatsAppWebhookControllers } from "../controllers/WhatsAppWebhookController.js";
import { CommercialControlsRepository } from "../repositories/commercialControlsRepository.js";
import { reconstructUser, type UserId } from "../identity/domain/user.js";
import { UserRepository } from "../repositories/userRepository.js";
import { SqliteWorkspaceAdministrationTransaction } from "../repositories/workspaceAdministrationTransaction.js";
import { WorkspaceAdministrationError, WorkspaceAdministrationService } from "../workspace/services/workspaceAdministrationService.js";
import { invitationRole } from "../workspace/domain/invitation.js";
import { WhatsAppWebhookService } from "../whatsapp/services/WhatsAppWebhookService.js";

const at = "2026-01-01T00:00:00.000Z";
function database(): DatabaseSync { const db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON"); runMigrations(db); return db; }
function workspace(db: DatabaseSync): number { return (db.prepare("SELECT id FROM workspaces WHERE key='default'").get() as { id: number }).id; }
function company(db: DatabaseSync, name = "Company"): number { const id = workspace(db); db.prepare("INSERT INTO companies(workspace_id,name,website,phone,email,status,slug,name_normalized,lifecycle_state,brand_colors_json,version,created_at,updated_at,lifecycle_changed_at) VALUES(?,?,?,?,?,'ready',?,?, 'operational','{}',1,?,?,?)").run(id, name, `https://${name}.test`, "", "", name.toLowerCase(), name.toLowerCase(), at, at, at); return Number((db.prepare("SELECT last_insert_rowid() id").get() as { id: number }).id); }
function profile(db: DatabaseSync, companyId: number, id = "asp_00000000000000000000000000000000"): void { db.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at) VALUES(?,?,'Assistant',?,'friendly','en','Fallback','ready',?,?)").run(id, companyId, id, at, at); }
function user(db: DatabaseSync, id: string): void { new UserRepository(db).create(reconstructUser({ id, status: "active", locale: "en", authenticationIdentities: [{ id: `aid_${id}`, email: `${id}@example.test`, normalizedEmail: `${id}@example.test`, emailVerified: true, createdAt: at, updatedAt: at }], createdAt: at, updatedAt: at })); }
function administration(db: DatabaseSync): WorkspaceAdministrationService { return new WorkspaceAdministrationService(new SqliteWorkspaceAdministrationTransaction(db), { create: () => ({ raw: "proof", digest: "digest", version: "sha256-v1" }), parse: () => null } as never, { now: () => at }, { deliver: async () => "accepted" } as never, "https://atlas.test"); }
function namedWorkspace(db: DatabaseSync, key: string): number { db.prepare("INSERT INTO workspaces(key,name,public_id,created_at) VALUES(?,?,?,?)").run(key, key, `wsp_${key}`, at); return Number((db.prepare("SELECT last_insert_rowid() id").get() as { id: number }).id); }
function membership(db: DatabaseSync, id: string, workspaceId: number, userId: string, role: "owner" | "viewer"): void { db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES(?,?,?,?,'active',1,?,?)").run(id, workspaceId, userId, role, at, at); }

test("EPIC-031 commercial rows are nullable where documented and missing rows fail closed after migration", () => {
  const db = database(), controls = new CommercialControlsRepository(db), id = workspace(db);
  db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('user','active','en',?,?)").run(at, at);
  assert.equal(controls.user("user")?.maxOwnedWorkspaces, 1);
  assert.equal(controls.ownedWorkspaceLimit("user"), 1);
  db.prepare("DELETE FROM user_commercial_controls WHERE user_id='user'").run();
  assert.equal(controls.ownedWorkspaceLimit("user"), 0);
  db.prepare("DELETE FROM workspace_commercial_controls WHERE workspace_id=?").run(id);
  assert.equal(controls.isWorkspaceActive(id), false);
  assert.throws(() => company(db));
  db.close();
});

test("EPIC-031 commercial schema enforces status timestamps, closed audit events, live capacity, and restore capacity", () => {
  const db = database(), controls = new CommercialControlsRepository(db), id = workspace(db), first = company(db, "First"); profile(db, first); db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('actor','active','en',?,?)").run(at, at);
  assert.throws(() => db.prepare("UPDATE workspace_commercial_controls SET status='suspended',suspended_at=NULL WHERE workspace_id=?").run(id));
  assert.throws(() => db.prepare("INSERT INTO commercial_control_audit_events VALUES('a','missing','workspace','1','unknown','{}','{}',1,?)").run(at));
  const current = controls.workspace(id)!;
  assert.ok(controls.updateWorkspaceLimits("actor", id, { maxCompanies: 1, maxAssistantProfiles: 1, maxActiveChannels: null }, current.version, at));
  assert.throws(() => company(db, "Second"));
  db.prepare("UPDATE companies SET lifecycle_state='archived',archived_at=? WHERE id=?").run(at, first);
  assert.doesNotThrow(() => company(db, "Second"));
  assert.throws(() => db.prepare("UPDATE companies SET lifecycle_state='operational',archived_at=NULL WHERE id=?").run(first));
  db.prepare("UPDATE assistant_profiles SET status='archived',archived_at=? WHERE company_id=?").run(at, first);
  const second = Number((db.prepare("SELECT id FROM companies WHERE name='Second'").get() as { id: number }).id); profile(db, second, "asp_10000000000000000000000000000000");
  assert.throws(() => db.prepare("UPDATE assistant_profiles SET status='ready',archived_at=NULL WHERE company_id=?").run(first));
  db.close();
});

test("EPIC-031 rejects lower limits below live usage and rolls back the control update if audit persistence fails", () => {
  const db = database(), controls = new CommercialControlsRepository(db), id = workspace(db); company(db);
  const current = controls.workspace(id)!;
  assert.equal(controls.updateWorkspaceLimits("actor", id, { maxCompanies: 0 as never, maxAssistantProfiles: null, maxActiveChannels: null }, current.version, at), null);
  db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('actor','active','en',?,?)").run(at, at);
  db.exec("CREATE TRIGGER audit_failure BEFORE INSERT ON commercial_control_audit_events BEGIN SELECT RAISE(ABORT,'fault'); END");
  assert.throws(() => controls.setWorkspaceStatus("actor", id, "suspended", current.version, at));
  assert.equal(controls.workspace(id)?.status, "active");
  assert.equal(controls.workspace(id)?.version, current.version);
  db.close();
});

test("EPIC-031 rejects a finite user allowance below current ownership without audit and permits unlimited ownership", () => {
  const db = database(), controls = new CommercialControlsRepository(db); user(db, "actor"); user(db, "target");
  db.prepare("INSERT INTO workspaces(key,name,created_at) VALUES('owned-a','Owned A',?)").run(at); const first = Number((db.prepare("SELECT last_insert_rowid() id").get() as { id: number }).id);
  db.prepare("INSERT INTO workspaces(key,name,created_at) VALUES('owned-b','Owned B',?)").run(at); const second = Number((db.prepare("SELECT last_insert_rowid() id").get() as { id: number }).id);
  for (const [workspaceId, id] of [[first, "mem_a"], [second, "mem_b"]] as const) db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES(?,?,?,'owner','active',1,?,?)").run(id, workspaceId, "target", at, at);
  const current = controls.user("target")!;
  assert.equal(controls.updateUser("actor", "target", 1, current.version, at), null);
  assert.equal(controls.user("target")?.version, current.version);
  assert.equal(controls.audit("user", "target").length, 0);
  const unlimited = controls.updateUser("actor", "target", null, current.version, at);
  assert.equal(unlimited?.maxOwnedWorkspaces, null);
  assert.equal(controls.ownedWorkspaceLimit("target"), Number.MAX_SAFE_INTEGER);
  db.close();
});

test("EPIC-031 persists an unlimited user allowance that permits a normal user to own multiple workspaces", () => {
  const db = database(), controls = new CommercialControlsRepository(db), service = administration(db); user(db, "normal");
  const current = controls.user("normal")!;
  assert.equal(controls.updateUser("normal", "normal", null, current.version, at)?.maxOwnedWorkspaces, null);
  assert.doesNotThrow(() => service.createWorkspace("normal" as UserId, "First workspace"));
  assert.doesNotThrow(() => service.createWorkspace("normal" as UserId, "Second workspace"));
  assert.equal(controls.ownedWorkspaceCount("normal"), 2);
  db.close();
});

test("EPIC-031 changeMembership owner promotion enforces available, exhausted, bypassed, and revoked allowances", () => {
  const db = database(), service = administration(db); user(db, "owner"); user(db, "target");
  const first = namedWorkspace(db, "promotion-a"), second = namedWorkspace(db, "promotion-b"), third = namedWorkspace(db, "promotion-c");
  membership(db, "owner-a", first, "owner", "owner"); membership(db, "owner-b", second, "owner", "owner"); membership(db, "owner-c", third, "owner", "owner");
  membership(db, "target-a", first, "target", "viewer"); membership(db, "target-b", second, "target", "viewer"); membership(db, "target-c", third, "target", "viewer");
  const firstPublicId = String((db.prepare("SELECT public_id FROM workspaces WHERE id=?").get(first) as { public_id: string }).public_id), secondPublicId = String((db.prepare("SELECT public_id FROM workspaces WHERE id=?").get(second) as { public_id: string }).public_id), thirdPublicId = String((db.prepare("SELECT public_id FROM workspaces WHERE id=?").get(third) as { public_id: string }).public_id);
  assert.doesNotThrow(() => service.changeMembership("owner" as UserId, firstPublicId, "target-a", "role", "owner"));
  assert.throws(() => service.changeMembership("owner" as UserId, secondPublicId, "target-b", "role", "owner"), WorkspaceAdministrationError);
  db.prepare("INSERT INTO platform_administrators(user_id,status,granted_at,granted_by_user_id,revoked_at) VALUES('target','active',?,NULL,NULL)").run(at);
  assert.doesNotThrow(() => service.changeMembership("owner" as UserId, secondPublicId, "target-b", "role", "owner"));
  db.prepare("UPDATE platform_administrators SET status='revoked',revoked_at=? WHERE user_id='target'").run(at);
  assert.throws(() => service.changeMembership("owner" as UserId, thirdPublicId, "target-c", "role", "owner"), WorkspaceAdministrationError);
  assert.throws(() => invitationRole("owner"));
  db.close();
});

test("EPIC-031 Company restores require active controls and available capacity", () => {
  const restore = (configure: (db: DatabaseSync, id: number, archived: number) => void, allowed: boolean): void => { const db = database(), controls = new CommercialControlsRepository(db), id = workspace(db); user(db, "actor"); const archived = company(db, `Archived${Math.random()}`); db.prepare("UPDATE companies SET lifecycle_state='archived',archived_at=? WHERE id=?").run(at, archived); configure(db, id, archived); if (allowed) assert.doesNotThrow(() => db.prepare("UPDATE companies SET lifecycle_state='operational',archived_at=NULL WHERE id=?").run(archived)); else assert.throws(() => db.prepare("UPDATE companies SET lifecycle_state='operational',archived_at=NULL WHERE id=?").run(archived)); db.close(); };
  restore(() => {}, true);
  restore((db, id) => { const controls = new CommercialControlsRepository(db), current = controls.workspace(id)!; assert.ok(controls.updateWorkspaceLimits("actor", id, { maxCompanies: 1, maxAssistantProfiles: null, maxActiveChannels: null }, current.version, at)); company(db, `Live${Math.random()}`); }, false);
  restore((db, id) => { db.prepare("DELETE FROM workspace_commercial_controls WHERE workspace_id=?").run(id); }, false);
  restore((db, id) => { db.prepare("UPDATE workspace_commercial_controls SET status='suspended',suspended_at=? WHERE workspace_id=?").run(at, id); }, false);
});

test("EPIC-031 Assistant Profile restores require active controls and available capacity", () => {
  const restore = (configure: (db: DatabaseSync, id: number, companyId: number) => void, allowed: boolean): void => { const db = database(), id = workspace(db); user(db, "actor"); const companyId = company(db, `Profile${Math.random()}`), archivedId = `asp_${Math.random().toString().slice(2).padEnd(32, "0").slice(0, 32)}`; profile(db, companyId, archivedId); db.prepare("UPDATE assistant_profiles SET status='archived',archived_at=? WHERE id=?").run(at, archivedId); configure(db, id, companyId); if (allowed) assert.doesNotThrow(() => db.prepare("UPDATE assistant_profiles SET status='ready',archived_at=NULL WHERE id=?").run(archivedId)); else assert.throws(() => db.prepare("UPDATE assistant_profiles SET status='ready',archived_at=NULL WHERE id=?").run(archivedId)); db.close(); };
  restore(() => {}, true);
  restore((db, id, companyId) => { const controls = new CommercialControlsRepository(db), current = controls.workspace(id)!; assert.ok(controls.updateWorkspaceLimits("actor", id, { maxCompanies: null, maxAssistantProfiles: 1, maxActiveChannels: null }, current.version, at)); profile(db, companyId, "asp_11111111111111111111111111111111"); }, false);
  restore((db, id) => { db.prepare("DELETE FROM workspace_commercial_controls WHERE workspace_id=?").run(id); }, false);
  restore((db, id) => { db.prepare("UPDATE workspace_commercial_controls SET status='suspended',suspended_at=? WHERE workspace_id=?").run(at, id); }, false);
});

test("EPIC-031 suspended WhatsApp webhooks acknowledge with no operations and retain queued recovery", async () => {
  const raw = Buffer.from(JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "phone" }, messages: [{ type: "text", from: "wa", id: "wamid", text: { body: "Hello" } }] } }] }] }));
  let captures = 0, released = 0;
  const request = { id: "cex_00000000000000000000000000000000", snapshot: { whatsAppConnectionId: "wac_00000000000000000000000000000000" } };
  const service = new WhatsAppWebhookService({ appSecret: "secret", verifyToken: "verify" }, { resolveActiveByPhoneNumberId: () => null, resolveForRecovery: () => null } as never, {} as never, { captureInboundExecution: () => { captures += 1; throw new Error("must not capture"); }, leaseExecutionRequests: () => [request], releaseExecutionRequest: () => { released += 1; return null; } } as never, {} as never, {} as never);
  const app = express(); app.post("/webhooks/whatsapp", express.raw({ type: "*/*" }), createWhatsAppWebhookControllers(service).receive);
  const listener = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => listener.once("listening", resolve));
  try { const port = (listener.address() as { port: number }).port, signature = `sha256=${createHmac("sha256", "secret").update(raw).digest("hex")}`, response = await fetch(`http://127.0.0.1:${port}/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body: raw }); assert.equal(response.status, 200); await service.resumeIncomplete(); assert.equal(captures, 0); assert.equal(released, 1); } finally { listener.close(); }
});
