import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";

const projection = Object.freeze({ overall: "pilot_ready" as const, classification: "pilot_ready" as const, checks: Object.freeze([{ id: "web_chat" as const, required: false, status: "complete" as const, owner: null, reasonCode: null }]), nextAction: null, evaluatedAt: "2026-01-01T00:00:00.000Z", policyVersion: "pilot-readiness-v1" as const });

test("EPIC053 PASS2 customer API is scoped, read-only, and exposes only the safe contract", async () => {
  let calls = 0;
  const app = express();
  app.use("/workspaces", createAuthorizedCompaniesRouter({
    authentication: { cookieName: () => "atlas", current: (raw: string) => raw === "ok" ? { userId: "usr_test" } : null, validateCsrf: () => false } as never,
    users: { findById: () => ({ id: "usr_test" }) } as never,
    authorization: { authorize: (_user: unknown, workspace: string, permission: string) => { if (workspace !== "wsp_allowed" || permission !== "company:read") throw new Error("denied"); return { userId: "usr_test", membershipId: "mem_test", role: "viewer", capabilities: [], permission }; } } as never,
    resolver: { resolve: () => ({ workspaceId: 1, workspaceKey: "allowed" }) } as never,
    controllers: {} as never,
    assistantControllers: {} as never,
    pilotReadinessService: { get: async (_context: unknown, companyId: number) => { calls += 1; if (companyId !== 1) throw new Error("unexpected"); return projection; } } as never,
  }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const success = await fetch(`${origin}/workspaces/wsp_allowed/companies/1/pilot-readiness`, { headers: { cookie: "atlas=ok" } });
    assert.equal(success.status, 200);
    const body = await success.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["checks", "classification", "evaluatedAt", "nextAction", "overall", "policyVersion"]);
    assert.deepEqual(body.checks, [{ id: "web_chat", required: false, status: "complete", owner: null, reasonCode: null, actionPath: "/companies/1/channels/web-chat" }]);
    const serialized = JSON.stringify(body).toLowerCase();
    for (const forbidden of ["token", "credential", "provider", "payer", "secret", "error"]) assert.equal(serialized.includes(forbidden), false);
    assert.equal(calls, 1);
    assert.equal((await fetch(`${origin}/workspaces/wsp_other/companies/1/pilot-readiness`, { headers: { cookie: "atlas=ok" } })).status, 404);
    assert.equal((await fetch(`${origin}/workspaces/wsp_allowed/companies/1/pilot-readiness`)).status, 404);
    assert.equal(calls, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
