import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { createOperatorConversationMessageController } from "../controllers/operatorConversationMessagingController.js";
import { OperatorConversationMessagingService } from "../conversation/services/operatorConversationMessagingService.js";
import { configureProductionConversationMessageController, createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";

test("EPIC-019 operator message endpoint enforces authorized mutation controls and exposes only the safe DTO", async () => {
  let sends = 0; const persisted = new Map<string, { id: string; content: string; createdAt: string }>();
  const service = new OperatorConversationMessagingService(
    { validateOpen: () => ({ id: "cnv_0123456789abcdef0123456789abcdef" }) } as never,
    { persistOperatorMessage: (_context: unknown, _company: unknown, _conversation: unknown, _actor: unknown, content: string, key: string) => { const replay = persisted.get(key); if (replay) return { kind: "replayed", message: replay }; sends += 1; const message = { id: "cmsg_0123456789abcdef0123456789abcdef", content, createdAt: "2026-01-01T00:00:01.000Z" }; persisted.set(key, message); return { kind: "created", message }; } } as never,
    {} as never,
    { findBindingByConversation: () => ({ whatsAppConnectionId: "wac_0123456789abcdef0123456789abcdef", waId: "15551234567" }) } as never,
    { deliverWhatsAppText: async () => ({ id: "odl_0123456789abcdef0123456789abcdef", state: "accepted" as const }) } as never,
    { now: () => "2026-01-01T00:00:00.000Z" },
  );
  configureProductionConversationMessageController((context, actor) => createOperatorConversationMessageController(service, context, actor));
  const app = express(); app.use(express.json());
  app.use("/workspaces", createAuthorizedCompaniesRouter({
    authentication: { cookieName: () => "atlas", current: (raw: string) => raw === "valid" ? { userId: "operator" } : null, validateCsrf: (_raw: string, csrf: string) => csrf === "csrf" } as never,
    users: { findById: (id: string) => id === "operator" ? { id, status: "active" } : null } as never,
    authorization: { authorize: (_user: unknown, workspace: string, permission: string) => { if (workspace !== "wsp_default" || permission !== "conversation:message:send") throw new Error("denied"); return { userId: "operator", membershipId: "membership", role: "operator", capabilities: new Set([permission]), workspaceId: 1, workspacePublicId: workspace, permission }; } } as never,
    resolver: { resolve: () => ({ workspaceId: 1, workspaceKey: "default" }) } as never,
    controllers: {} as never, assistantControllers: {} as never,
  }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const path = `${origin}/workspaces/wsp_default/companies/1/conversations/cnv_0123456789abcdef0123456789abcdef/messages`;
  const headers = { "content-type": "application/json", cookie: "atlas=valid", origin, "sec-fetch-site": "same-origin", "x-csrf-token": "csrf" };
  try {
    assert.equal((await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
    assert.equal((await fetch(path, { method: "POST", headers: { ...headers, "x-csrf-token": "bad" }, body: JSON.stringify({ content: "Hello", idempotencyKey: "one" }) })).status, 404);
    assert.equal((await fetch(path, { method: "POST", headers: { ...headers, origin: "https://foreign.test" }, body: JSON.stringify({ content: "Hello", idempotencyKey: "one" }) })).status, 404);
    assert.equal((await fetch(path, { method: "POST", headers, body: JSON.stringify({ content: "", idempotencyKey: "one" }) })).status, 400);
    const first = await fetch(path, { method: "POST", headers, body: JSON.stringify({ content: "Hello", idempotencyKey: "one" }) });
    assert.equal(first.status, 201); assert.deepEqual(await first.json(), { messageId: "cmsg_0123456789abcdef0123456789abcdef", message: { messageId: "cmsg_0123456789abcdef0123456789abcdef", content: "Hello", createdAt: "2026-01-01T00:00:01.000Z" }, delivery: { id: "odl_0123456789abcdef0123456789abcdef", state: "accepted" } });
    const duplicate = await fetch(path, { method: "POST", headers, body: JSON.stringify({ content: "Hello", idempotencyKey: "one" }) }); assert.equal(duplicate.status, 201); assert.equal(sends, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
