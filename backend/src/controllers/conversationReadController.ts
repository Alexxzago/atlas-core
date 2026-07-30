import type { RequestHandler, Response } from "express";
import type { ConversationDetailProjection, ConversationInboxProjection } from "../conversation/domain/conversationControl.js";
import { ConversationNotFoundError, ConversationService, ConversationValidationError } from "../conversation/services/conversationService.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

export function createListConversationController(service: ConversationService, context: WorkspaceContext): RequestHandler {
  return (req, res): void => { try { res.json(service.listInbox(context, req.params.companyId).map(inbox)); } catch (error: unknown) { respond(res, error); } };
}
export function createGetConversationController(service: ConversationService, context: WorkspaceContext): RequestHandler {
  return (req, res): void => { try { res.json(detail(service.detail(context, req.params.companyId, req.params.conversationId))); } catch (error: unknown) { respond(res, error); } };
}
function lifecycle(value: ConversationInboxProjection["delivery"]) { return value === null ? null : { state: value.state, updatedAt: value.updatedAt, safeErrorCategory: value.safeErrorCategory }; }
function inbox(value: ConversationInboxProjection) { return { conversationId: value.conversationId, channel: value.channel, state: value.state, controlState: value.controlState, attentionReason: value.attentionReason, controllingActorId: value.controllingActorId, takenAt: value.takenAt, releasedAt: value.releasedAt, lastOperatorActivityAt: value.lastOperatorActivityAt, resolvedAt: value.resolvedAt, resolvedBy: value.resolvedBy, controlVersion: value.controlVersion, updatedAt: value.updatedAt, participant: value.participant, preview: value.preview, deliveryCategory: value.deliveryCategory, lastActivityAt: value.lastActivityAt, delivery: lifecycle(value.delivery) }; }
function detail(value: ConversationDetailProjection) { return { ...inbox(value), messages: value.messages.map((message) => ({ messageId: message.messageId, participant: message.participant, deliveryCategory: message.deliveryCategory, content: message.content, createdAt: message.createdAt, delivery: lifecycle(message.delivery) })) }; }
function respond(res: Response, error: unknown): void { if (error instanceof ConversationValidationError) { res.status(400).json({ error: error.message }); return; } if (error instanceof ConversationNotFoundError) { res.status(404).json({ error: "Conversation was not found." }); return; } res.status(500).json({ error: "Conversation could not be read." }); }
