import type { UserId } from "../../identity/domain/user.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { ConversationRepositoryPort } from "../application/ports.js";
import type { ConversationControl } from "../domain/conversationControl.js";
import { reconstructConversationControl } from "../domain/conversationControl.js";
import type { ConversationService } from "./conversationService.js";

export class ConversationControlValidationError extends Error {}
export class ConversationControlNotFoundError extends Error {}
export class ConversationControlForbiddenError extends Error {}
export class ConversationControlConflictError extends Error {}

export class ConversationControlService {
  public constructor(private readonly conversations: ConversationService, private readonly controls: ConversationRepositoryPort, private readonly clock: { now(): string }) {}

  public takeOver(context: WorkspaceContext, actorId: UserId, companyIdValue: unknown, conversationIdValue: unknown, input: unknown): ConversationControl {
    const { companyId, expectedVersion } = this.input(companyIdValue, conversationIdValue, input);
    const conversation = this.conversations.get(context, companyId, conversationIdValue);
    const current = this.controls.ensureConversationControl(context, companyId, conversation.id);
    if (!current) throw new ConversationControlNotFoundError("Conversation was not found.");
    if (current.version !== expectedVersion) throw new ConversationControlConflictError("Conversation changed.");
    if (current.state === "human_controlled") {
      if (current.controllingActorId !== actorId) throw new ConversationControlForbiddenError("Conversation was not found.");
      return current;
    }
    return this.update(context, companyId, current, reconstructConversationControl({ ...current, state: "human_controlled", controllingActorId: actorId, lastControllingActorId: actorId, takenAt: this.clock.now(), releasedAt: null, attentionReason: "operator_follow_up", resolvedAt: null, resolvedBy: null, version: current.version + 1, updatedAt: this.clock.now() }));
  }

  public release(context: WorkspaceContext, actorId: UserId, companyIdValue: unknown, conversationIdValue: unknown, input: unknown): ConversationControl {
    const { companyId, expectedVersion } = this.input(companyIdValue, conversationIdValue, input);
    const conversation = this.conversations.get(context, companyId, conversationIdValue);
    const current = this.controls.ensureConversationControl(context, companyId, conversation.id);
    if (!current) throw new ConversationControlNotFoundError("Conversation was not found.");
    if (current.version !== expectedVersion) throw new ConversationControlConflictError("Conversation changed.");
    if (current.state !== "human_controlled" || current.controllingActorId !== actorId) throw new ConversationControlForbiddenError("Conversation was not found.");
    const now = this.clock.now();
    return this.update(context, companyId, current, reconstructConversationControl({ ...current, state: "human_required", controllingActorId: null, releasedAt: now, attentionReason: "operator_follow_up", version: current.version + 1, updatedAt: now }));
  }

  public resolve(context: WorkspaceContext, actorId: UserId, companyIdValue: unknown, conversationIdValue: unknown, input: unknown): ConversationControl {
    const { companyId, expectedVersion } = this.input(companyIdValue, conversationIdValue, input);
    const conversation = this.conversations.get(context, companyId, conversationIdValue);
    const current = this.controls.ensureConversationControl(context, companyId, conversation.id);
    if (!current) throw new ConversationControlNotFoundError("Conversation was not found.");
    if (current.version !== expectedVersion) throw new ConversationControlConflictError("Conversation changed.");
    if (current.state !== "human_controlled" || current.controllingActorId !== actorId) throw new ConversationControlForbiddenError("Conversation was not found.");
    const now = this.clock.now();
    return this.update(context, companyId, current, reconstructConversationControl({ ...current, state: "automated", controllingActorId: null, releasedAt: now, attentionReason: null, resolvedAt: now, resolvedBy: actorId, version: current.version + 1, updatedAt: now }));
  }

  private input(companyIdValue: unknown, conversationIdValue: unknown, input: unknown): { companyId: number; expectedVersion: number } {
    const companyId = typeof companyIdValue === "number" ? companyIdValue : typeof companyIdValue === "string" && /^\d+$/.test(companyIdValue) ? Number(companyIdValue) : NaN;
    if (!Number.isSafeInteger(companyId) || companyId < 1 || typeof conversationIdValue !== "string") throw new ConversationControlValidationError("Conversation is invalid.");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ConversationControlValidationError("Expected version is required.");
    const record = input as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || !Number.isSafeInteger(record.expectedVersion) || (record.expectedVersion as number) < 1) throw new ConversationControlValidationError("Expected version is required.");
    return { companyId, expectedVersion: record.expectedVersion as number };
  }

  private update(context: WorkspaceContext, companyId: number, current: ConversationControl, next: ConversationControl): ConversationControl {
    const updated = this.controls.updateConversationControl(context, companyId, next, current.version);
    if (!updated) throw new ConversationControlConflictError("Conversation changed.");
    return updated;
  }
}
