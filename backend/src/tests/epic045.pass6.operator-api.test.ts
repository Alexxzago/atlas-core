import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Router } from "express";
import { createApp } from "../app.js";
import { createDatabase } from "../config/database.js";
import { createProactiveActionControllers } from "../controllers/proactiveActionController.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { ProactiveActionRepository } from "../repositories/proactiveActionRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { ProactiveActionOperatorService } from "../proactive/services/proactiveActionOperatorService.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { conversationId, conversationParticipantId, reconstructConversation, reconstructConversationMessage, reconstructConversationParticipant } from "../conversation/domain/conversation.js";

const at = "2026-08-31T18:00:00.000Z";
function fixture() {
  const database = createDatabase(":memory:"), workspaces = new WorkspaceRepository(database), primary = createWorkspaceContext(workspaces.resolveDefault()), secondary = createWorkspaceContext(workspaces.createForSystemUse({ key: "secondary", name: "Secondary" })), companies = new CompanyRepository(database), company = companies.create(primary, { name: "Proactive", website: "https://proactive.test" }), other = companies.create(primary, { name: "Other", website: "https://other.test" }), foreign = companies.create(secondary, { name: "Foreign", website: "https://foreign.test" }), conversations = new ConversationRepository(database);
  const conversation = conversations.createConversation(primary, reconstructConversation({ id: conversationId("cnv_60000000000000000000000000000000"), companyId: company.id, channel: "whatsapp", state: "open", createdAt: at, updatedAt: at, closedAt: null }))!, customer = conversations.createParticipant(primary, company.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_60000000000000000000000000000000"), conversationId: conversation.id, type: "whatsapp_contact", reference: "customer", createdAt: at }))!, assistant = conversations.createParticipant(primary, company.id, reconstructConversationParticipant({ id: conversationParticipantId("cpt_60000000000000000000000000000001"), conversationId: conversation.id, type: "assistant", reference: "assistant", createdAt: at }))!;
  const profileId = "asp_60000000000000000000000000000000", connectionId = "wac_60000000000000000000000000000000";
  database.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)").run(profileId, company.id, "Proactive", "proactive", "professional", "en", "Fallback", "ready", at, at);
  database.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(connectionId, primary.workspaceId, company.id, profileId, "phone", "business", "active", at, at);
  database.prepare("INSERT INTO whatsapp_conversation_bindings(id,whatsapp_connection_id,wa_id,conversation_id,customer_participant_id,assistant_participant_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run("wcb_60000000000000000000000000000000", connectionId, "customer", conversation.id, customer.id, assistant.id, at, at);
  conversations.ensureConversationControl(primary, company.id, conversation.id);
  const inbound = conversations.createMessage(primary, company.id, reconstructConversationMessage({ id: "cmsg_60000000000000000000000000000000" as never, conversationId: conversation.id, senderParticipantId: customer.id, direction: "inbound", content: "real", idempotencyKey: "inbound", executionRecordId: null, createdAt: at }))!;
  database.prepare("INSERT INTO channel_provider_events(id,communication_channel,transport_provider,transport_connection_id,external_event_id,state,conversation_id,conversation_message_id,created_at,updated_at) VALUES(?,?,?,?,?,'completed',?,?,?,?)").run("cpe_60000000000000000000000000000000", "whatsapp", "meta", connectionId, "event", conversation.id, inbound.id, at, at);
  database.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run("pmr_60000000000000000000000000000000", "whatsapp", "meta", "inbound", connectionId, inbound.id, "wamid", at, at);
  const service = new ProactiveActionOperatorService(new ProactiveActionRepository(database), { now: () => at }), controllers = createProactiveActionControllers(service), authorizedCompaniesRouter = createAuthorizedCompaniesRouter({ authentication: { cookieName: () => "atlas", current: (raw: string) => raw === "missing" ? null : { userId: raw }, validateCsrf: (_raw: string, token: string) => token === "csrf" } as never, users: { findById: (id: string) => id === "deleted" ? null : { id, status: id === "inactive" ? "suspended" : "active" } } as never, authorization: { authorize: (user: { id: string; status: string }, workspace: string, permission: string) => { if (user.status !== "active" || user.id === "reader" && permission !== "company:read") throw new Error("denied"); const context = workspace === "wsp_default" ? primary : workspace === "wsp_secondary" ? secondary : null; if (!context) throw new Error("denied"); return { userId: user.id, membershipId: "membership", role: user.id === "reader" ? "viewer" : "operator", capabilities: new Set([permission]), workspaceId: context.workspaceId, workspacePublicId: workspace, permission }; } } as never, resolver: { resolve: (decision: { workspaceId: number }) => decision.workspaceId === primary.workspaceId ? primary : secondary } as never, controllers: {} as never, assistantControllers: {} as never, proactiveActionControllers: controllers });
  const empty = Router(), app = createApp({ authorizedCompaniesRouter, chatRouter: empty, companiesRouter: empty, identityRouter: empty, knowledgeRouter: empty, publicWebChatRouter: empty, scrapeRouter: empty, workspacesRouter: empty });
  return { database, app, company, other, foreign, conversation };
}
async function running(value: ReturnType<typeof fixture>) { const server = value.app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server.once("listening", resolve)); const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`, base = (workspace = "wsp_default", companyId = value.company.id) => `${origin}/workspaces/${workspace}/companies/${companyId}`, headers = (actor = "manage", overrides: Record<string, string> = {}) => ({ "content-type": "application/json", cookie: `atlas=${actor}`, origin, "sec-fetch-site": "same-origin", "x-csrf-token": "csrf", ...overrides }); return { base, headers, close: async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); value.database.close(); } }; }
const policy = (operationId: string, expectedVersion = 1, enabled = true) => ({ operationId, expectedVersion, enabled });
const create = (operationId: string, runAt = "2026-08-31T18:00:00.000Z") => ({ operationId, runAt, intentKind: "follow_up" });

test("EPIC045 PASS6 exposes safe policy and action projections with durable replay and no synchronous execution", async () => {
  const value = fixture(), http = await running(value); const policyPath = `${http.base()}/proactive-action-policy`, actionsPath = `${http.base()}/proactive-actions`, createPath = `${http.base()}/conversations/${value.conversation.id}/proactive-actions`;
  try {
    const before = value.database.prepare("SELECT (SELECT COUNT(*) FROM proactive_actions) actions,(SELECT COUNT(*) FROM proactive_action_operations) operations,(SELECT COUNT(*) FROM proactive_action_audit_events) audits,(SELECT COUNT(*) FROM outbound_deliveries) deliveries,(SELECT COUNT(*) FROM assistant_execution_records) executions").get();
    assert.deepEqual(await (await fetch(policyPath, { headers: http.headers("reader") })).json(), { enabled: false, version: 1 });
    assert.deepEqual(value.database.prepare("SELECT (SELECT COUNT(*) FROM proactive_actions) actions,(SELECT COUNT(*) FROM proactive_action_operations) operations,(SELECT COUNT(*) FROM proactive_action_audit_events) audits,(SELECT COUNT(*) FROM outbound_deliveries) deliveries,(SELECT COUNT(*) FROM assistant_execution_records) executions").get(), before);
    assert.equal((await fetch(policyPath, { method: "PUT", headers: http.headers(), body: JSON.stringify(policy("enable")) })).status, 200);
    const replay = await fetch(policyPath, { method: "PUT", headers: http.headers(), body: JSON.stringify(policy("enable")) }); assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), { enabled: true, version: 2 });
    const created = await fetch(createPath, { method: "POST", headers: http.headers(), body: JSON.stringify(create("create-one")) }); assert.equal(created.status, 201); const action = await created.json() as { id: string; conversationId: string; intentKind: string; state: string; version: number }; assert.deepEqual({ conversationId: action.conversationId, intentKind: action.intentKind, state: action.state, version: action.version }, { conversationId: value.conversation.id, intentKind: "follow_up", state: "scheduled", version: 1 });
    const createdReplay = await fetch(createPath, { method: "POST", headers: http.headers(), body: JSON.stringify(create("create-one")) }); assert.equal(createdReplay.status, 201); assert.equal((await createdReplay.json() as { id: string }).id, action.id);
    assert.equal((await fetch(createPath, { method: "POST", headers: http.headers(), body: JSON.stringify(create("create-one", "2026-08-31T18:00:01.000Z")) })).status, 409);
    const listed = await fetch(actionsPath, { headers: http.headers("reader") }); assert.equal(listed.status, 200); const list = await listed.json() as { items: Array<Record<string, unknown>> }; assert.equal(list.items.length, 1); assert.equal("leaseToken" in list.items[0]!, false); assert.equal("outboundDeliveryId" in list.items[0]!, false);
    assert.equal((await fetch(`${actionsPath}/${action.id}`, { headers: http.headers("reader") })).status, 200);
    const cancel = await fetch(`${actionsPath}/${action.id}/cancel`, { method: "POST", headers: http.headers(), body: JSON.stringify({ operationId: "cancel-one", expectedVersion: 1 }) }); assert.equal(cancel.status, 200); assert.equal((await cancel.json() as { state: string }).state, "cancelled"); assert.equal((await fetch(`${actionsPath}/${action.id}/cancel`, { method: "POST", headers: http.headers(), body: JSON.stringify({ operationId: "cancel-one", expectedVersion: 1 }) })).status, 200);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM assistant_execution_records").get() as { count: number }).count, 0); assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM outbound_deliveries").get() as { count: number }).count, 0);
  } finally { await http.close(); }
});

test("EPIC045 PASS6 rejects unsafe bodies, closed windows, and discloses neither authorization nor scope", async () => {
  const value = fixture(), http = await running(value); const policyPath = `${http.base()}/proactive-action-policy`, createPath = `${http.base()}/conversations/${value.conversation.id}/proactive-actions`;
  try {
    for (const [path, method, body] of [[policyPath, "PUT", {}], [policyPath, "PUT", { ...policy("x"), extra: true }], [createPath, "POST", { ...create("intent"), intent: { kind: "follow_up" } }], [createPath, "POST", { ...create("prompt"), prompt: "no" }], [createPath, "POST", { ...create("bad-kind"), intentKind: "other" }]] as const) assert.equal((await fetch(path, { method, headers: http.headers(), body: JSON.stringify(body) })).status, 400);
    assert.equal((await fetch(policyPath, { method: "PUT", headers: http.headers(), body: "{" })).status, 400);
    const oversized = await fetch(policyPath, { method: "PUT", headers: http.headers(), body: JSON.stringify({ ...policy("large"), padding: "x".repeat(100 * 1024) }) }); assert.equal(oversized.status, 413);
    assert.equal((await fetch(policyPath, { method: "PUT", headers: http.headers("reader"), body: JSON.stringify(policy("reader")) })).status, 404);
    assert.equal((await fetch(policyPath, { method: "PUT", headers: http.headers("manage", { origin: "https://foreign.test" }), body: JSON.stringify(policy("origin")) })).status, 404);
    assert.equal((await fetch(`${http.base("wsp_secondary", value.company.id)}/proactive-action-policy`, { headers: http.headers("reader") })).status, 404);
    assert.equal((await fetch(`${http.base("wsp_default", value.other.id)}/proactive-actions/not-an-action`, { headers: http.headers("reader") })).status, 404);
    assert.equal((await fetch(createPath, { method: "POST", headers: http.headers(), body: JSON.stringify(create("disabled")) })).status, 409);
    await fetch(policyPath, { method: "PUT", headers: http.headers(), body: JSON.stringify(policy("enable")) });
    assert.equal((await fetch(createPath, { method: "POST", headers: http.headers(), body: JSON.stringify(create("closed-window", "2026-09-01T18:00:00.000Z")) })).status, 409);
    assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM proactive_actions").get() as { count: number }).count, 0); assert.equal((value.database.prepare("SELECT COUNT(*) AS count FROM proactive_action_operations WHERE operation='create'").get() as { count: number }).count, 0);
  } finally { await http.close(); }
});
