import assert from "node:assert/strict";
import test from "node:test";
import { assessAssistantReadiness } from "../assistant/domain/assistantReadiness.js";
import { assistantProfileId, reconstructAssistantProfile } from "../assistant/domain/assistantProfile.js";
import { assessPilotReadiness, type PilotReadinessFacts } from "../onboarding/domain/pilotReadiness.js";

const ready: PilotReadinessFacts = Object.freeze({
  workspaceContextValid: true,
  company: "active",
  defaultAssistantExecutable: true,
  publishedKnowledge: true,
  commercial: "usable",
  webChat: "operational",
  whatsApp: "absent",
  schedulingRelevant: false,
  schedulingConfigured: false,
  proactiveRelevant: false,
  proactiveConfigured: false,
});

test("EPIC053 PASS1 exposes the assistant readiness decision as a pure supplied-facts assessment", () => {
  const profile = reconstructAssistantProfile({ id: assistantProfileId("asp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), companyId: 1, name: "Default", normalizedName: "default", description: null, businessRole: "Sales", objective: "Help", audience: null, tone: "professional", assistantLanguage: "en", welcomeMessage: "Hello", fallbackMessage: "Sorry", status: "ready", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null });
  const assessment = assessAssistantReadiness({ id: "ara_test", workspaceId: 1, companyId: 1, knowledge: { id: "kver_test", snapshotDigest: "digest" }, readyProfileCount: 1, assignmentProfileId: profile.id, selectedProfile: profile, whatsApp: { requestedConnectionId: null, connection: null, hasCredentials: false, validationState: null }, evaluatedAt: "2026-01-01T00:00:00.000Z", configurationDigest: "digest" });
  assert.equal(assessment.status, "ready");
  assert.equal(assessment.id, "ara_test");
});

test("EPIC053 PASS1 classifies a fully authoritative Web Chat pilot as pilot_ready", () => {
  const assessment = assessPilotReadiness(ready);
  assert.equal(assessment.classification, "pilot_ready");
  assert.equal(assessment.overall, "pilot_ready");
  assert.equal(assessment.nextAction, null);
  assert.equal(assessment.checks.find((check) => check.id === "operational_channel")?.status, "complete");
});

test("EPIC053 PASS1 keeps customer-owned setup incomplete ahead of channel work", () => {
  const assessment = assessPilotReadiness({ ...ready, defaultAssistantExecutable: false, publishedKnowledge: false, webChat: "absent" });
  assert.equal(assessment.classification, "setup_incomplete");
  assert.equal(assessment.nextAction, "configure_assistant");
  assert.deepEqual(assessment.checks.filter((check) => check.required && check.status !== "complete").map((check) => check.reasonCode), ["default_assistant_not_executable", "published_knowledge_missing", "operational_channel_missing"]);
});

test("EPIC053 PASS1 distinguishes platform configuration from pilot readiness", () => {
  const assessment = assessPilotReadiness({ ...ready, webChat: "absent", whatsApp: "platform_configuration_unavailable" });
  assert.equal(assessment.classification, "code_ready");
  assert.equal(assessment.overall, "not_ready");
  assert.equal(assessment.nextAction, "review_whatsapp");
  const whatsApp = assessment.checks.find((check) => check.id === "whatsapp");
  assert.deepEqual(whatsApp, { id: "whatsapp", required: false, status: "blocked", owner: "platform", reasonCode: "whatsapp_platform_configuration_unavailable" });
});

test("EPIC053 PASS1 reports external provider blockers without marking them complete", () => {
  const assessment = assessPilotReadiness({ ...ready, webChat: "absent", whatsApp: "external_verification_pending" });
  assert.equal(assessment.classification, "external_provider_blocked");
  assert.equal(assessment.nextAction, "review_whatsapp");
  assert.equal(assessment.checks.find((check) => check.id === "whatsapp")?.owner, "external_provider");
  assert.equal(assessment.checks.find((check) => check.id === "whatsapp")?.status, "blocked");
});

test("EPIC053 PASS1 reports configured internal setup with no operational channel", () => {
  const assessment = assessPilotReadiness({ ...ready, webChat: "inactive", whatsApp: "absent" });
  assert.equal(assessment.classification, "configuration_ready");
  assert.equal(assessment.nextAction, "activate_web_chat");
});

test("EPIC053 PASS1 lets Web Chat qualify despite an optional WhatsApp provider blocker", () => {
  const assessment = assessPilotReadiness({ ...ready, whatsApp: "external_verification_pending" });
  assert.equal(assessment.classification, "pilot_ready");
  assert.equal(assessment.overall, "pilot_ready");
  assert.equal(assessment.checks.find((check) => check.id === "whatsapp")?.status, "blocked");
});

test("EPIC053 PASS1 keeps an operational Web Chat pilot ready when WhatsApp platform configuration is unavailable", () => {
  const assessment = assessPilotReadiness({ ...ready, whatsApp: "platform_configuration_unavailable" });
  assert.equal(assessment.overall, "pilot_ready");
  assert.equal(assessment.classification, "pilot_ready");
  assert.equal(assessment.checks.find((check) => check.id === "whatsapp")?.status, "blocked");
  assert.notEqual(assessment.nextAction, "review_whatsapp");
  assert.equal(assessment.nextAction, null);
});

test("EPIC053 PASS1 keeps an operational Web Chat pilot ready when WhatsApp is externally blocked", () => {
  const assessment = assessPilotReadiness({ ...ready, whatsApp: "external_verification_pending" });
  assert.equal(assessment.overall, "pilot_ready");
  assert.equal(assessment.classification, "pilot_ready");
  assert.equal(assessment.nextAction, null);
});

test("EPIC053 PASS1 classifies absent qualifying channels with unavailable WhatsApp platform configuration as code_ready", () => {
  const assessment = assessPilotReadiness({ ...ready, webChat: "absent", whatsApp: "platform_configuration_unavailable" });
  assert.equal(assessment.overall, "not_ready");
  assert.equal(assessment.classification, "code_ready");
  assert.equal(assessment.nextAction, "review_whatsapp");
});

test("EPIC053 PASS1 lets operational WhatsApp qualify without Web Chat", () => {
  const assessment = assessPilotReadiness({ ...ready, webChat: "absent", whatsApp: "operational" });
  assert.equal(assessment.classification, "pilot_ready");
  assert.equal(assessment.checks.find((check) => check.id === "web_chat")?.status, "incomplete");
});

test("EPIC053 PASS1 permits usable unmanaged entitlement facts and blocks unusable commercial facts", () => {
  assert.equal(assessPilotReadiness(ready).classification, "pilot_ready");
  const missing = assessPilotReadiness({ ...ready, commercial: "entitlement_missing" });
  const ineligible = assessPilotReadiness({ ...ready, commercial: "entitlement_ineligible" });
  assert.equal(missing.classification, "setup_incomplete");
  assert.equal(missing.nextAction, "review_billing");
  assert.equal(ineligible.classification, "setup_incomplete");
  assert.equal(ineligible.checks.find((check) => check.id === "commercial_entitlement")?.status, "blocked");
});

test("EPIC053 PASS1 optional scheduling and proactive checks never block pilot readiness", () => {
  const assessment = assessPilotReadiness({ ...ready, whatsApp: "external_verification_pending", schedulingRelevant: true, proactiveRelevant: true });
  assert.equal(assessment.classification, "pilot_ready");
  assert.equal(assessment.overall, "pilot_ready");
  assert.equal(assessment.checks.find((check) => check.id === "scheduling")?.status, "incomplete");
  assert.equal(assessment.checks.find((check) => check.id === "proactive")?.status, "incomplete");
  assert.equal(assessment.checks.find((check) => check.id === "whatsapp")?.status, "blocked");
  assert.equal(assessment.nextAction, null);
});

test("EPIC053 PASS1 regresses pilot readiness from authoritative required facts", () => {
  const initial = assessPilotReadiness(ready);
  const regressed = assessPilotReadiness({ ...ready, publishedKnowledge: false });
  assert.equal(initial.classification, "pilot_ready");
  assert.equal(regressed.classification, "setup_incomplete");
  assert.equal(regressed.overall, "not_ready");
  assert.equal(regressed.nextAction, "publish_knowledge");
});

test("EPIC053 PASS1 applies deterministic next-action ordering", () => {
  const assessment = assessPilotReadiness({ ...ready, workspaceContextValid: false, company: "suspended", defaultAssistantExecutable: false, publishedKnowledge: false, commercial: "entitlement_ineligible", webChat: "inactive", whatsApp: "external_verification_pending" });
  assert.equal(assessment.nextAction, "resolve_workspace_context");
});
