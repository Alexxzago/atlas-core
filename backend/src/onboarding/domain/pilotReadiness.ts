export const pilotReadinessPolicyVersion = "pilot-readiness-v1";

export type PilotReadinessClassification = "setup_incomplete" | "code_ready" | "configuration_ready" | "external_provider_blocked" | "pilot_ready";
export type PilotReadinessStatus = "complete" | "incomplete" | "blocked" | "not_applicable" | "unavailable";
export type PilotReadinessBlockerOwner = "customer" | "platform" | "external_provider";
export type PilotReadinessCheckId = "workspace_context" | "company" | "default_assistant" | "published_knowledge" | "commercial_entitlement" | "operational_channel" | "web_chat" | "whatsapp" | "scheduling" | "proactive";
export type PilotReadinessReasonCode =
  | "workspace_context_invalid"
  | "company_missing"
  | "company_suspended"
  | "company_archived"
  | "default_assistant_not_executable"
  | "published_knowledge_missing"
  | "commercial_control_suspended"
  | "commercial_entitlement_missing"
  | "commercial_entitlement_ineligible"
  | "operational_channel_missing"
  | "web_chat_not_connected"
  | "web_chat_inactive"
  | "whatsapp_not_connected"
  | "whatsapp_inactive"
  | "whatsapp_platform_configuration_unavailable"
  | "whatsapp_business_verification_pending"
  | "whatsapp_validation_failed"
  | "whatsapp_health_degraded"
  | "scheduling_not_configured"
  | "proactive_not_configured";
export const pilotReadinessReasonCodes: readonly PilotReadinessReasonCode[] = Object.freeze([
  "workspace_context_invalid", "company_missing", "company_suspended", "company_archived",
  "default_assistant_not_executable", "published_knowledge_missing", "commercial_control_suspended",
  "commercial_entitlement_missing", "commercial_entitlement_ineligible", "operational_channel_missing",
  "web_chat_not_connected", "web_chat_inactive", "whatsapp_not_connected", "whatsapp_inactive",
  "whatsapp_platform_configuration_unavailable", "whatsapp_business_verification_pending",
  "whatsapp_validation_failed", "whatsapp_health_degraded", "scheduling_not_configured", "proactive_not_configured",
]);
export type PilotReadinessAction = "resolve_workspace_context" | "review_company" | "configure_assistant" | "publish_knowledge" | "review_billing" | "activate_web_chat" | "connect_whatsapp" | "review_whatsapp" | "none";

export interface PilotReadinessCheck {
  readonly id: PilotReadinessCheckId;
  readonly required: boolean;
  readonly status: PilotReadinessStatus;
  readonly owner: PilotReadinessBlockerOwner | null;
  readonly reasonCode: PilotReadinessReasonCode | null;
}

export interface PilotReadinessFacts {
  readonly workspaceContextValid: boolean;
  readonly company: "active" | "missing" | "suspended" | "archived";
  readonly defaultAssistantExecutable: boolean;
  readonly publishedKnowledge: boolean;
  readonly commercial: "usable" | "control_suspended" | "entitlement_missing" | "entitlement_ineligible";
  readonly webChat: "operational" | "inactive" | "absent";
  readonly whatsApp: "operational" | "inactive" | "absent" | "platform_configuration_unavailable" | "external_verification_pending" | "validation_failed" | "health_degraded";
  readonly schedulingRelevant: boolean;
  readonly schedulingConfigured: boolean;
  readonly proactiveRelevant: boolean;
  readonly proactiveConfigured: boolean;
}

export interface PilotReadinessAssessment {
  readonly policyVersion: typeof pilotReadinessPolicyVersion;
  readonly overall: "not_ready" | "pilot_ready";
  readonly classification: PilotReadinessClassification;
  readonly checks: readonly PilotReadinessCheck[];
  readonly nextAction: Exclude<PilotReadinessAction, "none"> | null;
}

const complete = (id: PilotReadinessCheckId, required: boolean): PilotReadinessCheck => Object.freeze({ id, required, status: "complete", owner: null, reasonCode: null });
const issue = (id: PilotReadinessCheckId, required: boolean, status: Exclude<PilotReadinessStatus, "complete" | "not_applicable">, owner: PilotReadinessBlockerOwner, reasonCode: PilotReadinessReasonCode): PilotReadinessCheck => Object.freeze({ id, required, status, owner, reasonCode });
const optional = (id: PilotReadinessCheckId, relevant: boolean, configured: boolean, reasonCode: "scheduling_not_configured" | "proactive_not_configured"): PilotReadinessCheck => !relevant ? Object.freeze({ id, required: false, status: "not_applicable", owner: null, reasonCode: null }) : configured ? complete(id, false) : issue(id, false, "incomplete", "customer", reasonCode);

/**
 * Classification precedence is deliberate: required context/setup failures win, then an
 * operational channel makes pilot_ready, followed by platform code_ready, provider blocked,
 * and configuration_ready. code_ready is never a synonym for pilot_ready. Optional checks are
 * excluded from every prerequisite.
 */
