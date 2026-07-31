import type { RequestHandler, Response } from "express";
import type { ActorContext } from "../knowledge/domain/actorContext.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import { ConversationControlConflictError, ConversationControlForbiddenError, ConversationControlNotFoundError, ConversationControlService, ConversationControlValidationError } from "../conversation/services/conversationControlService.js";

export function createConversationControlController(service: ConversationControlService, context: WorkspaceContext, actor: ActorContext, action: "takeover" | "release" | "resolve"): RequestHandler {
  return (req, res): void => {
    try {
      const control = action === "takeover" ? service.takeOver(context, actor.userId, req.params.companyId, req.params.conversationId, req.body) : action === "release" ? service.release(context, actor.userId, req.params.companyId, req.params.conversationId, req.body) : service.resolve(context, actor.userId, req.params.companyId, req.params.conversationId, req.body);
      res.json({ control: safe(control), ...(action === "resolve" ? { outcome: "resolved" } : {}) });
    } catch (error: unknown) { respond(res, error); }
  };
}

function safe(value: import("../conversation/domain/conversationControl.js").ConversationControl) { return { controlState: value.state, attentionReason: value.attentionReason, takenAt: value.takenAt, releasedAt: value.releasedAt, lastOperatorActivityAt: value.lastOperatorActivityAt, resolvedAt: value.resolvedAt, controlVersion: value.version, updatedAt: value.updatedAt }; }
function respond(res: Response, error: unknown): void { if (error instanceof ConversationControlValidationError) { res.status(400).json({ error: error.message }); return; } if (error instanceof ConversationControlConflictError) { res.status(409).json({ error: "Conversation changed." }); return; } if (error instanceof ConversationControlForbiddenError || error instanceof ConversationControlNotFoundError) { res.status(404).json({ error: "Conversation was not found." }); return; } res.status(500).json({ error: "Conversation control could not be updated." }); }
