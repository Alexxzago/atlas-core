import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { ConversationRepositoryPort } from "../conversation/application/ports.js";
import { reconstructConversation, reconstructConversationMessage, reconstructConversationParticipant, type Conversation, type ConversationId, type ConversationMessage, type ConversationMessageId, type ConversationParticipant, type ConversationParticipantId, type ConversationState } from "../conversation/domain/conversation.js";
import { reconstructConversationControl, type ConversationControl, type ConversationDetailProjection, type ConversationInboxProjection, type WhatsAppOutboundDeliveryProjection } from "../conversation/domain/conversationControl.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

interface ConversationRow { id:string; company_id:number; channel:Conversation["channel"]; state:ConversationState; created_at:string; updated_at:string; closed_at:string|null; }
interface ParticipantRow { id:string; conversation_id:string; participant_type:string; reference:string|null; created_at:string; }
interface MessageRow { id:string; conversation_id:string; sender_participant_id:string; direction:"inbound"|"outbound"; content:string; idempotency_key:string|null; assistant_execution_record_id:string|null; created_at:string; }
interface ControlRow { conversation_id:string; state:ConversationControl["state"]; controlling_actor_id:string|null; last_controlling_actor_id:string|null; taken_at:string|null; released_at:string|null; last_operator_activity_at:string|null; attention_reason:ConversationControl["attentionReason"]; resolved_at:string|null; resolved_by:string|null; version:number; created_at:string; updated_at:string; }

function conversation(row: ConversationRow): Conversation { return reconstructConversation({ id: row.id as ConversationId, companyId: row.company_id, channel: row.channel, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at, closedAt: row.closed_at }); }
function participant(row: ParticipantRow): ConversationParticipant { return reconstructConversationParticipant({ id: row.id as ConversationParticipantId, conversationId: row.conversation_id as ConversationId, type: row.participant_type, reference: row.reference, createdAt: row.created_at }); }
function message(row: MessageRow): ConversationMessage { return reconstructConversationMessage({ id: row.id as ConversationMessageId, conversationId: row.conversation_id as ConversationId, senderParticipantId: row.sender_participant_id as ConversationParticipantId, direction: row.direction, content: row.content, idempotencyKey: row.idempotency_key, executionRecordId: row.assistant_execution_record_id, createdAt: row.created_at }); }
function control(row: ControlRow): ConversationControl { return reconstructConversationControl({ conversationId: row.conversation_id as ConversationId, state: row.state, controllingActorId: row.controlling_actor_id as ConversationControl["controllingActorId"], lastControllingActorId: row.last_controlling_actor_id as ConversationControl["lastControllingActorId"], takenAt: row.taken_at, releasedAt: row.released_at, lastOperatorActivityAt: row.last_operator_activity_at, attentionReason: row.attention_reason, resolvedAt: row.resolved_at, resolvedBy: row.resolved_by as ConversationControl["resolvedBy"], version: row.version, createdAt: row.created_at, updatedAt: row.updated_at }); }
function bounded(value: string, maximum: number): string { return Array.from(value).slice(0, maximum).join(""); }
function deliveryCategory(direction: "inbound" | "outbound"): "received" | "sent" { return direction === "inbound" ? "received" : "sent"; }
function safeActorId(value: string | null): string | null { return value === null ? null : "masked"; }
function delivery(value: { state: WhatsAppOutboundDeliveryProjection["state"]; updated_at: string; safe_error_category: string | null } | undefined): WhatsAppOutboundDeliveryProjection | null { return value ? Object.freeze({ state: value.state, updatedAt: value.updated_at, safeErrorCategory: value.safe_error_category }) : null; }

export class ConversationRepository implements ConversationRepositoryPort {
  public constructor(private readonly db: SynchronousDatabase) {}

  public findConversation(context: WorkspaceContext, companyId: number, id: ConversationId): Conversation | null {
    const row = this.db.prepare("SELECT c.* FROM conversations c JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=?").get(context.workspaceId, companyId, id) as ConversationRow | undefined;
    return row ? conversation(row) : null;
  }

  public listConversations(context: WorkspaceContext, companyId: number): Conversation[] {
    return (this.db.prepare("SELECT c.* FROM conversations c JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? ORDER BY c.created_at DESC,c.id DESC").all(context.workspaceId, companyId) as unknown as ConversationRow[]).map(conversation);
  }

  public createConversation(context: WorkspaceContext, value: Conversation): Conversation | null {
    const result = this.db.prepare("INSERT INTO conversations(id,company_id,channel,state,created_at,updated_at,closed_at) SELECT ?,co.id,?,?,?,?,? FROM companies co WHERE co.workspace_id=? AND co.id=?").run(value.id, value.channel, value.state, value.createdAt, value.updatedAt, value.closedAt, context.workspaceId, value.companyId);
    return result.changes === 1 ? this.findConversation(context, value.companyId, value.id) : null;
  }