export function assessPilotReadiness(facts: PilotReadinessFacts): PilotReadinessAssessment {
  const checks: PilotReadinessCheck[] = [];
  checks.push(facts.workspaceContextValid ? complete("workspace_context", true) : issue("workspace_context", true, "unavailable", "customer", "workspace_context_invalid"));
  checks.push(facts.company === "active" ? complete("company", true) : facts.company === "missing" ? issue("company", true, "unavailable", "customer", "company_missing") : issue("company", true, "blocked", "customer", facts.company === "suspended" ? "company_suspended" : "company_archived"));
  checks.push(facts.defaultAssistantExecutable ? complete("default_assistant", true) : issue("default_assistant", true, "incomplete", "customer", "default_assistant_not_executable"));
  checks.push(facts.publishedKnowledge ? complete("published_knowledge", true) : issue("published_knowledge", true, "incomplete", "customer", "published_knowledge_missing"));
  checks.push(facts.commercial === "usable" ? complete("commercial_entitlement", true) : issue("commercial_entitlement", true, facts.commercial === "entitlement_missing" ? "unavailable" : "blocked", facts.commercial === "control_suspended" ? "platform" : "customer", facts.commercial === "control_suspended" ? "commercial_control_suspended" : facts.commercial === "entitlement_missing" ? "commercial_entitlement_missing" : "commercial_entitlement_ineligible"));
  checks.push(webChatCheck(facts.webChat));
  checks.push(whatsAppCheck(facts.whatsApp));
  const operational = facts.webChat === "operational" || facts.whatsApp === "operational";
  checks.splice(5, 0, operational ? complete("operational_channel", true) : issue("operational_channel", true, "incomplete", "customer", "operational_channel_missing"));
  checks.push(optional("scheduling", facts.schedulingRelevant, facts.schedulingConfigured, "scheduling_not_configured"));
  checks.push(optional("proactive", facts.proactiveRelevant, facts.proactiveConfigured, "proactive_not_configured"));

  // The channel gate is required for pilot_ready, but its unavailable platform/provider
  // states have their own classifications below rather than being setup_incomplete.
  const core = checks.slice(0, 5);
  const coreBlocked = core.some((check) => check.status !== "complete");
  const classification: PilotReadinessClassification = operational && !coreBlocked ? "pilot_ready"
    : coreBlocked ? "setup_incomplete"
    : facts.whatsApp === "platform_configuration_unavailable" ? "code_ready"
    : ["external_verification_pending", "validation_failed", "health_degraded"].includes(facts.whatsApp) ? "external_provider_blocked"
    : "configuration_ready";
  return Object.freeze({ policyVersion: pilotReadinessPolicyVersion, overall: classification === "pilot_ready" ? "pilot_ready" : "not_ready", classification, checks: Object.freeze(checks), nextAction: nextAction(checks, facts, classification) });
}

function webChatCheck(value: PilotReadinessFacts["webChat"]): PilotReadinessCheck { return value === "operational" ? complete("web_chat", false) : issue("web_chat", false, "incomplete", "customer", value === "inactive" ? "web_chat_inactive" : "web_chat_not_connected"); }
function whatsAppCheck(value: PilotReadinessFacts["whatsApp"]): PilotReadinessCheck {
  if (value === "operational") return complete("whatsapp", false);
  if (value === "platform_configuration_unavailable") return issue("whatsapp", false, "blocked", "platform", "whatsapp_platform_configuration_unavailable");
  if (value === "external_verification_pending") return issue("whatsapp", false, "blocked", "external_provider", "whatsapp_business_verification_pending");
  if (value === "validation_failed") return issue("whatsapp", false, "blocked", "external_provider", "whatsapp_validation_failed");
  if (value === "health_degraded") return issue("whatsapp", false, "blocked", "external_provider", "whatsapp_health_degraded");
  return issue("whatsapp", false, "incomplete", "customer", value === "inactive" ? "whatsapp_inactive" : "whatsapp_not_connected");
}
function nextAction(checks: readonly PilotReadinessCheck[], facts: PilotReadinessFacts, classification: PilotReadinessClassification): Exclude<PilotReadinessAction, "none"> | null {
  const reason = (id: PilotReadinessCheckId): PilotReadinessReasonCode | null => checks.find((check) => check.id === id)?.reasonCode ?? null;
  if (reason("workspace_context")) return "resolve_workspace_context";
  if (reason("company")) return "review_company";
  if (reason("default_assistant")) return "configure_assistant";
  if (reason("published_knowledge")) return "publish_knowledge";
  if (reason("commercial_entitlement")) return "review_billing";
  if (classification === "pilot_ready") return null;
  if (classification === "external_provider_blocked") return "review_whatsapp";
  if (classification === "code_ready") return "review_whatsapp";
  if (facts.webChat === "inactive") return "activate_web_chat";
  return facts.whatsApp === "inactive" ? "review_whatsapp" : "connect_whatsapp";
}
