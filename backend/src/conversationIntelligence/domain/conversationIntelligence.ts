import type { ConversationId, ConversationMessageId } from "../../conversation/domain/conversation.js";

export const CONVERSATION_VALUE_MAX_KEY_BYTES = 64;
export const CONVERSATION_VALUE_MAX_STRING_BYTES = 1_024;
export const CONVERSATION_VALUE_MAX_DEPTH = 4;
export const CONVERSATION_VALUE_MAX_OBJECT_PROPERTIES = 16;
export const CONVERSATION_VALUE_MAX_ARRAY_ITEMS = 16;
export const CONVERSATION_VALUE_MAX_SERIALIZED_BYTES = 4_096;
export const CONVERSATION_FACT_LIMIT = 32;
export const CONVERSATION_PENDING_LIMIT = 16;
export const CONVERSATION_ACTIVE_GROUP_LIMIT = 2;
export const CONVERSATION_STALE_GROUP_LIMIT = 4;
export const CONVERSATION_REFERENCE_OPTION_LIMIT = 10;
export const CONVERSATION_TOOL_MEMORY_LIMIT = 12;

export type ConversationPrimitive = string | number | boolean | null;
export interface ConversationValueObject { readonly [key: string]: ConversationValue; }
export interface ConversationValueArray extends ReadonlyArray<ConversationValue> {}
export type ConversationValue = ConversationPrimitive | ConversationValueArray | ConversationValueObject;
export type ConversationFactAuthority = "human_asserted" | "tool_observed" | "assistant_inference";
export type ConversationFactSourceKind = "user" | "operator" | "tool" | "assistant_inference";
export interface ConversationFact { readonly key: string; readonly value: ConversationValue; readonly authority: ConversationFactAuthority; readonly sourceKind: ConversationFactSourceKind; readonly sourceMessageId: ConversationMessageId | null; readonly sourceToolTraceId: string | null; readonly sourceOrder: string; readonly updatedAt: string; }
export interface ConversationPendingItem { readonly key: string; readonly askedAt: string | null; readonly createdAt: string; }
export interface ConversationReferenceOption { readonly referenceId: string; readonly ordinal: number; readonly label: string; readonly safePayload: ConversationValue; }
export interface ConversationReferenceGroup { readonly id: string; readonly kind: string; readonly status: "active" | "stale"; readonly sourceMessageId: ConversationMessageId | null; readonly sourceToolTraceId: string | null; readonly createdAt: string; readonly staleAt: string | null; readonly expiresAt: string | null; readonly options: readonly ConversationReferenceOption[]; }
export interface ConversationToolMemory { readonly id: string; readonly traceId: string; readonly category: string; readonly value: ConversationValue; readonly createdAt: string; }
export interface ConversationIntelligenceState { readonly conversationId: ConversationId; readonly version: number; readonly activeIntent: ConversationValue | null; readonly facts: readonly ConversationFact[]; readonly pending: readonly ConversationPendingItem[]; readonly referenceGroups: readonly ConversationReferenceGroup[]; readonly toolMemory: readonly ConversationToolMemory[]; readonly createdAt: string; readonly updatedAt: string; }

export function conversationValue(value: unknown, depth = 0, seen = new WeakSet<object>()): ConversationValue {
  if (depth > CONVERSATION_VALUE_MAX_DEPTH || value === undefined || typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") throw new Error("Conversation value is invalid.");
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Conversation value is invalid.");
    if (typeof value === "string" && Buffer.byteLength(value, "utf8") > CONVERSATION_VALUE_MAX_STRING_BYTES) throw new Error("Conversation value is invalid.");
    return value;
  }
  if (typeof value !== "object" || seen.has(value) || Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) throw new Error("Conversation value is invalid.");
  seen.add(value);
  const result: ConversationValue = Array.isArray(value)
    ? Object.freeze(value.slice(0, CONVERSATION_VALUE_MAX_ARRAY_ITEMS + 1).map((item) => conversationValue(item, depth + 1, seen)))
    : Object.freeze(Object.fromEntries(Object.entries(value).slice(0, CONVERSATION_VALUE_MAX_OBJECT_PROPERTIES + 1).map(([key, item]) => {
      if (!key || Buffer.byteLength(key, "utf8") > CONVERSATION_VALUE_MAX_KEY_BYTES) throw new Error("Conversation value is invalid.");
      return [key, conversationValue(item, depth + 1, seen)];
    })));
  if ((Array.isArray(result) && result.length > CONVERSATION_VALUE_MAX_ARRAY_ITEMS) || (!Array.isArray(result) && Object.keys(result).length > CONVERSATION_VALUE_MAX_OBJECT_PROPERTIES) || Buffer.byteLength(JSON.stringify(result), "utf8") > CONVERSATION_VALUE_MAX_SERIALIZED_BYTES) throw new Error("Conversation value is invalid.");
  return result;
}
