import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { configureProductionConversationMessageController, createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";

test("EPIC-019 operator message endpoint enforces authorized mutation controls and exposes only the safe DTO", async () => {
  let sends = 0; const delivered = new Set<string>();
  configureProductionConversationMessageController(() => (req, res) => {
    const input = req.body as { content?: unknown; idempotencyKey?: unknown };
    if (typeof input.content !== "string" || !input.content.trim() || typeof input.idempotencyKey !== "string" || !input.idempotencyKey.trim()) { res.status(400).json({ error: "Message is invalid." }); return; }
    if (!delivered.has(input.idempotencyKey)) { delivered.add(input.idempotencyKey); sends += 1; }
    res.status(201).json({ messageId: "cmsg_0123456789abcdef0123456789abcdef", delivery: { id: "odl_0123456789abcdef0123456789abcdef", state: "accepted" } });
  });
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
    assert.equal(first.status, 201); assert.deepEqual(await first.json(), { messageId: "cmsg_0123456789abcdef0123456789abcdef", delivery: { id: "odl_0123456789abcdef0123456789abcdef", state: "accepted" } });
    const duplicate = await fetch(path, { method: "POST", headers, body: JSON.stringify({ content: "Hello", idempotencyKey: "one" }) }); assert.equal(duplicate.status, 201); assert.equal(sends, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
