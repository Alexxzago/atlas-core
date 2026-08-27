import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createDatabase } from "../config/database.js";
import { conversationId, reconstructConversation } from "../conversation/domain/conversation.js";
import { ConversationControlService } from "../conversation/services/conversationControlService.js";
import { ConversationService } from "../conversation/services/conversationService.js";
import { createConversationControlController } from "../controllers/conversationControlController.js";
import { createGetConversationController, createListConversationController } from "../controllers/conversationReadController.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

const at = "2026-08-26T12:00:00.000Z";
const conversation = (suffix: string) => conversationId(`cnv_${suffix.repeat(32).slice(0, 32)}`);

function fixture() {
  const database = createDatabase(":memory:"), workspaces = new WorkspaceRepository(database);
  const primary = createWorkspaceContext(workspaces.resolveDefault());
  const secondary = createWorkspaceContext(workspaces.createForSystemUse({ key: "secondary", name: "Secondary" }));
  const companies = new CompanyRepository(database), company = companies.create(primary, { name: "Primary", website: "https://primary.test" }), other = companies.create(primary, { name: "Other", website: "https://other.test" }), foreign = companies.create(secondary, { name: "Foreign", website: "https://foreign.test" });
  const conversations = new ConversationRepository(database), reads = new ConversationService(conversations, { now: () => at }), controls = new ConversationControlService(reads, conversations, { now: () => at });
  const create = (context: typeof primary, companyId: number, id: ReturnType<typeof conversationId>) => conversations.createConversation(context, reconstructConversation({ id, companyId, channel: "internal", state: "open", createdAt: at, updatedAt: at, closedAt: null }))!;
  const ids = {
    mutation: create(primary, company.id, conversation("a")),
    other: create(primary, company.id, conversation("b")),
    release: create(primary, company.id, conversation("c")),
    resolve: create(primary, company.id, conversation("d")),
    automated: create(primary, company.id, conversation("e")),
    required: create(primary, company.id, conversation("f")),
    current: create(primary, company.id, conversation("1")),
    controlledOther: create(primary, company.id, conversation("2")),
    foreign: create(secondary, foreign.id, conversation("3")),
  };
  const app = express();
  app.use(express.json({ limit: "1kb" }));
  app.use("/workspaces", createAuthorizedCompaniesRouter({
    authentication: { cookieName: () => "atlas", current: (raw: string) => raw === "missing" ? null : { userId: raw }, validateCsrf: (_raw: string, csrf: string) => csrf === "csrf" } as never,
    users: { findById: (id: string) => id === "deleted" ? null : { id, status: id === "inactive" ? "suspended" : "active" } } as never,
    authorization: { authorize: (user: { id: string; status: string }, workspace: string, permission: string) => {
      if (user.status !== "active" || user.id === "suspended-member" || user.id === "viewer" || (permission !== "conversation:manage" && permission !== "company:read")) throw new Error("denied");
      const context = workspace === "wsp_primary" ? primary : workspace === "wsp_secondary" ? secondary : null;
      if (!context) throw new Error("denied");
      return { userId: user.id, membershipId: "membership", role: "operator", capabilities: new Set([permission]), workspaceId: context.workspaceId, workspacePublicId: workspace, permission };
    } } as never,
    resolver: { resolve: (decision: { workspaceId: number }) => decision.workspaceId === primary.workspaceId ? primary : secondary } as never,
    controllers: {} as never,
    assistantControllers: {} as never,
    conversationReadControllers: {
      list: (context, actor) => createListConversationController(reads, context, actor),
      get: (context, actor) => createGetConversationController(reads, context, actor),
    },
    conversationControlControllers: {
      takeover: (context, actor) => createConversationControlController(controls, context, actor, "takeover"),
      release: (context, actor) => createConversationControlController(controls, context, actor, "release"),
      resolve: (context, actor) => createConversationControlController(controls, context, actor, "resolve"),
    },
  }));
  return { database, app, company, other, foreign, ids };
}

async function running(value: ReturnType<typeof fixture>) {
  const server = value.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const path = (companyId: number, id: string, action?: "takeover" | "release" | "resolve") => `${origin}/workspaces/wsp_primary/companies/${companyId}/conversations/${id}${action ? `/${action}` : ""}`;
  const headers = (actor = "operator-1") => ({ "content-type": "application/json", cookie: `atlas=${actor}`, origin, "sec-fetch-site": "same-origin", "x-csrf-token": "csrf" });
  return { origin, path, headers, close: async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); value.database.close(); } };
}

function noPrivate(value: unknown): void {
  const json = JSON.stringify(value);
  for (const privateValue of ["controllingActorId", "resolvedBy", "operator-2"]) assert.equal(json.includes(privateValue), false);
}

