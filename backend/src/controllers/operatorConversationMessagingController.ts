import type { RequestHandler, Response } from "express";
import type { ActorContext } from "../knowledge/domain/actorContext.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import { OperatorConversationMessageForbiddenError, OperatorConversationMessageNotFoundError, OperatorConversationMessageValidationError, OperatorConversationMessagingService } from "../conversation/services/operatorConversationMessagingService.js";

export function createOperatorConversationMessageController(service: OperatorConversationMessagingService, context: WorkspaceContext, actor: ActorContext): RequestHandler { return (req, res): void => { void service.send(context, actor.userId, req.params.companyId, req.params.conversationId, req.body).then((value) => res.status(201).json(value)).catch((error: unknown) => respond(res, error)); }; }
function respond(res: Response, error: unknown): void { if (error instanceof OperatorConversationMessageValidationError) { res.status(400).json({ error: error.message }); return; } if (error instanceof OperatorConversationMessageForbiddenError || error instanceof OperatorConversationMessageNotFoundError) { res.status(404).json({ error: "Conversation was not found." }); return; } res.status(500).json({ error: "Conversation message could not be sent." }); }
