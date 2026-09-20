import assert from "node:assert/strict";
import test from "node:test";
import { PilotReadinessNotFoundError, PilotReadinessService } from "../onboarding/services/pilotReadinessService.js";

const context = { workspaceId: 1, workspaceKey: "pilot" };
type Input = Partial<{ lifecycle: "draft" | "configured" | "operational" | "attention_required" | "suspended" | "archived"; assistant: "ready" | "blocked"; knowledge: boolean; commercial: "usable" | "control_suspended" | "entitlement_missing" | "entitlement_ineligible"; webChat: "operational" | "inactive" | "absent"; whatsApp: "operational" | "inactive" | "absent" | "platform_configuration_unavailable" | "external_verification_pending" | "validation_failed" | "health_degraded"; platformAvailable: boolean; }>;

function service(input: Input = {}): PilotReadinessService {
  const profileId = "asp_default";
  const webChat = input.webChat ?? "absent";
  const whatsApp = input.whatsApp ?? "absent";
  const connection = { id: "wac_test", status: whatsApp === "operational" ? "active" : "inactive", assistantProfileId: profileId };
  const state = whatsApp === "operational" ? { validationState: "valid", healthState: "healthy" } : whatsApp === "validation_failed" ? { validationState: "invalid", healthState: "inactive" } : whatsApp === "health_degraded" ? { validationState: "valid", healthState: "degraded" } : { validationState: "not_validated", healthState: "inactive" };
  return new PilotReadinessService(
    { findById: async (_context: unknown, companyId: number) => companyId === 1 ? { lifecycle: input.lifecycle ?? "operational" } : null } as never,
    { assess: async () => ({ status: input.assistant ?? "ready", assistantProfileId: profileId, blockers: input.assistant === "blocked" ? ["default_assistant_not_executable"] : [] }) } as never,
    { loadCurrentVersion: async () => input.knowledge === false ? null : { id: "kver_test" } } as never,
    { listByCompany: async () => webChat === "absent" ? [] : [{ status: webChat === "operational" ? "active" : "inactive", assistantProfileId: profileId }] } as never,
    { listByCompany: async () => whatsApp === "absent" ? [] : [connection], findCredentials: async () => whatsApp === "operational" ? { whatsAppConnectionId: connection.id } : null, findOperationalState: async () => state } as never,
    { pilotReadiness: async () => input.commercial ?? "usable" },
    { whatsAppEmbeddedSignupAvailable: input.platformAvailable ?? true },
    { now: () => "2026-01-01T00:00:00.000Z" },
  );
}

test("EPIC053 PASS2 derives Web Chat-only and WhatsApp-only pilot readiness from persisted facts", async () => {
  const webChat = await service({ webChat: "operational" }).get(context, 1);
  assert.equal(webChat.classification, "pilot_ready");
  assert.equal(webChat.checks.find(check => check.id === "scheduling")?.status, "not_applicable");
  assert.equal(webChat.checks.find(check => check.id === "proactive")?.status, "not_applicable");
  assert.equal((await service({ webChat: "absent", whatsApp: "operational" }).get(context, 1)).classification, "pilot_ready");
});

test("EPIC053 PASS2 treats an unknown or cross-scoped company as not found", async () => {
  await assert.rejects(service().get(context, 2), PilotReadinessNotFoundError);
});

test("EPIC053 PASS2 lets Web Chat qualify while WhatsApp is externally blocked", async () => {
  const result = await service({ webChat: "operational", whatsApp: "health_degraded" }).get(context, 1);
  assert.equal(result.classification, "pilot_ready");
  assert.equal(result.checks.find(check => check.id === "whatsapp")?.status, "blocked");
});

test("EPIC053 PASS2 classifies missing operational channels and platform configuration safely", async () => {
  assert.equal((await service({ webChat: "inactive" }).get(context, 1)).classification, "configuration_ready");
  assert.equal((await service({ webChat: "absent", platformAvailable: false }).get(context, 1)).classification, "code_ready");
});

test("EPIC053 PASS2 keeps setup and commercial failures authoritative", async () => {
  assert.equal((await service({ assistant: "blocked", webChat: "operational" }).get(context, 1)).classification, "setup_incomplete");
  assert.equal((await service({ commercial: "usable", webChat: "operational" }).get(context, 1)).classification, "pilot_ready");
  assert.equal((await service({ commercial: "entitlement_ineligible", webChat: "operational" }).get(context, 1)).classification, "setup_incomplete");
  assert.equal((await service({ commercial: "entitlement_missing", webChat: "operational" }).get(context, 1)).classification, "setup_incomplete");
});

test("EPIC053 PASS2 rejects suspended and archived companies", async () => {
  assert.equal((await service({ lifecycle: "suspended", webChat: "operational" }).get(context, 1)).classification, "setup_incomplete");
  assert.equal((await service({ lifecycle: "archived", webChat: "operational" }).get(context, 1)).classification, "setup_incomplete");
});

test("EPIC053 PASS2 uses only injected persisted platform capability facts", async () => {
  const blocked = await service({ webChat: "absent", platformAvailable: false }).get(context, 1);
  const available = await service({ webChat: "absent", platformAvailable: true }).get(context, 1);
  assert.equal(blocked.classification, "code_ready");
  assert.equal(available.classification, "configuration_ready");
});
