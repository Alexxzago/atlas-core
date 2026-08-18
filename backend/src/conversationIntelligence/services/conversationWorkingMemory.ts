import type { ConversationIntelligenceState } from "../domain/conversationIntelligence.js";
export const CONVERSATION_WORKING_MEMORY_MAX_BYTES = 8 * 1024;
/** Deterministic, data-only projection. Values are serialized rather than interpreted as instructions. */
export function conversationWorkingMemory(state: ConversationIntelligenceState): string {
   const value = { activeIntent: state.activeIntent, facts: [...state.facts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 32), pending: state.pending.slice(0, 16), activeReferenceGroups: state.referenceGroups.filter((group) => group.status === "active").sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 2), toolMemory: state.toolMemory.slice(0, 6) };
  const json = JSON.stringify(value); if (Buffer.byteLength(json, "utf8") <= CONVERSATION_WORKING_MEMORY_MAX_BYTES) return json;
  const bounded: { facts: unknown[]; pending: unknown[] } = { facts: [], pending: [] };
  for (const item of [...value.facts, ...value.pending]) {
    const destination = "key" in item && "value" in item ? bounded.facts : bounded.pending;
    destination.push(item);
    if (Buffer.byteLength(JSON.stringify(bounded), "utf8") > CONVERSATION_WORKING_MEMORY_MAX_BYTES) destination.pop();
  }
  return JSON.stringify(bounded);
}