test("EPIC043 PASS6A control mutation bodies require exactly expectedVersion and operationId", async () => {
  const value = fixture(), http = await running(value);
  try {
    for (const action of ["takeover", "release", "resolve"] as const) {
      const url = http.path(value.company.id, value.ids.mutation.id, action), headers = http.headers();
      for (const body of [{ expectedVersion: 1 }, { expectedVersion: 1, operationId: "" }, { operationId: "op" }, { expectedVersion: 1, operationId: "op", extra: true }]) assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify(body) })).status, 400);
      assert.equal((await fetch(url, { method: "POST", headers, body: "{" })).status, 400);
      assert.equal((await fetch(url, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: JSON.stringify({ expectedVersion: 1, operationId: "op" }) })).status, 400);
      assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify({ expectedVersion: 1, operationId: "x".repeat(1_100) }) })).status, 413);
    }
  } finally { await http.close(); }
});

test("EPIC043 PASS6A takeover, release, and resolve retain durable HTTP replay snapshots", async () => {
  const value = fixture(), http = await running(value);
  const post = (id: string, action: "takeover" | "release" | "resolve", expectedVersion: number, operationId: string, actor = "operator-1", companyId = value.company.id) => fetch(http.path(companyId, id, action), { method: "POST", headers: http.headers(actor), body: JSON.stringify({ expectedVersion, operationId }) });
  try {
    const takeover = await post(value.ids.mutation.id, "takeover", 1, "takeover-first");
    assert.equal(takeover.status, 200);
    assert.deepEqual(await takeover.json(), { control: { controlState: "human_controlled", controlledByCurrentActor: true, attentionReason: "operator_follow_up", takenAt: at, releasedAt: null, lastOperatorActivityAt: null, resolvedAt: null, controlVersion: 2, authorityGeneration: 2, updatedAt: at } });
    assert.equal((await post(value.ids.mutation.id, "takeover", 1, "takeover-first")).status, 200);
    const released = await post(value.ids.mutation.id, "release", 2, "release-first");
    assert.equal(released.status, 200); assert.equal((await released.json() as { control: { controlledByCurrentActor: boolean } }).control.controlledByCurrentActor, false);
    const replay = await post(value.ids.mutation.id, "takeover", 1, "takeover-first");
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { control: { controlState: "human_controlled", controlledByCurrentActor: true, attentionReason: null, takenAt: at, releasedAt: null, lastOperatorActivityAt: null, resolvedAt: null, controlVersion: 2, authorityGeneration: 2, updatedAt: at } });
    assert.equal((await post(value.ids.mutation.id, "takeover", 1, "stale-before-later-transition")).status, 409);
    assert.equal((await post(value.ids.mutation.id, "takeover", 3, "takeover-later")).status, 200);
    assert.equal((await post(value.ids.mutation.id, "takeover", 1, "stale-before-later-transition")).status, 409);
    assert.equal((await post(value.ids.mutation.id, "takeover", 2, "takeover-first")).status, 409);

    assert.equal((await post(value.ids.other.id, "takeover", 1, "other-take")).status, 200);
    const controlledByOther = await post(value.ids.other.id, "takeover", 2, "other-attempt", "operator-2");
    assert.equal(controlledByOther.status, 404); noPrivate(await controlledByOther.json());
    assert.equal((await post(value.ids.mutation.id, "takeover", 1, "wrong-company", "operator-1", value.other.id)).status, 404);
    assert.equal((await fetch(`${http.origin}/workspaces/wsp_secondary/companies/${value.foreign.id}/conversations/${value.ids.mutation.id}/takeover`, { method: "POST", headers: http.headers(), body: JSON.stringify({ expectedVersion: 1, operationId: "foreign" }) })).status, 404);

    assert.equal((await post(value.ids.release.id, "takeover", 1, "release-take")).status, 200);
    const releasedApplied = await post(value.ids.release.id, "release", 2, "release-op");
    assert.equal(releasedApplied.status, 200); assert.equal((await releasedApplied.json() as { control: { controlledByCurrentActor: boolean } }).control.controlledByCurrentActor, false);
    assert.equal((await post(value.ids.release.id, "takeover", 3, "release-later-take")).status, 200);
    const releaseReplay = await post(value.ids.release.id, "release", 2, "release-op");
    assert.equal(releaseReplay.status, 200); assert.deepEqual((await releaseReplay.json() as { control: { controlState: string; controlVersion: number; authorityGeneration: number } }).control, { controlState: "human_required", controlledByCurrentActor: false, attentionReason: null, takenAt: null, releasedAt: null, lastOperatorActivityAt: null, resolvedAt: null, controlVersion: 3, authorityGeneration: 3, updatedAt: at });
    assert.equal((await post(value.ids.release.id, "release", 4, "release-wrong", "operator-2")).status, 404);
    assert.equal((await post(value.ids.release.id, "release", 4, "release-foreign", "operator-1", value.other.id)).status, 404);

    assert.equal((await post(value.ids.resolve.id, "takeover", 1, "resolve-take")).status, 200);
    const resolved = await post(value.ids.resolve.id, "resolve", 2, "resolve-op");
    assert.equal(resolved.status, 200); assert.equal((await resolved.json() as { control: { controlledByCurrentActor: boolean } }).control.controlledByCurrentActor, false);
    assert.equal((await post(value.ids.resolve.id, "takeover", 3, "resolve-later-take")).status, 200);
    const resolveReplay = await post(value.ids.resolve.id, "resolve", 2, "resolve-op");
    assert.equal(resolveReplay.status, 200); assert.deepEqual((await resolveReplay.json() as { control: { controlState: string; controlVersion: number; authorityGeneration: number } }).control, { controlState: "automated", controlledByCurrentActor: false, attentionReason: null, takenAt: null, releasedAt: null, lastOperatorActivityAt: null, resolvedAt: at, controlVersion: 3, authorityGeneration: 3, updatedAt: at });
    assert.equal((await post(value.ids.resolve.id, "resolve", 4, "resolve-wrong", "operator-2")).status, 404);
    assert.equal((await post(value.ids.resolve.id, "resolve", 4, "resolve-foreign", "operator-1", value.other.id)).status, 404);
  } finally { await http.close(); }
});

