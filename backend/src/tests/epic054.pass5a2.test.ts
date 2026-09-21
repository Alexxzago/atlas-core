import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runFreshAsyncMigrations } from "../config/asyncMigrations.js";
import { LocalSqlDatabase, type SqlDatabase } from "../config/sqlDatabase.js";
import { createAsyncWorkspaceCompanyPersistence } from "../company/infrastructure/asyncCompanyFactory.js";
import { createCompany, updateCompanyBranding, type Company } from "../company/domain/company.js";
import type { CompanyEvent } from "../company/application/ports.js";
import type { Membership } from "../workspace/domain/membership.js";

const at = "2026-09-17T10:00:00.000Z";
function event(company: Company, id: string, type: CompanyEvent["type"] = "CompanyCreated"): CompanyEvent { return { id, type, aggregateVersion: company.version, sequence: 1, occurredAt: company.updatedAt, actorId: null, payload: { companyId: company.id } }; }

test("EPIC054 PASS5A2B awaits delayed Workspace membership, invitation, and selection operations", async () => {
  const underlying = new LocalSqlDatabase(new DatabaseSync(":memory:"));
  const events: string[] = [];
  const database: SqlDatabase = {
    execute: (sql, args) => underlying.execute(sql, args),
    executeScript: (script) => underlying.executeScript(script),
    query: async (sql, args) => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      events.push("workspace-query");
      return underlying.query(sql, args);
    },
    transaction: (operation) => underlying.transaction(() => operation(database)),
    close: () => underlying.close(),
  };
  try {
    await runFreshAsyncMigrations(database);
    events.length = 0;
    await database.execute("INSERT INTO users(id,status,full_name,locale,created_at,updated_at) VALUES(?,?,?,?,?,?)", ["usr-pass5a2b","active",null,"en",at,at]);
    const { memberships, invitations, selections } = createAsyncWorkspaceCompanyPersistence(database);
    const turn = new Promise<void>((resolve) => setImmediate(() => { events.push("event-loop"); resolve(); }));
    const missing = await memberships.findCurrent("usr-pass5a2b" as never, 1);
    await turn;
    assert.equal(missing, null);
    assert.deepEqual(events, ["event-loop", "workspace-query"]);
    const member: Membership = { id:"mem-pass5a2b" as never,workspaceId:1,userId:"usr-pass5a2b" as never,role:"owner",status:"active",version:1,createdAt:at,activatedAt:at,suspendedAt:null,reactivatedAt:null,removedAt:null,roleChangedAt:null };
    await database.transaction(async transaction => {
      const transactional = createAsyncWorkspaceCompanyPersistence(transaction);
      await transactional.memberships.create(member);
      await transactional.selections.save(member.userId, 1, at);
      await transactional.invitations.create({ id:"inv-pass5a2b",workspaceId:1,issuerMembershipId:member.id,issuerUserId:member.userId,recipient:"invitee@example.test" as never,proposedRole:"viewer",purpose:"workspace_invitation",digestVersion:"sha256-v1",proofDigest:"digest-pass5a2b",status:"pending",deliveryStatus:"pending",version:1,issuedAt:at,expiresAt:"2026-09-24T10:00:00.000Z",acceptedAt:null,acceptedByUserId:null,acceptedIp:null,acceptedUserAgent:null,rejectedAt:null,revokedAt:null,supersededAt:null,updatedAt:at });
    });
    assert.equal((await selections.find(member.userId)), 1);
    const invitation = await invitations.findById("inv-pass5a2b");
    assert.ok(invitation);
    assert.equal(await invitations.update({ ...invitation, status:"revoked",revokedAt:at,updatedAt:at }, 1), true);
    assert.equal(await invitations.update({ ...invitation, status:"accepted",acceptedAt:at,updatedAt:at }, 1), false);
  } finally {
    await database.close();
  }
});

test("EPIC054 PASS5A2B preserves async Company transaction, CAS, and event append behavior", async () => {
  const underlying = new LocalSqlDatabase(new DatabaseSync(":memory:"));
  const events: string[] = [];
  const database: SqlDatabase = {
    execute: (sql, args) => underlying.execute(sql, args),
    executeScript: (script) => underlying.executeScript(script),
    query: async (sql, args) => { await new Promise<void>((resolve) => setImmediate(resolve)); events.push("company-query"); return underlying.query(sql, args); },
    transaction: (operation) => underlying.transaction(() => operation(database)),
    close: () => underlying.close(),
  };
  try {
    await runFreshAsyncMigrations(database);
    const { companies } = createAsyncWorkspaceCompanyPersistence(database);
    const created = createCompany({ id:5402,workspaceId:1,identity:{ name:"Async Atlas",slug:"async-atlas",website:"https://async-atlas.test" },createdAt:at });
    events.length = 0;
    const turn = new Promise<void>((resolve) => setImmediate(() => { events.push("event-loop"); resolve(); }));
    assert.equal((await companies.createWithEvents({ workspaceId:1,workspaceKey:"default" }, created, [event(created,"evt-pass5a2b-created")])).status, "created");
    await turn;
    assert.equal(events[0], "event-loop");
    const updated = updateCompanyBranding(created, { publicName:"Async Atlas Realty" }, "2026-09-17T11:00:00.000Z");
    assert.equal((await companies.saveWithEvents({ workspaceId:1,workspaceKey:"default" }, updated, 1, [event(updated,"evt-pass5a2b-updated","CompanyBrandingUpdated")])).status, "saved");
    assert.equal((await companies.saveWithEvents({ workspaceId:1,workspaceKey:"default" }, updated, 1, [event(updated,"evt-pass5a2b-stale","CompanyBrandingUpdated")])).status, "version_conflict");
    assert.deepEqual(await database.query("SELECT aggregate_version,event_sequence FROM company_events WHERE company_id=? ORDER BY aggregate_version,event_sequence", [created.id]), [{ aggregate_version:1,event_sequence:1 },{ aggregate_version:2,event_sequence:1 }]);
  } finally {
    await database.close();
  }
});
