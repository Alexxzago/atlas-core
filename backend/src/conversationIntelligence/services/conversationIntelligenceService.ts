import { randomUUID } from "node:crypto";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { ConversationMessage } from "../../conversation/domain/conversation.js";
import type { ConversationIntelligenceApplyResult, ConversationIntelligenceRepositoryPort, ConversationStateDerivationPort, ConversationStateOperation } from "../application/ports.js";
import { CONVERSATION_ACTIVE_GROUP_LIMIT, CONVERSATION_FACT_LIMIT, CONVERSATION_PENDING_LIMIT, CONVERSATION_REFERENCE_OPTION_LIMIT, CONVERSATION_STALE_GROUP_LIMIT, CONVERSATION_TOOL_MEMORY_LIMIT, conversationValue, type ConversationFactAuthority, type ConversationFactSourceKind, type ConversationIntelligenceState } from "../domain/conversationIntelligence.js";
import { validateConversationStateOperations } from "./conversationStateDerivationValidation.js";

export class ConversationIntelligenceConflictError extends Error {}
const MAX_OPERATIONS = 16;

/** Applies untrusted semantic deltas with provenance supplied exclusively by the trusted runtime. */
export class ConversationIntelligenceService {
  public constructor(private readonly states: ConversationIntelligenceRepositoryPort, private readonly derivation: ConversationStateDerivationPort, private readonly clock: { now(): string }) {}
  public async apply(context: WorkspaceContext, companyId: number, message: ConversationMessage, sourceKind: ConversationFactSourceKind = message.direction === "inbound" ? "user" : "assistant_inference"): Promise<ConversationIntelligenceApplyResult> {
    if (this.states.isApplied(context, companyId, message.conversationId, message.id)) return { kind: "applied", state: this.require(context, companyId, message.conversationId) };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = this.states.find(context, companyId, message.conversationId);
      let operations: readonly ConversationStateOperation[];
      try { operations = validateConversationStateOperations(await this.derivation.derive({ state: current, message })); }
      catch { return { kind: "skipped", reason: "derivation_unavailable", state: current }; }
      let next: ConversationIntelligenceState;
      try { next = apply(current ?? empty(message.conversationId, this.clock.now()), operations, message, sourceKind, this.clock.now()); }
      catch { return { kind: "skipped", reason: "invalid_derivation", state: current }; }
      const saved = this.states.compareAndSet(context, companyId, message.conversationId, current?.version ?? null, { state: next, appliedMessageId: message.id, sourceKind, at: this.clock.now() });
      if (saved) return { kind: "applied", state: saved };
      if (this.states.isApplied(context, companyId, message.conversationId, message.id)) return { kind: "applied", state: this.require(context, companyId, message.conversationId) };
    }
    return { kind: "skipped", reason: "conflict", state: this.states.find(context, companyId, message.conversationId) };
  }
  public state(context: WorkspaceContext, companyId: number, conversationId: ConversationMessage["conversationId"]): ConversationIntelligenceState | null { return this.states.find(context, companyId, conversationId); }
  private require(context: WorkspaceContext, companyId: number, conversationId: ConversationMessage["conversationId"]): ConversationIntelligenceState { const state = this.states.find(context, companyId, conversationId); if (!state) throw new ConversationIntelligenceConflictError("Conversation intelligence state is unavailable."); return state; }
}
function empty(conversationId: ConversationMessage["conversationId"], at: string): ConversationIntelligenceState { return Object.freeze({ conversationId, version: 0, activeIntent: null, facts: Object.freeze([]), pending: Object.freeze([]), referenceGroups: Object.freeze([]), toolMemory: Object.freeze([]), createdAt: at, updatedAt: at }); }
function apply(current: ConversationIntelligenceState, operations: readonly ConversationStateOperation[], message: ConversationMessage, sourceKind: ConversationFactSourceKind, at: string): ConversationIntelligenceState {
  if (operations.length > MAX_OPERATIONS) throw new Error("Conversation operation count is invalid.");
  const facts = new Map(current.facts.map((fact) => [fact.key, fact])), pending = new Map(current.pending.map((item) => [item.key, item])), groups = [...current.referenceGroups]; let activeIntent = current.activeIntent;
  const authority: ConversationFactAuthority = sourceKind === "user" || sourceKind === "operator" ? "human_asserted" : sourceKind === "tool" ? "tool_observed" : "assistant_inference";
  for (const operation of operations) {
    if (operation.kind === "set_fact") {
      const value = conversationValue(operation.value), previous = facts.get(operation.key);
      if (!validKey(operation.key) || (previous && !mayReplace(previous.authority, authority, previous.sourceOrder, message.createdAt))) continue;
      facts.set(operation.key, Object.freeze({ key: operation.key, value, authority, sourceKind, sourceMessageId: sourceKind === "tool" ? null : message.id, sourceToolTraceId: null, sourceOrder: message.createdAt, updatedAt: at }));
      pending.delete(operation.key);
    } else if (operation.kind === "remove_fact") {
      const previous = facts.get(operation.key); if (previous && mayRemove(previous.authority, authority)) facts.delete(operation.key);
    } else if (operation.kind === "mark_pending" && validKey(operation.key)) { if (!facts.has(operation.key) && pending.size < CONVERSATION_PENDING_LIMIT) pending.set(operation.key, Object.freeze({ key: operation.key, askedAt: operation.askedAt ? at : null, createdAt: at })); }
    else if (operation.kind === "resolve_pending") pending.delete(operation.key);
    else if (operation.kind === "set_active_intent") activeIntent = conversationValue(operation.value);
    else if (operation.kind === "stale_reference_group") groups.forEach((group, index) => { if (group.kind === operation.groupKind && group.status === "active") groups[index] = Object.freeze({ ...group, status: "stale", staleAt: at }); });
    else if (operation.kind === "replace_reference_group" && validKey(operation.groupKind) && operation.options.length <= CONVERSATION_REFERENCE_OPTION_LIMIT) {
      groups.forEach((group, index) => { if (group.kind === operation.groupKind && group.status === "active") groups[index] = Object.freeze({ ...group, status: "stale", staleAt: at }); });
      groups.push(Object.freeze({ id: `crg_${randomUUID().replaceAll("-", "")}`, kind: operation.groupKind, status: "active", sourceMessageId: message.id, sourceToolTraceId: null, createdAt: at, staleAt: null, expiresAt: null, options: Object.freeze(operation.options.map((option, index) => Object.freeze({ referenceId: option.referenceId, ordinal: index + 1, label: option.label, safePayload: conversationValue(option.safePayload) }))) }));
    }
  }
  const sortedGroups = groups.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).filter((group, index, all) => group.status === "active" ? all.filter((item) => item.status === "active").indexOf(group) < CONVERSATION_ACTIVE_GROUP_LIMIT : all.filter((item) => item.status === "stale").indexOf(group) < CONVERSATION_STALE_GROUP_LIMIT);
  return Object.freeze({ ...current, version: current.version + 1, activeIntent, facts: Object.freeze([...facts.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, CONVERSATION_FACT_LIMIT)), pending: Object.freeze([...pending.values()].slice(0, CONVERSATION_PENDING_LIMIT)), referenceGroups: Object.freeze(sortedGroups), toolMemory: Object.freeze(current.toolMemory.slice(0, CONVERSATION_TOOL_MEMORY_LIMIT)), updatedAt: at });
}
function validKey(value: string): boolean { return /^[a-z][a-z0-9_.-]{0,63}$/.test(value); }
function mayReplace(previous: ConversationFactAuthority, next: ConversationFactAuthority, previousOrder: string, nextOrder: string): boolean { if (next === "assistant_inference") return previous === "assistant_inference"; if (next === "tool_observed") return previous !== "human_asserted"; return previous !== "human_asserted" || nextOrder >= previousOrder; }
function mayRemove(previous: ConversationFactAuthority, next: ConversationFactAuthority): boolean { return next === "human_asserted" ? previous === "human_asserted" : next === "tool_observed" ? previous === "tool_observed" : previous === "assistant_inference"; }
