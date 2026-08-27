import type { UserId } from "../../identity/domain/user.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { ConversationRepositoryPort } from "../application/ports.js";
import type { ConversationControl } from "../domain/conversationControl.js";
import { conversationControlOperationId } from "../domain/conversationAuthority.js";
import type { ConversationService } from "./conversationService.js";

export class ConversationControlValidationError extends Error {}
export class ConversationControlNotFoundError extends Error {}
export class ConversationControlForbiddenError extends Error {}
export class ConversationControlConflictError extends Error {}

export class ConversationControlService {
  public constructor(private readonly conversations: ConversationService, private readonly controls: ConversationRepositoryPort, private readonly clock: { now(): string }) {}

  public takeOver(context: WorkspaceContext, actorId: UserId, companyIdValue: unknown, conversationIdValue: unknown, input: unknown): ConversationControl {
    return this.apply(context, actorId, companyIdValue, conversationIdValue, input, "takeover");
  }

  public release(context: WorkspaceContext, actorId: UserId, companyIdValue: unknown, conversationIdValue: unknown, input: unknown): ConversationControl {
    return this.apply(context, actorId, companyIdValue, conversationIdValue, input, "release");
  }

  public resolve(context: WorkspaceContext, actorId: UserId, companyIdValue: unknown, conversationIdValue: unknown, input: unknown): ConversationControl {
    return this.apply(context, actorId, companyIdValue, conversationIdValue, input, "resolve");
  }

  private input(companyIdValue: unknown, conversationIdValue: unknown, input: unknown): { companyId: number; expectedVersion: number; operationId: string } {
    const companyId = typeof companyIdValue === "number" ? companyIdValue : typeof companyIdValue === "string" && /^\d+$/.test(companyIdValue) ? Number(companyIdValue) : NaN;
    if (!Number.isSafeInteger(companyId) || companyId < 1 || typeof conversationIdValue !== "string") throw new ConversationControlValidationError("Conversation is invalid.");
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ConversationControlValidationError("Expected version and operation id are required.");
    const record = input as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || !Number.isSafeInteger(record.expectedVersion) || (record.expectedVersion as number) < 1 || typeof record.operationId !== "string") throw new ConversationControlValidationError("Expected version and operation id are required.");
    try {
      return { companyId, expectedVersion: record.expectedVersion as number, operationId: conversationControlOperationId(record.operationId) };
    } catch { throw new ConversationControlValidationError("Expected version and operation id are required."); }
  }

  private apply(context: WorkspaceContext, actorId: UserId, companyIdValue: unknown, conversationIdValue: unknown, input: unknown, operation: "takeover" | "release" | "resolve"): ConversationControl {
    const { companyId, expectedVersion, operationId } = this.input(companyIdValue, conversationIdValue, input);
    if (typeof conversationIdValue !== "string") throw new ConversationControlValidationError("Conversation is invalid.");
    const result = this.controls.applyConversationControlOperation(context, companyId, conversationIdValue as never, { operationId, operation, actorId, expectedVersion, occurredAt: this.clock.now() });
    if (result.kind === "not_found") throw new ConversationControlNotFoundError("Conversation was not found.");
    if (result.kind === "replay_mismatch") throw new ConversationControlConflictError("Conversation changed.");
    if ((result.kind === "rejected" || result.kind === "replayed") && result.outcome === "stale_version") throw new ConversationControlConflictError("Conversation changed.");
    if ((result.kind === "rejected" || result.kind === "replayed") && result.outcome !== "applied") throw new ConversationControlForbiddenError("Conversation was not found.");
    if (result.control === null) throw new ConversationControlConflictError("Conversation changed.");
    return result.control;
  }
}
