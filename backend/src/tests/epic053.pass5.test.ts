import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { operationalLogger, setOperationalLogSinkForTests } from "../observability/operationalLogger.js";
import { PilotReadinessService } from "../onboarding/services/pilotReadinessService.js";

const context = { workspaceId: 1, workspaceKey: "pilot" };
type Input = Partial<{ assistant: boolean; knowledge: boolean; commercial: "usable" | "control_suspended" | "entitlement_missing" | "entitlement_ineligible"; webChat: "operational" | "inactive" | "absent"; whatsApp: "operational" | "inactive" | "absent" | "platform_configuration_unavailable" | "external_verification_pending" | "validation_failed" | "health_degraded"; platformAvailable: boolean; lifecycle: "operational" | "suspended" }>;

function readiness(input: Input = {}): PilotReadinessService {
  const profileId = "asp_default", whatsApp = input.whatsApp ?? "absent", webChat = input.webChat ?? "absent";
  const connection = { id: "wac_safe", status: whatsApp === "operational" ? "active" : "inactive", assistantProfileId: profileId };
  const state = whatsApp === "operational" ? { validationState: "valid", healthState: "healthy" } : whatsApp === "validation_failed" ? { validationState: "invalid", healthState: "inactive" } : whatsApp === "health_degraded" ? { validationState: "valid", healthState: "degraded" } : { validationState: "not_validated", healthState: "inactive" };
  return new PilotReadinessService(
    { findById: async () => ({ lifecycle: input.lifecycle ?? "operational" }) } as never,
    { assess: async () => ({ assistantProfileId: profileId, blockers: input.assistant === false ? ["default_assistant_missing"] : [] }) } as never,
    { loadCurrentVersion: async () => input.knowledge === false ? null : { id: "kver_safe" } } as never,
    { listByCompany: async () => webChat === "absent" ? [] : [{ status: webChat === "operational" ? "active" : "inactive", assistantProfileId: profileId }] } as never,
    { listByCompany: async () => whatsApp === "absent" ? [] : [connection], findCredentials: async () => whatsApp === "operational" ? { whatsAppConnectionId: connection.id } : null, findOperationalState: async () => state } as never,
    { pilotReadiness: async () => input.commercial ?? "usable" }, { whatsAppEmbeddedSignupAvailable: input.platformAvailable ?? true }, { now: () => "2026-01-01T00:00:00.000Z" },
  );
}

test("EPIC053 PASS5 evaluates paths A-G from repository facts through the readiness evaluator", async () => {
  const paths: readonly [string, Input, string][] = [
    ["A required setup blocked", { assistant: false, webChat: "operational" }, "setup_incomplete"],
    ["B channel configuration required", { webChat: "absent" }, "configuration_ready"],
    ["C platform configuration required", { webChat: "absent", platformAvailable: false }, "code_ready"],
    ["D external provider blocked", { webChat: "absent", whatsApp: "health_degraded" }, "external_provider_blocked"],
    ["E Web Chat pilot ready", { webChat: "operational" }, "pilot_ready"],
    ["F WhatsApp pilot ready", { whatsApp: "operational" }, "pilot_ready"],
    ["G authoritative regression", { lifecycle: "suspended", webChat: "operational" }, "setup_incomplete"],
  ];
  for (const [name, input, classification] of paths) assert.equal((await readiness(input).get(context, 1)).classification, classification, name);
});

test("EPIC053 PASS5 emits safe evaluation and transition telemetry without duplicate classifications", async () => {
  const records: Record<string, unknown>[] = [], restore = setOperationalLogSinkForTests((line) => records.push(JSON.parse(line) as Record<string, unknown>));
  try {
    const service = readiness({ webChat: "operational" });
    await service.get(context, 1);
    await service.get(context, 1);
    await readiness({ assistant: false, webChat: "operational" }).get(context, 1);
    await readiness({ webChat: "absent", whatsApp: "health_degraded" }).get(context, 1);
    const events = records.map((record) => record.event);
    assert.equal(events.filter((event) => event === "pilot_readiness_evaluated").length, 4);
    assert.equal(events.filter((event) => event === "pilot_readiness_classification_changed").length, 3);
    assert.equal(events.filter((event) => event === "pilot_readiness_pilot_ready_reached").length, 1);
    assert.equal(events.filter((event) => event === "pilot_readiness_required_blocked").length, 2);
    assert.equal(events.filter((event) => event === "pilot_readiness_external_provider_blocked").length, 1);
    const serialized = JSON.stringify(records).toLowerCase();
    for (const forbidden of ["wac_safe", "asp_default", "kver_safe", "token", "credential", "secret", "error", "actionpath"]) assert.equal(serialized.includes(forbidden), false);
  } finally { restore(); }
});

test("EPIC053 PASS5 customer GET remains authorized, private, retryable, and non-writing", async () => {
  let reads = 0, writes = 0;
  const projection = { overall: "pilot_ready" as const, classification: "pilot_ready" as const, checks: [], nextAction: null, evaluatedAt: "2026-01-01T00:00:00.000Z", policyVersion: "pilot-readiness-v1" as const };
  const app = express();
  app.use("/workspaces", createAuthorizedCompaniesRouter({
    authentication: { cookieName: () => "atlas", current: (raw: string) => raw === "ok" ? { userId: "usr_test" } : null, validateCsrf: () => false } as never,
    users: { findById: () => ({ id: "usr_test" }) } as never,
    authorization: { authorize: () => ({ userId: "usr_test", membershipId: "mem_test", role: "viewer", capabilities: [], permission: "company:read" }) } as never,
    resolver: { resolve: () => ({ workspaceId: 1, workspaceKey: "pilot" }) } as never, controllers: {} as never, assistantControllers: {} as never,
    pilotReadinessService: { get: async () => { reads += 1; return projection; }, write: () => { writes += 1; } } as never,
  }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const first = await fetch(`${origin}/workspaces/wsp_pilot/companies/1/pilot-readiness`, { headers: { cookie: "atlas=ok" } });
    assert.equal(first.status, 200); assert.equal((await first.json() as { classification: string }).classification, "pilot_ready");
    assert.equal((await fetch(`${origin}/workspaces/wsp_pilot/companies/1/pilot-readiness`, { headers: { cookie: "atlas=ok" } })).status, 200);
    assert.equal((await fetch(`${origin}/workspaces/wsp_pilot/companies/1/pilot-readiness`)).status, 404);
    assert.equal(reads, 2); assert.equal(writes, 0);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
