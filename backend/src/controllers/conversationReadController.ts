import type { RequestHandler, Response } from "express";
import type { ConversationDetailProjection, ConversationInboxProjection } from "../conversation/domain/conversationControl.js";
import { ConversationNotFoundError, ConversationService, ConversationValidationError } from "../conversation/services/conversationService.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import type { ActorContext } from "../knowledge/domain/actorContext.js";

export function createListConversationController(service: ConversationService, context: WorkspaceContext, actor: ActorContext): RequestHandler {
  return (req, res): void => { void service.listInbox(context, req.params.companyId, actor.userId, req.query).then(page => res.json({ items: page.items.map(inbox), nextCursor: page.nextCursor })).catch(respond.bind(undefined, res)); };
}
export function createGetConversationController(service: ConversationService, context: WorkspaceContext, actor: ActorContext): RequestHandler {
  return (req, res): void => { void service.detail(context, req.params.companyId, req.params.conversationId, actor.userId).then(value => res.json(detail(value))).catch(respond.bind(undefined, res)); };
}
export function createMarkConversationReadController(service: ConversationService, context: WorkspaceContext, actor: ActorContext): RequestHandler { return (req, res): void => { void service.markRead(context, req.params.companyId, req.params.conversationId, actor.userId).then(() => res.status(204).end()).catch(respond.bind(undefined, res)); }; }
function lifecycle(value: ConversationInboxProjection["delivery"]) { return value === null ? null : { state: value.state, updatedAt: value.updatedAt, safeErrorCategory: value.safeErrorCategory }; }
function inbox(value: ConversationInboxProjection) { return { conversationId: value.conversationId, channel: value.channel, state: value.state, controlState: value.controlState, controlledByCurrentActor: value.controlledByCurrentActor, attentionReason: value.attentionReason, takenAt: value.takenAt, releasedAt: value.releasedAt, lastOperatorActivityAt: value.lastOperatorActivityAt, resolvedAt: value.resolvedAt, controlVersion: value.controlVersion, updatedAt: value.updatedAt, contactLabel: value.contactLabel, participant: value.participant, preview: value.preview, deliveryCategory: value.deliveryCategory, lastActivityAt: value.lastActivityAt, delivery: lifecycle(value.delivery), unreadCount: value.unreadCount }; }
function detail(value: ConversationDetailProjection) { return { ...inbox(value), messages: value.messages.map((message) => ({ messageId: message.messageId, senderRole: message.senderRole, deliveryCategory: message.deliveryCategory, content: message.content, createdAt: message.createdAt, delivery: lifecycle(message.delivery), voiceAvailable: message.voiceAvailable })) }; }
function respond(res: Response, error: unknown): void { if (error instanceof ConversationValidationError) { res.status(400).json({ error: error.message }); return; } if (error instanceof ConversationNotFoundError) { res.status(404).json({ error: "Conversation was not found." }); return; } res.status(500).json({ error: "Conversation could not be read." }); }
