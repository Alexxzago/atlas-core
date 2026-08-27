import { createHash } from "node:crypto";
import type { UserId } from "../../identity/domain/user.js";
import { conversationControlState, type ConversationControlState } from "./conversationControl.js";

export type ConversationControlOperation = "takeover" | "release" | "resolve";

export type ConversationControlOperationOutcome =
  | "applied"
  | "stale_version"
  | "controlled_by_other"
  | "not_controller";

export type ConversationControlEventType =
  | "handoff_requested"
  | "takeover_applied"
  | "takeover_rejected"
  | "release_applied"
  | "release_rejected"
  | "automation_resumed"
  | "automation_blocked"
  | "operator_message_created"
  | "assistant_message_created"
  | "inbound_message_received"
  | "conversation_reopened"
  | "conversation_resolved";

export interface ConversationAuthoritySnapshot {
  readonly state: ConversationControlState;
  readonly controllingActorId: UserId | null;
  readonly version: number;
  readonly authorityGeneration: number;
}

export type ConversationAuthorityTransition =
  | { readonly kind: "handoff_requested" }
  | { readonly kind: "takeover"; readonly actorId: UserId }
  | { readonly kind: "release"; readonly actorId: UserId }
  | { readonly kind: "resolve"; readonly actorId: UserId }
  | { readonly kind: "operator_activity"; readonly actorId: UserId };

export type ConversationControlAtomicResult =
  | {
      readonly kind: "applied";
      readonly outcome: "applied";
      readonly control: import("./conversationControl.js").ConversationControl;
    }
  | {
      readonly kind: "replayed";
      readonly outcome: ConversationControlOperationOutcome;
      readonly control: import("./conversationControl.js").ConversationControl | null;
    }
  | {
      readonly kind: "replay_mismatch";
    }
  | {
      readonly kind: "not_found";
    }
  | {
      readonly kind: "rejected";
      readonly outcome: Exclude<ConversationControlOperationOutcome, "applied">;
      readonly control: import("./conversationControl.js").ConversationControl | null;
    };

export interface ConversationControlAtomicCommand {
  readonly operationId: string;
  readonly operation: ConversationControlOperation;
  readonly actorId: UserId;
  readonly expectedVersion: number;
  readonly occurredAt: string;
}

export class ConversationAuthorityDomainError extends Error {}

const operations: readonly ConversationControlOperation[] = [
  "takeover",
  "release",
  "resolve",
];

const outcomes: readonly ConversationControlOperationOutcome[] = [
  "applied",
  "stale_version",
  "controlled_by_other",
  "not_controller",
];

const events: readonly ConversationControlEventType[] = [
  "handoff_requested",
  "takeover_applied",
  "takeover_rejected",
  "release_applied",
  "release_rejected",
  "automation_resumed",
  "automation_blocked",
  "operator_message_created",
  "assistant_message_created",
  "inbound_message_received",
  "conversation_reopened",
  "conversation_resolved",
];

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ConversationAuthorityDomainError(`${label} is invalid.`);
  }
  return value;
}

function actor(value: string): UserId {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || Array.from(normalized).length > 128) {
    throw new ConversationAuthorityDomainError("Conversation authority actor is invalid.");
  }
  return normalized as UserId;
}

export function conversationControlOperation(value: string): ConversationControlOperation {
  if (!operations.includes(value as ConversationControlOperation)) {
    throw new ConversationAuthorityDomainError("Conversation control operation is invalid.");
  }
  return value as ConversationControlOperation;
}

export function conversationControlOperationOutcome(value: string): ConversationControlOperationOutcome {
  if (!outcomes.includes(value as ConversationControlOperationOutcome)) {
    throw new ConversationAuthorityDomainError("Conversation control outcome is invalid.");
  }
  return value as ConversationControlOperationOutcome;
}

export function conversationControlEventType(value: string): ConversationControlEventType {
  if (!events.includes(value as ConversationControlEventType)) {
    throw new ConversationAuthorityDomainError("Conversation control event type is invalid.");
  }
  return value as ConversationControlEventType;
}

export function conversationControlOperationId(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (
    !normalized ||
    Array.from(normalized).length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new ConversationAuthorityDomainError("Conversation control operation id is invalid.");
  }
  return normalized;
}

export function reconstructConversationAuthority(
  value: ConversationAuthoritySnapshot,
): ConversationAuthoritySnapshot {
  const state = conversationControlState(value.state);
  const controllingActorId =
    value.controllingActorId === null ? null : actor(value.controllingActorId);

  if (state === "human_controlled" && controllingActorId === null) {
    throw new ConversationAuthorityDomainError(
      "Human-controlled authority requires a controller.",
    );
  }

  if (state !== "human_controlled" && controllingActorId !== null) {
    throw new ConversationAuthorityDomainError(
      "Non-controlled authority cannot have a controller.",
    );
  }

  return Object.freeze({
    state,
    controllingActorId,
    version: positiveInteger(value.version, "Conversation control version"),
    authorityGeneration: positiveInteger(
      value.authorityGeneration,
      "Conversation authority generation",
    ),
  });
}

export function applyConversationAuthorityTransition(
  value: ConversationAuthoritySnapshot,
  transition: ConversationAuthorityTransition,
): ConversationAuthoritySnapshot {
  const current = reconstructConversationAuthority(value);

  if (transition.kind === "handoff_requested") {
    if (current.state !== "automated") return current;
    return reconstructConversationAuthority({
      ...current,
      state: "human_required",
      version: current.version + 1,
      authorityGeneration: current.authorityGeneration + 1,
    });
  }

  const actorId = actor(transition.actorId);

  if (transition.kind === "takeover") {
    if (current.state === "human_controlled") {
      if (current.controllingActorId === actorId) return current;
      throw new ConversationAuthorityDomainError(
        "Conversation is controlled by another actor.",
      );
    }

    return reconstructConversationAuthority({
      ...current,
      state: "human_controlled",
      controllingActorId: actorId,
      version: current.version + 1,
      authorityGeneration: current.authorityGeneration + 1,
    });
  }

  if (
    current.state !== "human_controlled" ||
    current.controllingActorId !== actorId
  ) {
    throw new ConversationAuthorityDomainError(
      "Conversation actor does not control the conversation.",
    );
  }

  if (transition.kind === "operator_activity") {
    return current;
  }

  return reconstructConversationAuthority({
    ...current,
    state: transition.kind === "release" ? "human_required" : "automated",
    controllingActorId: null,
    version: current.version + 1,
    authorityGeneration: current.authorityGeneration + 1,
  });
}

export function conversationControlRequestFingerprint(input: {
  readonly operation: ConversationControlOperation;
  readonly expectedVersion: number;
  readonly actorId: UserId;
}): string {
  const operation = conversationControlOperation(input.operation);
  const expectedVersion = positiveInteger(
    input.expectedVersion,
    "Conversation control expected version",
  );
  const actorId = actor(input.actorId);

  return createHash("sha256")
    .update(JSON.stringify([operation, expectedVersion, actorId]), "utf8")
    .digest("hex");
}

export function classifyConversationControlReplay(
  storedFingerprint: string,
  incomingFingerprint: string,
): "same" | "divergent" {
  const pattern = /^[a-f0-9]{64}$/;

  if (!pattern.test(storedFingerprint) || !pattern.test(incomingFingerprint)) {
    throw new ConversationAuthorityDomainError(
      "Conversation control fingerprint is invalid.",
    );
  }

  return storedFingerprint === incomingFingerprint ? "same" : "divergent";
}
