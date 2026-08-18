import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { ConversationId } from "../../conversation/domain/conversation.js";
import { conversationValue } from "../domain/conversationIntelligence.js";
import type { ConversationToolMemoryCandidate, ConversationToolMemoryRepositoryPort } from "../application/ports.js";

const MAX_ATTEMPTS = 2;

/** Coordinates optimistic trace-memory appends without making a completed turn depend on memory storage. */
export class ConversationToolMemoryCoordinator {
  public constructor(private readonly repository: ConversationToolMemoryRepositoryPort, private readonly clock: { now(): string }) {}

  public async append(context: WorkspaceContext, companyId: number, conversationId: ConversationId, candidates: readonly { readonly traceId: string; readonly value: unknown; readonly facts?: readonly { readonly key: string; readonly value: unknown }[]; readonly referenceGroups?: readonly { readonly groupKind: string; readonly options: readonly { readonly referenceId: string; readonly label: string; readonly safePayload: unknown }[] }[] }[]): Promise<void> {
    const normalized = normalize(candidates);
    if (normalized.length === 0) return;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const version = await this.repository.findVersion(context, companyId, conversationId);
      if (version === null) return;
      const result = await this.repository.append(context, companyId, conversationId, version, normalized, this.clock.now());
      if (result.kind !== "conflict") return;
    }
  }
}

function normalize(candidates: readonly { readonly traceId: string; readonly value: unknown; readonly facts?: readonly { readonly key: string; readonly value: unknown }[]; readonly referenceGroups?: readonly { readonly groupKind: string; readonly options: readonly { readonly referenceId: string; readonly label: string; readonly safePayload: unknown }[] }[] }[]): readonly ConversationToolMemoryCandidate[] {
  const unique = new Map<string, ConversationToolMemoryCandidate>();
  for (const candidate of candidates) {
    if (!/^ttr_[a-f0-9]{32}$/i.test(candidate.traceId) || unique.has(candidate.traceId)) continue;
    try { unique.set(candidate.traceId, Object.freeze({ traceId: candidate.traceId, value: conversationValue(candidate.value), facts: Object.freeze((candidate.facts ?? []).filter((fact) => validKey(fact.key)).map((fact) => Object.freeze({ key: fact.key, value: conversationValue(fact.value) }))), referenceGroups: Object.freeze((candidate.referenceGroups ?? []).filter((group) => validKey(group.groupKind) && group.options.length <= 10).map((group) => Object.freeze({ groupKind: group.groupKind, options: Object.freeze(group.options.map((option) => { if (!validKey(option.referenceId) || typeof option.label !== "string" || !option.label.trim() || Buffer.byteLength(option.label, "utf8") > 1_024) throw new Error(); return Object.freeze({ referenceId: option.referenceId, label: option.label, safePayload: conversationValue(option.safePayload) }); })) }))) })); }
    catch { /* Tool projections are optional and invalid candidates are intentionally ignored. */ }
  }
  return Object.freeze([...unique.values()]);
}
function validKey(value: string): boolean { return /^[a-z][a-z0-9_.-]{0,63}$/.test(value); }
