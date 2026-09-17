export const activationStageIds = ["company", "knowledge", "assistant", "web_chat", "verification", "pilot_ready", "human_ops"] as const;
export type ActivationStageId = typeof activationStageIds[number];
export type ActivationStageStatus = "complete" | "incomplete";
export type ActivationStageState = "complete" | "incomplete" | "blocked" | "unavailable";
export type ActivationStageOwner = "customer" | "platform" | "external_provider" | null;
export type ActivationAction = "complete_company" | "publish_knowledge" | "configure_assistant" | "activate_web_chat" | "start_verification" | "resolve_pilot_readiness" | "review_human_operations";
export type ActivationReasonCode =
  | "company_missing" | "company_suspended" | "company_archived"
  | "default_assistant_not_executable" | "published_knowledge_missing"
  | "web_chat_not_connected" | "web_chat_inactive"
  | "verification_required" | "verification_pending" | "verification_failed" | "pilot_not_ready";

export interface ActivationStage {
  readonly id: ActivationStageId;
  readonly status: ActivationStageStatus;
  readonly state: ActivationStageState;
  readonly owner: ActivationStageOwner;
  readonly reasonCode: ActivationReasonCode | null;
  readonly action: ActivationAction;
}

export interface ActivationProjection {
  readonly stages: readonly ActivationStage[];
  readonly nextAction: ActivationAction;
  readonly evaluatedAt: string;
  readonly policyVersion: "activation-projection-v1";
}

const actions: Readonly<Record<ActivationStageId, ActivationAction>> = Object.freeze({
  company: "complete_company", knowledge: "publish_knowledge", assistant: "configure_assistant", web_chat: "activate_web_chat",
  verification: "start_verification", pilot_ready: "resolve_pilot_readiness", human_ops: "review_human_operations",
});

export interface ActivationStageFact {
  readonly state: ActivationStageState;
  readonly owner: ActivationStageOwner;
  readonly reasonCode: ActivationReasonCode | null;
}

export function projectActivation(facts: Readonly<Record<ActivationStageId, ActivationStageFact>>, evaluatedAt: string): ActivationProjection {
  const stages = activationStageIds.map((id) => Object.freeze({ id, status: facts[id].state === "complete" ? "complete" as const : "incomplete" as const, ...facts[id], action: actions[id] }));
  const next = stages.find((stage) => stage.state !== "complete")?.id ?? "human_ops";
  return Object.freeze({ stages: Object.freeze(stages), nextAction: actions[next], evaluatedAt, policyVersion: "activation-projection-v1" });
}
