import { CONVERSATION_REFERENCE_OPTION_LIMIT, conversationValue } from "../domain/conversationIntelligence.js";
import type { ConversationStateOperation } from "../application/ports.js";

const MAX_OPERATIONS = 16;
const key = /^[a-z][a-z0-9_.-]{0,63}$/;
/** The provider can propose semantics only; trusted provenance fields are rejected at this boundary. */
export function validateConversationStateOperations(value: unknown): readonly ConversationStateOperation[] {
  if (!Array.isArray(value) || value.length > MAX_OPERATIONS) throw new Error("Conversation derivation is invalid.");
  return Object.freeze(value.map((item) => operation(item)));
}
function operation(value: unknown): ConversationStateOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Conversation derivation is invalid.");
  const record = value as Record<string, unknown>;
  if (record.kind === "set_fact") { exact(record, ["kind", "key", "value"]); return { kind: "set_fact", key: string(record.key), value: conversationValue(record.value) }; }
  if (record.kind === "remove_fact") { exact(record, ["kind", "key"]); return { kind: "remove_fact", key: string(record.key) }; }
  if (record.kind === "mark_pending") { exact(record, ["kind", "key", "askedAt"]); if (typeof record.askedAt !== "boolean") throw new Error("Conversation derivation is invalid."); return { kind: "mark_pending", key: string(record.key), askedAt: record.askedAt }; }
  if (record.kind === "resolve_pending") { exact(record, ["kind", "key"]); return { kind: "resolve_pending", key: string(record.key) }; }
  if (record.kind === "set_active_intent") { exact(record, ["kind", "value"]); return { kind: "set_active_intent", value: conversationValue(record.value) }; }
  if (record.kind === "stale_reference_group") { exact(record, ["kind", "groupKind"]); return { kind: "stale_reference_group", groupKind: string(record.groupKind) }; }
  if (record.kind === "replace_reference_group") {
    exact(record, ["kind", "groupKind", "options"]); if (!Array.isArray(record.options) || record.options.length > CONVERSATION_REFERENCE_OPTION_LIMIT) throw new Error("Conversation derivation is invalid.");
    return { kind: "replace_reference_group", groupKind: string(record.groupKind), options: Object.freeze(record.options.map((option) => { if (!option || typeof option !== "object" || Array.isArray(option)) throw new Error("Conversation derivation is invalid."); const item = option as Record<string, unknown>; exact(item, ["referenceId", "label", "safePayload"]); return Object.freeze({ referenceId: string(item.referenceId), label: boundedLabel(item.label), safePayload: conversationValue(item.safePayload) }); })) };
  }
  throw new Error("Conversation derivation is invalid.");
}
function exact(record: Record<string, unknown>, keys: readonly string[]): void { if (Object.keys(record).length !== keys.length || Object.keys(record).some((item) => !keys.includes(item))) throw new Error("Conversation derivation is invalid."); }
function string(value: unknown): string { if (typeof value !== "string" || !key.test(value)) throw new Error("Conversation derivation is invalid."); return value; }
function boundedLabel(value: unknown): string { if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > 1_024) throw new Error("Conversation derivation is invalid."); return value; }
