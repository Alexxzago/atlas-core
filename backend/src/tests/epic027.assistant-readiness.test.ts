import assert from "node:assert/strict";
import { test } from "node:test";
import { assistantProfileId, reconstructAssistantProfile } from "../assistant/domain/assistantProfile.js";
import { AssistantReadinessService } from "../assistant/services/assistantReadinessService.js";
import { WhatsAppConnectionConflictError, WhatsAppConnectionService } from "../whatsapp/services/WhatsAppConnectionService.js";

const context = { workspaceId: 1, workspaceKey: "test" };
const profile = reconstructAssistantProfile({ id: assistantProfileId("asp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), companyId: 1, name: "Default", normalizedName: "default", description: null, businessRole: "Sales", objective: "Help", audience: null, tone: "professional", assistantLanguage: "en", welcomeMessage: "Hello", fallbackMessage: "Sorry", status: "ready", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null });
const connection = { id: "wac_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as import("../whatsapp/domain/whatsappConnection.js").WhatsAppConnectionId, workspaceId: 1, companyId: 1, assistantProfileId: profile.id, phoneNumberId: "phone", whatsappBusinessAccountId: "business", status: "inactive" as const, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

function setup(input: Partial<{ knowledge: boolean; profile: typeof profile | null; connection: boolean; credentials: boolean; validation: boolean; workspaceId: number }> = {}) {
  const saved: unknown[] = [], workspaceId = input.workspaceId ?? 1;
  const connections = { findById: (_c: typeof context, _company: number, id: string) => input.connection === false || id !== connection.id ? null : connection, findCredentials: () => input.credentials === false ? null : { whatsAppConnectionId: connection.id }, findOperationalState: () => input.validation === false ? { validationState: "invalid" } : { validationState: "valid" } };
  const defaults={get:()=>input.profile===null?null:{assistantProfileId:(input.profile??profile).id},bootstrap:()=>input.profile===null?null:{assistantProfileId:(input.profile??profile).id}};
  const service = new AssistantReadinessService({ findById: (c: typeof context) => c.workspaceId === workspaceId ? { id: 1 } : null } as never, { loadCurrentVersion: () => input.knowledge === false ? null : { id: "kver_a", snapshotDigest: "digest" } } as never, { listActive: () => ({ status: "found", profiles: input.profile === null ? [] : [input.profile ?? profile] }), findById: () => input.profile === null ? null : input.profile ?? profile } as never, connections as never, { create: (_c: typeof context, value: import("../assistant/domain/assistantReadiness.js").AssistantReadinessAssessment) => { saved.push(value); return value; }, findLatest: () => null } as never, defaults as never, { now: () => "2026-01-02T00:00:00.000Z" });
  return { service, saved };
}

test("assistant readiness reports each objective blocker independently", () => {
  assert.deepEqual(setup({ knowledge: false }).service.refresh(context, 1).blockers, ["published_knowledge_missing"]);
  assert.deepEqual(setup({ profile: null }).service.refresh(context, 1).blockers, ["default_assistant_missing"]);
  const nonExecutable = reconstructAssistantProfile({ ...profile, objective: null });
  assert.deepEqual(setup({ profile: nonExecutable }).service.refresh(context, 1).blockers, ["default_assistant_not_executable"]);
  assert.deepEqual(setup({ connection: false }).service.refresh(context, 1, connection.id).blockers, ["whatsapp_connection_inconsistent", "whatsapp_connection_missing"]);
  assert.deepEqual(setup({ credentials: false }).service.refresh(context, 1, connection.id).blockers, ["whatsapp_credentials_missing"]);
  assert.deepEqual(setup({ validation: false }).service.refresh(context, 1, connection.id).blockers, ["whatsapp_validation_missing"]);
});

test("assistant readiness is reproducible, persisted on repeated refresh, and scoped to its workspace", () => {
  const value = setup();
  const first = value.service.refresh(context, 1), second = value.service.refresh(context, 1);
  assert.equal(first.status, "ready"); assert.equal(second.status, "ready"); assert.equal(first.configurationDigest, second.configurationDigest); assert.equal(value.saved.length, 2);
  assert.throws(() => value.service.refresh({ workspaceId: 2, workspaceKey: "other" }, 1));
});

test("WhatsApp activation rejects the persisted readiness result instead of legacy company status", async () => {
  const service = new WhatsAppConnectionService({ findById: () => ({ id: 1, status: "ready" }) } as never, {} as never, { findById: () => connection, updateStatus: () => connection } as never, { now: () => "2026-01-02T00:00:00.000Z" }, undefined, { refresh: () => ({ status: "blocked" }) } as never);
  await assert.rejects(() => service.activate(context, 1, connection.id), WhatsAppConnectionConflictError);
});