  public updateConversation(context: WorkspaceContext, companyId: number, value: Conversation, expectedState: "open"): boolean {
    return this.db.prepare("UPDATE conversations SET state=?,updated_at=?,closed_at=? WHERE id=? AND company_id=? AND company_id IN (SELECT id FROM companies WHERE workspace_id=? AND id=?) AND state=?").run(value.state, value.updatedAt, value.closedAt, value.id, companyId, context.workspaceId, companyId, expectedState).changes === 1;
  }

  public createParticipant(context: WorkspaceContext, companyId: number, value: ConversationParticipant): ConversationParticipant | null {
    const result = this.db.prepare("INSERT INTO conversation_participants(id,conversation_id,participant_type,reference,created_at) SELECT ?,c.id,?,?,? FROM conversations c JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=?").run(value.id, value.type, value.reference, value.createdAt, context.workspaceId, companyId, value.conversationId);
    return result.changes === 1 ? this.findParticipant(context, companyId, value.id) : null;
  }

  public listParticipants(context: WorkspaceContext, companyId: number, conversationId: ConversationId): ConversationParticipant[] {
    return (this.db.prepare("SELECT p.* FROM conversation_participants p JOIN conversations c ON c.id=p.conversation_id JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=? ORDER BY p.created_at,p.id").all(context.workspaceId, companyId, conversationId) as unknown as ParticipantRow[]).map(participant);
  }

  public createMessage(context: WorkspaceContext, companyId: number, value: ConversationMessage): ConversationMessage | null {
    const result = this.db.prepare("INSERT INTO conversation_messages(id,conversation_id,sender_participant_id,direction,content,idempotency_key,assistant_execution_record_id,created_at) SELECT ?,c.id,p.id,?,?,?,?,? FROM conversations c JOIN conversation_participants p ON p.id=? AND p.conversation_id=c.id JOIN companies co ON co.id=c.company_id LEFT JOIN assistant_execution_records r ON r.id=? AND r.company_id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=? AND (? IS NULL OR r.id IS NOT NULL)").run(value.id, value.direction, value.content, value.idempotencyKey, value.executionRecordId, value.createdAt, value.senderParticipantId, value.executionRecordId, context.workspaceId, companyId, value.conversationId, value.executionRecordId);
    return result.changes === 1 ? this.findMessage(context, companyId, value.id) : null;
  }

  public listMessages(context: WorkspaceContext, companyId: number, conversationId: ConversationId): ConversationMessage[] {
    return (this.db.prepare("SELECT m.* FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=? ORDER BY m.created_at,m.id").all(context.workspaceId, companyId, conversationId) as unknown as MessageRow[]).map(message);
  }

  public findMessage(context: WorkspaceContext, companyId: number, id: ConversationMessageId): ConversationMessage | null {
    const row = this.db.prepare("SELECT m.* FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND m.id=?").get(context.workspaceId, companyId, id) as MessageRow | undefined;
    return row ? message(row) : null;
  }

  public findParticipant(context: WorkspaceContext, companyId: number, id: ConversationParticipantId): ConversationParticipant | null {
    const row = this.db.prepare("SELECT p.* FROM conversation_participants p JOIN conversations c ON c.id=p.conversation_id JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND p.id=?").get(context.workspaceId, companyId, id) as ParticipantRow | undefined;
    return row ? participant(row) : null;
  }

  public findMessageByIdempotencyKey(context: WorkspaceContext, companyId: number, conversationId: ConversationId, idempotencyKey: string): ConversationMessage | null {
    const row = this.db.prepare("SELECT m.* FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=? AND m.idempotency_key=?").get(context.workspaceId, companyId, conversationId, idempotencyKey) as MessageRow | undefined;
    return row ? message(row) : null;
  }

  public ensureConversationControl(context: WorkspaceContext, companyId: number, id: ConversationId): ConversationControl | null {
    this.db.prepare("INSERT INTO conversation_controls(conversation_id,state,controlling_actor_id,last_controlling_actor_id,taken_at,released_at,last_operator_activity_at,attention_reason,resolved_at,resolved_by,version,created_at,updated_at) SELECT c.id,'automated',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,c.updated_at,c.updated_at FROM conversations c JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=? ON CONFLICT(conversation_id) DO NOTHING").run(context.workspaceId, companyId, id);
    return this.findConversationControl(context, companyId, id);
  }

  public findConversationControl(context: WorkspaceContext, companyId: number, id: ConversationId): ConversationControl | null {
    const row = this.db.prepare("SELECT cc.* FROM conversation_controls cc JOIN conversations c ON c.id=cc.conversation_id JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=?").get(context.workspaceId, companyId, id) as ControlRow | undefined;
    return row ? control(row) : null;
  }

