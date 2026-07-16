import assert from "node:assert/strict";
import test from "node:test";
import type { Clock } from "../identity/application/ports.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import type { AssistantProfileRepositoryPort, CreateAssistantProfileResult, UpdateAssistantProfileResult } from "../assistant/application/ports.js";
import type { AssistantProfile, AssistantProfileId } from "../assistant/domain/assistantProfile.js";
import { normalizeAssistantProfileName } from "../assistant/domain/assistantProfile.js";
import { AssistantProfileConflictError, AssistantProfileService, AssistantProfileValidationError } from "../assistant/services/assistantProfileService.js";

class FixedClock implements Clock { public constructor(private value = "2026-07-16T12:00:00.000Z") {} public now(): string { return this.value; } public set(value: string): void { this.value = value; } }
class MemoryProfiles implements AssistantProfileRepositoryPort {
  public values: AssistantProfile[] = [];
  public listActive(_context: WorkspaceContext, companyId: number) { return { status: "found" as const, profiles: this.values.filter((p) => p.companyId === companyId && p.status !== "archived") }; }
  public findById(_context: WorkspaceContext, companyId: number, id: AssistantProfileId): AssistantProfile | null { return this.values.find((p) => p.companyId === companyId && p.id === id) ?? null; }
  public create(_context: WorkspaceContext, _companyId: number, profile: AssistantProfile): CreateAssistantProfileResult { this.values.push(profile); return { status: "created", profile }; }
  public update(_context: WorkspaceContext, _companyId: number, profile: AssistantProfile): UpdateAssistantProfileResult { const index = this.values.findIndex((p) => p.id === profile.id); if (index < 0) return { status: "not_found" }; this.values[index] = profile; return { status: "updated", profile }; }
}
const context = Object.freeze({ workspaceId: 1, workspaceKey: "test" });
function setup(): { service: AssistantProfileService; repository: MemoryProfiles; clock: FixedClock } { const repository = new MemoryProfiles(), clock = new FixedClock(); return { repository, clock, service: new AssistantProfileService(repository, clock) }; }
function readyFields() { return { businessRole: "Sales assistant", objective: "Qualify customer requests", welcomeMessage: "Welcome", audience: null }; }

test("Assistant Profile creation uses asp IDs, deterministic normalization and frozen defaults", () => {
  const { service } = setup();
  const profile = service.create(context, 1, { name: "  SALES Ñ  ", assistantLanguage: "en" });
  assert.match(profile.id, /^asp_[0-9a-f]{32}$/);
  assert.equal(profile.name, "SALES Ñ");
  assert.equal(profile.normalizedName, "sales ñ");
  assert.equal(normalizeAssistantProfileName("  SALES Ñ  "), "sales ñ");
  assert.equal(profile.status, "draft");
  assert.equal(profile.tone, "professional");
  assert.equal(profile.description, null);
  assert.equal(profile.audience, null);
  assert.equal(profile.fallbackMessage, "I do not have enough information to answer safely.");
});

test("field shape, nullability, unknown fields and Unicode code-point limits are enforced", () => {
  const { service } = setup();
  assert.throws(() => service.create(context, 1, { id: "asp_00000000000000000000000000000000", name: "A", assistantLanguage: "en" }), AssistantProfileValidationError);
  assert.throws(() => service.create(context, 1, { name: "😀".repeat(81), assistantLanguage: "en" }), AssistantProfileValidationError);
  const profile = service.create(context, 1, { name: "😀".repeat(80), assistantLanguage: "es", description: null, audience: null });
  assert.equal(Array.from(profile.name).length, 80);
  assert.throws(() => service.update(context, 1, profile.id, { fallbackMessage: null }), AssistantProfileValidationError);
  assert.throws(() => service.update(context, 1, profile.id, { status: "ready" }), AssistantProfileValidationError);
});

test("ReadyPolicy and the complete lifecycle including archived restore are enforced", () => {
  const { service, clock } = setup();
  let profile = service.create(context, 1, { name: "Sales", assistantLanguage: "en" });
  assert.throws(() => service.transition(context, 1, profile.id, "ready"), AssistantProfileConflictError);
  profile = service.update(context, 1, profile.id, readyFields());
  profile = service.transition(context, 1, profile.id, "ready");
  assert.equal(profile.status, "ready");
  assert.throws(() => service.update(context, 1, profile.id, { objective: null }), AssistantProfileConflictError);
  profile = service.update(context, 1, profile.id, { objective: "Handle qualified requests" });
  profile = service.transition(context, 1, profile.id, "disabled");
  profile = service.transition(context, 1, profile.id, "draft");
  assert.throws(() => service.transition(context, 1, profile.id, "disabled"), AssistantProfileConflictError);
  clock.set("2026-07-16T13:00:00.000Z");
  profile = service.transition(context, 1, profile.id, "archived");
  assert.equal(profile.archivedAt, "2026-07-16T13:00:00.000Z");
  assert.throws(() => service.update(context, 1, profile.id, { name: "Other" }), AssistantProfileConflictError);
  assert.throws(() => service.transition(context, 1, profile.id, "archived"), AssistantProfileConflictError);
  profile = service.transition(context, 1, profile.id, "draft");
  assert.equal(profile.archivedAt, null);
  assert.equal(profile.status, "draft");
});

test("updatedAt advances for later, equal and earlier Clock values while createdAt remains immutable", () => {
  const { service, clock } = setup();
  let profile = service.create(context, 1, { name: "Timeline", assistantLanguage: "en" });
  const createdAt = profile.createdAt;
  clock.set("2026-07-16T12:00:01.000Z");
  profile = service.update(context, 1, profile.id, { description: "Later" });
  assert.equal(profile.updatedAt, "2026-07-16T12:00:01.000Z");
  clock.set(profile.updatedAt);
  profile = service.update(context, 1, profile.id, { description: "Equal" });
  assert.equal(profile.updatedAt, "2026-07-16T12:00:01.001Z");
  clock.set("2026-07-16T11:00:00.000Z");
  const beforeEarlier = profile.updatedAt;
  profile = service.update(context, 1, profile.id, { description: "Earlier" });
  assert.ok(profile.updatedAt > beforeEarlier);
  const firstFixed = profile.updatedAt;
  profile = service.update(context, 1, profile.id, { description: "Fixed again" });
  assert.ok(profile.updatedAt > firstFixed);
  profile = service.transition(context, 1, profile.id, "archived");
  assert.equal(profile.archivedAt, profile.updatedAt);
  const archivedUpdatedAt = profile.updatedAt;
  profile = service.transition(context, 1, profile.id, "draft");
  assert.ok(profile.updatedAt > archivedUpdatedAt);
  assert.equal(profile.archivedAt, null);
  assert.equal(profile.createdAt, createdAt);
});