test("EPIC043 PASS6A public conversation HTTP projections are actor-relative and routes are non-disclosing", async () => {
  const value = fixture(), http = await running(value);
  const post = (id: string, action: "takeover" | "release", expectedVersion: number, operationId: string, actor = "operator-1") => fetch(http.path(value.company.id, id, action), { method: "POST", headers: http.headers(actor), body: JSON.stringify({ expectedVersion, operationId }) });
  try {
    assert.equal((await post(value.ids.required.id, "takeover", 1, "required-take")).status, 200);
    assert.equal((await post(value.ids.required.id, "release", 2, "required-release")).status, 200);
    assert.equal((await post(value.ids.current.id, "takeover", 1, "current-take")).status, 200);
    assert.equal((await post(value.ids.controlledOther.id, "takeover", 1, "other-take", "operator-2")).status, 200);
    const list = await fetch(http.path(value.company.id, ""), { headers: http.headers() });
    assert.equal(list.status, 200); assert.equal(list.headers.get("cache-control"), "no-store, private"); assert.equal(list.headers.get("pragma"), "no-cache");
    const entries = await list.json() as Array<{ conversationId: string; controlState: string; controlledByCurrentActor: boolean }>;
    const byId = new Map(entries.map((entry) => [entry.conversationId, [entry.controlState, entry.controlledByCurrentActor]]));
    assert.deepEqual(byId.get(value.ids.automated.id), ["automated", false]);
    assert.deepEqual(byId.get(value.ids.required.id), ["human_required", false]);
    assert.deepEqual(byId.get(value.ids.current.id), ["human_controlled", true]);
    assert.deepEqual(byId.get(value.ids.controlledOther.id), ["human_controlled", false]);
    noPrivate(entries);
    for (const [id, state, controlled] of [[value.ids.automated.id, "automated", false], [value.ids.required.id, "human_required", false], [value.ids.current.id, "human_controlled", true], [value.ids.controlledOther.id, "human_controlled", false]] as const) {
      const response = await fetch(http.path(value.company.id, id), { headers: http.headers() });
      assert.equal(response.status, 200); const body = await response.json() as { controlState: string; controlledByCurrentActor: boolean }; assert.deepEqual([body.controlState, body.controlledByCurrentActor], [state, controlled]); noPrivate(body);
    }
    for (const actor of ["missing", "inactive", "suspended-member", "viewer"] as const) {
      const denied = await fetch(http.path(value.company.id, value.ids.current.id, "takeover"), { method: "POST", headers: http.headers(actor), body: JSON.stringify({ expectedVersion: 2, operationId: `denied-${actor}` }) });
      assert.equal(denied.status, 404); assert.equal(denied.headers.get("cache-control"), "no-store, private"); assert.equal(denied.headers.get("pragma"), "no-cache");
    }
    for (const headers of [{ ...http.headers(), "x-csrf-token": "bad" }, { ...http.headers(), origin: "https://foreign.test" }, { ...http.headers(), "sec-fetch-site": "cross-site" }]) assert.equal((await fetch(http.path(value.company.id, value.ids.current.id, "takeover"), { method: "POST", headers, body: JSON.stringify({ expectedVersion: 2, operationId: "denied-request" }) })).status, 404);
  } finally { await http.close(); }
});