  public updateConversationControl(context: WorkspaceContext, companyId: number, value: ConversationControl, expectedVersion: number): ConversationControl | null {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return null;
    const result = this.db.prepare("UPDATE conversation_controls SET state=?,controlling_actor_id=?,last_controlling_actor_id=?,taken_at=?,released_at=?,last_operator_activity_at=?,attention_reason=?,resolved_at=?,resolved_by=?,version=?,updated_at=? WHERE conversation_id=? AND version=? AND conversation_id IN (SELECT c.id FROM conversations c JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=?)").run(value.state, value.controllingActorId, value.lastControllingActorId, value.takenAt, value.releasedAt, value.lastOperatorActivityAt, value.attentionReason, value.resolvedAt, value.resolvedBy, expectedVersion + 1, value.updatedAt, value.conversationId, expectedVersion, context.workspaceId, companyId);
    return result.changes === 1 ? this.findConversationControl(context, companyId, value.conversationId) : null;
  }

  public updateConversationResolution(context: WorkspaceContext, companyId: number, id: ConversationId, expectedVersion: number, resolvedAt: string, resolvedBy: string, updatedAt: string): ConversationControl | null {
    const current = this.findConversationControl(context, companyId, id);
    if (!current || current.version !== expectedVersion) return null;
    return this.updateConversationControl(context, companyId, reconstructConversationControl({ ...current, resolvedAt, resolvedBy: resolvedBy as ConversationControl["resolvedBy"], version: expectedVersion + 1, updatedAt }), expectedVersion);
  }

  public clearConversationResolution(context: WorkspaceContext, companyId: number, id: ConversationId, expectedVersion: number, updatedAt: string): ConversationControl | null {
    const current = this.findConversationControl(context, companyId, id);
    if (!current || current.version !== expectedVersion) return null;
    return this.updateConversationControl(context, companyId, reconstructConversationControl({ ...current, resolvedAt: null, resolvedBy: null, version: expectedVersion + 1, updatedAt }), expectedVersion);
  }

  public listConversationInbox(context: WorkspaceContext, companyId: number): ConversationInboxProjection[] {
    const projections: ConversationInboxProjection[] = [];
    for (const value of this.listConversations(context, companyId)) {
      const valueControl = this.ensureConversationControl(context, companyId, value.id);
      if (valueControl) projections.push(this.inboxProjection(context, companyId, value, valueControl));
    }
    return projections;
  }

  public findConversationDetail(context: WorkspaceContext, companyId: number, id: ConversationId): ConversationDetailProjection | null {
    const current = this.findConversation(context, companyId, id);
    if (!current) return null;
    const currentControl = this.ensureConversationControl(context, companyId, id);
    if (!currentControl) return null;
    const inbox = this.inboxProjection(context, companyId, current, currentControl);
    const messages = this.listMessages(context, companyId, id).map((value) => Object.freeze({ messageId: value.id, participant: "masked", deliveryCategory: deliveryCategory(value.direction), content: bounded(value.content, 4_000), createdAt: value.createdAt, delivery: this.deliveryProjection(context, companyId, value.id) }));
    return Object.freeze({ ...inbox, messages: Object.freeze(messages) });
  }

  private inboxProjection(context: WorkspaceContext, companyId: number, value: Conversation, valueControl: ConversationControl): ConversationInboxProjection {
    const messages = this.listMessages(context, companyId, value.id);
    const latest = messages[messages.length - 1] ?? null;
    const participant = this.listParticipants(context, companyId, value.id).length === 0 ? null : "masked";
    return Object.freeze({ conversationId: value.id, channel: value.channel, state: value.state, controlState: valueControl.state, attentionReason: valueControl.attentionReason, controllingActorId: safeActorId(valueControl.controllingActorId), takenAt: valueControl.takenAt, releasedAt: valueControl.releasedAt, lastOperatorActivityAt: valueControl.lastOperatorActivityAt, resolvedAt: valueControl.resolvedAt, resolvedBy: safeActorId(valueControl.resolvedBy), controlVersion: valueControl.version, updatedAt: valueControl.updatedAt, participant, preview: latest === null ? null : bounded(latest.content, 280), deliveryCategory: latest === null ? null : deliveryCategory(latest.direction), lastActivityAt: latest?.createdAt ?? value.updatedAt, delivery: latest === null ? null : this.deliveryProjection(context, companyId, latest.id) });
  }
  private deliveryProjection(context: WorkspaceContext, companyId: number, messageId: ConversationMessageId): WhatsAppOutboundDeliveryProjection | null {
    const row = this.db.prepare("SELECT d.state,d.updated_at,d.safe_error_category FROM outbound_deliveries d JOIN provider_message_records pmr ON pmr.id=d.provider_message_record_id AND pmr.direction='outbound' AND pmr.communication_channel='whatsapp' JOIN conversation_messages m ON m.id=pmr.conversation_message_id JOIN conversations c ON c.id=m.conversation_id JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND m.id=?").get(context.workspaceId, companyId, messageId) as { state: WhatsAppOutboundDeliveryProjection["state"]; updated_at: string; safe_error_category: string | null } | undefined;
    return delivery(row);
  }
}
