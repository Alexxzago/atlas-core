import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createDatabase } from "../config/database.js";
import { encodeConversationEventFeedCursor } from "../conversation/domain/conversationEventFeed.js";
import { conversationId, reconstructConversation } from "../conversation/domain/conversation.js";
import { ConversationEventFeedService } from "../conversation/services/conversationEventFeedService.js";
import { ConversationService } from "../conversation/services/conversationService.js";
import { createConversationEventFeedController } from "../controllers/conversationEventFeedController.js";
import { createGetConversationController, createListConversationController } from "../controllers/conversationReadController.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

const at = "2026-08-26T12:00:00.000Z";

function fixture() {
  const database = createDatabase(":memory:"), workspaces = new WorkspaceRepository(database), primary = createWorkspaceContext(workspaces.resolveDefault()), secondary = createWorkspaceContext(workspaces.createForSystemUse({ key: "secondary", name: "Secondary" }));
  const companies = new CompanyRepository(database), company = companies.create(primary, { name: "Primary", website: "https://primary.test" }), other = companies.create(primary, { name: "Other", website: "https://other.test" }), foreign = companies.create(secondary, { name: "Foreign", website: "https://foreign.test" });
  const repository = new ConversationRepository(database), id = conversationId("cnv_0123456789abcdef0123456789abcdef");
  repository.createConversation(primary, reconstructConversation({ id, companyId: company.id, channel: "internal", state: "open", createdAt: at, updatedAt: at, closedAt: null }));
  const insert = (name: string, occurredAt: string, actor = "raw-operator-secret") => database.prepare("INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,actor_user_id,control_version,authority_generation,related_message_id,related_operation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(`cev_${name}`, primary.workspaceId, company.id, id, "operator_message_created", actor, 7, 11, null, null, occurredAt);
  const reads = new ConversationService(repository, { now: () => at }), feed = new ConversationEventFeedService(repository);
  const app = express();
  app.use(express.json());
  app.use("/workspaces", createAuthorizedCompaniesRouter({
    authentication: { cookieName: () => "atlas", current: (raw: string) => raw === "missing" ? null : { userId: raw }, validateCsrf: () => true } as never,
    users: { findById: (idValue: string) => idValue === "deleted" ? null : { id: idValue, status: idValue === "inactive" ? "suspended" : "active" } } as never,
    authorization: { authorize: (user: { id: string; status: string }, workspace: string, permission: string) => { if (user.status !== "active" || user.id === "suspended-member" || user.id === "viewer" || permission !== "company:read") throw new Error("denied"); const context = workspace === "wsp_primary" ? primary : workspace === "wsp_secondary" ? secondary : null; if (!context) throw new Error("denied"); return { userId: user.id, membershipId: "membership", role: "operator", capabilities: new Set([permission]), workspaceId: context.workspaceId, workspacePublicId: workspace, permission }; } } as never,
    resolver: { resolve: (decision: { workspaceId: number }) => decision.workspaceId === primary.workspaceId ? primary : secondary } as never,
    controllers: {} as never, assistantControllers: {} as never,
    conversationReadControllers: { list: (context, actor) => createListConversationController(reads, context, actor), get: (context, actor) => createGetConversationController(reads, context, actor), feed: (context) => createConversationEventFeedController(feed, context) },
  }));
  return { database, primary, secondary, company, other, foreign, repository, id, insert, app };
}

async function server(value: ReturnType<typeof fixture>) {
  const listener = value.app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => listener.once("listening", resolve));
  const origin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`, url = (companyId = value.company.id, query = "") => `${origin}/workspaces/wsp_primary/companies/${companyId}/conversations/feed${query}`;
  return { origin, url, headers: (actor = "reader") => ({ cookie: `atlas=${actor}` }), close: async () => { await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve())); value.database.close(); } };
}

test("EPIC043 PASS6B repository reads a tenant event feed strictly by durable sequence", () => {
  const value = fixture();
  try {
    value.insert("first", "2026-08-26T12:03:00.000Z"); value.insert("second", "2026-08-26T12:01:00.000Z"); value.insert("third", "2026-08-26T12:02:00.000Z");
    const rows = value.repository.listConversationEventsAfter(value.primary, value.company.id, 0, 10);
    assert.deepEqual(rows.map((row) => [row.eventId, row.occurredAt]), [["cev_first", "2026-08-26T12:03:00.000Z"], ["cev_second", "2026-08-26T12:01:00.000Z"], ["cev_third", "2026-08-26T12:02:00.000Z"]]);
    assert.equal(value.repository.conversationEventTail(value.primary, value.company.id), rows[2]!.sequence);
    assert.equal(value.repository.conversationEventTail(value.secondary, value.foreign.id), 0);
    assert.deepEqual(value.repository.listConversationEventsAfter(value.primary, value.other.id, 0, 10), []);
  } finally { value.database.close(); }
});

test("EPIC043 PASS6B HTTP feed bootstraps losslessly, pages safely, and resyncs invalid cursors", async () => {
  const value = fixture(), http = await server(value);
  try {
    value.insert("first", "2026-08-26T12:03:00.000Z"); value.insert("second", "2026-08-26T12:01:00.000Z");
    const bootstrap = await fetch(http.url(), { headers: http.headers() });
    assert.equal(bootstrap.status, 200); assert.equal(bootstrap.headers.get("cache-control"), "no-store, private"); assert.equal(bootstrap.headers.get("pragma"), "no-cache");
    const initial = await bootstrap.json() as { events: unknown[]; nextCursor: string; hasMore: boolean; resyncRequired: boolean };
    assert.deepEqual([initial.events, initial.hasMore, initial.resyncRequired], [[], false, false]);
    value.insert("after-bootstrap", "2026-08-26T12:00:00.000Z");
    assert.equal((await fetch(`${http.origin}/workspaces/wsp_primary/companies/${value.company.id}/conversations`, { headers: http.headers() })).status, 200);
    const lossless = await fetch(http.url(undefined, `?after=${encodeURIComponent(initial.nextCursor)}`), { headers: http.headers() });
    const losslessStatus = lossless.status, losslessBody = await lossless.json() as { events: Array<{ eventId: string }>; hasMore: boolean; resyncRequired: boolean };
    assert.equal(losslessStatus, 200); assert.deepEqual(losslessBody.events.map((event) => event.eventId), ["cev_after-bootstrap"]); assert.equal(losslessBody.hasMore, false); assert.equal(losslessBody.resyncRequired, false);

    const pageStart = losslessBody.events.length === 1 ? (await (await fetch(http.url(), { headers: http.headers() })).json() as { nextCursor: string }).nextCursor : "";
    for (let index = 0; index < 30; index += 1) value.insert(`page-${index}`, `2026-08-26T12:${String(30 - index).padStart(2, "0")}:00.000Z`);
    const firstPage = await fetch(http.url(undefined, `?after=${encodeURIComponent(pageStart)}`), { headers: http.headers() });
    const firstStatus = firstPage.status, first = await firstPage.json() as { events: Array<{ eventId: string }>; nextCursor: string; hasMore: boolean; resyncRequired: boolean };
    assert.equal(firstStatus, 200); assert.equal(first.events.length, 25); assert.equal(first.hasMore, true); assert.equal(first.resyncRequired, false); assert.deepEqual(first.events.map((event) => event.eventId), Array.from({ length: 25 }, (_value, index) => `cev_page-${index}`));
    const second = await (await fetch(http.url(undefined, `?after=${encodeURIComponent(first.nextCursor)}`), { headers: http.headers() })).json() as { events: Array<{ eventId: string }>; hasMore: boolean };
    assert.deepEqual(second.events.map((event) => event.eventId), Array.from({ length: 5 }, (_value, index) => `cev_page-${index + 25}`)); assert.equal(second.hasMore, false);
    assert.equal((await fetch(http.url(undefined, "?limit=100"), { headers: http.headers() })).status, 200);
    assert.equal((await fetch(http.url(undefined, "?limit=101"), { headers: http.headers() })).status, 400);
    assert.equal((await fetch(http.url(undefined, "?limit=zero"), { headers: http.headers() })).status, 400);

    const invalid = ["not-a-cursor", "@@@", Buffer.from("not-json").toString("base64url"), encodeConversationEventFeedCursor({ v: 1, w: value.primary.workspaceId, c: value.company.id, s: -1 } as never), Buffer.from(JSON.stringify({ v: 2, w: value.primary.workspaceId, c: value.company.id, s: 0 })).toString("base64url"), encodeConversationEventFeedCursor({ v: 1, w: value.primary.workspaceId, c: value.other.id, s: 0 }), encodeConversationEventFeedCursor({ v: 1, w: value.secondary.workspaceId, c: value.company.id, s: 0 }), encodeConversationEventFeedCursor({ v: 1, w: value.primary.workspaceId, c: value.company.id, s: 999_999 })];
    for (const after of invalid) { const response = await fetch(http.url(undefined, `?after=${encodeURIComponent(after)}`), { headers: http.headers() }); const body = await response.json() as { events: unknown[]; nextCursor: string; hasMore: boolean; resyncRequired: boolean }; assert.equal(response.status, 200); assert.deepEqual([body.events, body.hasMore, body.resyncRequired], [[], false, true]); assert.equal(typeof body.nextCursor, "string"); }
    const projection = JSON.stringify(first);
    for (const forbidden of ["sequence", "actor_user_id", "raw-operator-secret", "message content", "phone", "waId", "provider payload", "credential", "token", "metadata", "secret"]) assert.equal(projection.includes(forbidden), false);
  } finally { await http.close(); }
});

test("EPIC043 PASS6B feed authorization, scope, and replays remain safe", async () => {
  const value = fixture(), http = await server(value);
  try {
    value.insert("event", at);
    for (const actor of ["missing", "inactive", "suspended-member", "viewer"] as const) { const response = await fetch(http.url(), { headers: http.headers(actor) }); assert.equal(response.status, 404); assert.equal(response.headers.get("cache-control"), "no-store, private"); }
    assert.equal((await fetch(http.url(value.foreign.id), { headers: http.headers() })).status, 404);
    assert.equal((await fetch(`${http.origin}/workspaces/wsp_secondary/companies/${value.company.id}/conversations/feed`, { headers: http.headers() })).status, 404);
    const command = { operationId: "replay-compatible", operation: "takeover" as const, actorId: "operator-1" as never, expectedVersion: 1, occurredAt: at };
    const before = value.repository.conversationEventTail(value.primary, value.company.id); value.repository.applyConversationControlOperation(value.primary, value.company.id, value.id, command); value.repository.applyConversationControlOperation(value.primary, value.company.id, value.id, command);
    const after = value.repository.conversationEventTail(value.primary, value.company.id); assert.equal(after, before + 1);
    value.database.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("asp_feed", value.company.id, "Feed", "feed", "friendly", "en", "Fallback", "ready", at, at, null);
    value.database.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run("wac_feed", value.primary.workspaceId, value.company.id, "asp_feed", "phone-secret", "wa-secret", "active", at, at);
    const operatorFirst = value.repository.persistOperatorMessage(value.primary, value.company.id, value.id, "operator-1" as never, "private message content", "feed-replay", "wac_feed", at);
    const operatorReplay = value.repository.persistOperatorMessage(value.primary, value.company.id, value.id, "operator-1" as never, "private message content", "feed-replay", "wac_feed", at);
    assert.deepEqual([operatorFirst.kind, operatorReplay.kind], ["created", "replayed"]);
    assert.deepEqual(value.repository.listConversationEventsAfter(value.primary, value.company.id, after, 10).map((event) => event.type), ["operator_message_created"]);
  } finally { await http.close(); }
});
