import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { AssistantResponseFinalizationResult, ConversationEventFeedEntry, ConversationRepositoryPort, OperatorMessagePersistenceResult } from "../conversation/application/ports.js";
import { randomUUID } from "node:crypto";
import { whatsappContactLabel } from "../conversation/domain/conversationContactLabel.js";
import {
  applyConversationAuthorityTransition,
  classifyConversationControlReplay,
  conversationControlOperationId,
  conversationControlRequestFingerprint,
  type ConversationControlAtomicCommand,
  type ConversationControlAtomicResult,
  type ConversationControlOperationOutcome,
} from "../conversation/domain/conversationAuthority.js";
import { reconstructConversation, reconstructConversationMessage, reconstructConversationParticipant, type Conversation, type ConversationId, type ConversationMessage, type ConversationMessageId, type ConversationParticipant, type ConversationParticipantId, type ConversationState } from "../conversation/domain/conversation.js";
import { reconstructConversationControl, type ConversationControl, type ConversationDetailProjection, type ConversationInboxProjection, type WhatsAppOutboundDeliveryProjection } from "../conversation/domain/conversationControl.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

interface ConversationRow { id:string; company_id:number; channel:Conversation["channel"]; state:ConversationState; created_at:string; updated_at:string; closed_at:string|null; }
interface ParticipantRow { id:string; conversation_id:string; participant_type:string; reference:string|null; created_at:string; }
interface MessageRow { id:string; conversation_id:string; sender_participant_id:string; direction:"inbound"|"outbound"; content:string; idempotency_key:string|null; assistant_execution_record_id:string|null; created_at:string; }
interface ControlRow { conversation_id:string; state:ConversationControl["state"]; controlling_actor_id:string|null; last_controlling_actor_id:string|null; taken_at:string|null; released_at:string|null; last_operator_activity_at:string|null; attention_reason:ConversationControl["attentionReason"]; resolved_at:string|null; resolved_by:string|null; version:number; authority_generation:number; created_at:string; updated_at:string; }
interface ControlOperationRow { request_fingerprint:string; outcome:ConversationControlOperationOutcome; actor_user_id:string; operation:"takeover"|"release"|"resolve"|"resume"; resulting_control_state:ConversationControl["state"]; resulting_version:number; resulting_authority_generation:number; resulting_controller_relation:"none"|"current_actor"|"other_actor"; occurred_at:string; }

function conversation(row: ConversationRow): Conversation { return reconstructConversation({ id: row.id as ConversationId, companyId: row.company_id, channel: row.channel, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at, closedAt: row.closed_at }); }
function participant(row: ParticipantRow): ConversationParticipant { return reconstructConversationParticipant({ id: row.id as ConversationParticipantId, conversationId: row.conversation_id as ConversationId, type: row.participant_type, reference: row.reference, createdAt: row.created_at }); }
function message(row: MessageRow): ConversationMessage { return reconstructConversationMessage({ id: row.id as ConversationMessageId, conversationId: row.conversation_id as ConversationId, senderParticipantId: row.sender_participant_id as ConversationParticipantId, direction: row.direction, content: row.content, idempotencyKey: row.idempotency_key, executionRecordId: row.assistant_execution_record_id, createdAt: row.created_at }); }
function control(row: ControlRow): ConversationControl { return reconstructConversationControl({ conversationId: row.conversation_id as ConversationId, state: row.state, controllingActorId: row.controlling_actor_id as ConversationControl["controllingActorId"], lastControllingActorId: row.last_controlling_actor_id as ConversationControl["lastControllingActorId"], takenAt: row.taken_at, releasedAt: row.released_at, lastOperatorActivityAt: row.last_operator_activity_at, attentionReason: row.attention_reason, resolvedAt: row.resolved_at, resolvedBy: row.resolved_by as ConversationControl["resolvedBy"], version: row.version, authorityGeneration: row.authority_generation, createdAt: row.created_at, updatedAt: row.updated_at }); }
function bounded(value: string, maximum: number): string { return Array.from(value).slice(0, maximum).join(""); }
function deliveryCategory(direction: "inbound" | "outbound"): "received" | "sent" { return direction === "inbound" ? "received" : "sent"; }
function safeActorId(value: string | null): string | null { return value === null ? null : "masked"; }
function delivery(value: { state: WhatsAppOutboundDeliveryProjection["state"]; updated_at: string; safe_error_category: string | null } | undefined): WhatsAppOutboundDeliveryProjection | null { return value ? Object.freeze({ state: value.state, updatedAt: value.updated_at, safeErrorCategory: value.safe_error_category }) : null; }

export class ConversationRepository implements ConversationRepositoryPort {
  public hasCompany(context: WorkspaceContext, companyId: number): boolean { return this.db.prepare("SELECT 1 FROM companies WHERE workspace_id=? AND id=?").get(context.workspaceId, companyId) !== undefined; }
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
    const result = this.db.prepare("UPDATE conversation_controls SET state=?,controlling_actor_id=?,last_controlling_actor_id=?,taken_at=?,released_at=?,last_operator_activity_at=?,attention_reason=?,resolved_at=?,resolved_by=?,version=?,authority_generation=?,updated_at=? WHERE conversation_id=? AND version=? AND conversation_id IN (SELECT c.id FROM conversations c JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=?)").run(value.state, value.controllingActorId, value.lastControllingActorId, value.takenAt, value.releasedAt, value.lastOperatorActivityAt, value.attentionReason, value.resolvedAt, value.resolvedBy, expectedVersion + 1, value.authorityGeneration, value.updatedAt, value.conversationId, expectedVersion, context.workspaceId, companyId);
    return result.changes === 1 ? this.findConversationControl(context, companyId, value.conversationId) : null;
  }

  public updateConversationOperatorActivity(context: WorkspaceContext, companyId: number, id: ConversationId, actorId: import("../identity/domain/user.js").UserId, activityAt: string, updatedAt: string): ConversationControl | null {
    const result = this.db.prepare("UPDATE conversation_controls SET last_operator_activity_at=?,updated_at=? WHERE conversation_id=? AND state='human_controlled' AND controlling_actor_id=? AND conversation_id IN (SELECT c.id FROM conversations c JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=?)").run(activityAt, updatedAt, id, actorId, context.workspaceId, companyId);
    return result.changes === 1 ? this.findConversationControl(context, companyId, id) : null;
  }

  public applyConversationControlOperation(context: WorkspaceContext, companyId: number, id: ConversationId, command: ConversationControlAtomicCommand): ConversationControlAtomicResult {
    const operationId = conversationControlOperationId(command.operationId);
    const fingerprint = conversationControlRequestFingerprint(command);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const currentConversation = this.db.prepare("SELECT c.* FROM conversations c JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=? AND c.state='open'").get(context.workspaceId, companyId, id) as ConversationRow | undefined;
      if (!currentConversation) {
        this.db.exec("COMMIT");
        return Object.freeze({ kind: "not_found" });
      }

      const stored = this.db.prepare("SELECT request_fingerprint,outcome,actor_user_id,operation,resulting_control_state,resulting_version,resulting_authority_generation,resulting_controller_relation,occurred_at FROM conversation_control_operations WHERE workspace_id=? AND company_id=? AND conversation_id=? AND operation_id=?").get(context.workspaceId, companyId, id, operationId) as ControlOperationRow | undefined;
      if (stored) {
        this.db.exec("COMMIT");
        return classifyConversationControlReplay(stored.request_fingerprint, fingerprint) === "same"
          ? Object.freeze({ kind: "replayed", outcome: stored.outcome, control: replayControl(id, stored) })
          : Object.freeze({ kind: "replay_mismatch" });
      }

      this.db.prepare("INSERT INTO conversation_controls(conversation_id,state,controlling_actor_id,last_controlling_actor_id,taken_at,released_at,last_operator_activity_at,attention_reason,resolved_at,resolved_by,version,created_at,updated_at) VALUES(?,'automated',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,?,?) ON CONFLICT(conversation_id) DO NOTHING").run(id, currentConversation.updated_at, currentConversation.updated_at);
      const row = this.db.prepare("SELECT * FROM conversation_controls WHERE conversation_id=?").get(id) as ControlRow;
      const current = control(row);
      let outcome: ConversationControlOperationOutcome = "applied";
      if (current.version !== command.expectedVersion) outcome = "stale_version";
      else if (command.operation === "takeover" && current.state === "human_controlled" && current.controllingActorId !== command.actorId) outcome = "controlled_by_other";
      else if (command.operation === "resume" && current.state !== "human_required") outcome = "not_controller";
      else if (command.operation !== "takeover" && command.operation !== "resume" && (current.state !== "human_controlled" || current.controllingActorId !== command.actorId)) outcome = "not_controller";

      let next = current;
      if (outcome === "applied") {
        const authority = applyConversationAuthorityTransition(current, { kind: command.operation, actorId: command.actorId });
        if (command.operation === "takeover") next = reconstructConversationControl({ ...current, ...authority, lastControllingActorId: command.actorId, takenAt: current.state === "human_controlled" ? current.takenAt : command.occurredAt, releasedAt: null, attentionReason: "operator_follow_up", resolvedAt: null, resolvedBy: null, updatedAt: authority.version === current.version ? current.updatedAt : command.occurredAt });
        if (command.operation === "release") next = reconstructConversationControl({ ...current, ...authority, releasedAt: command.occurredAt, attentionReason: "operator_follow_up", updatedAt: command.occurredAt });
        if (command.operation === "resolve") next = reconstructConversationControl({ ...current, ...authority, releasedAt: command.occurredAt, attentionReason: null, resolvedAt: command.occurredAt, resolvedBy: command.actorId, updatedAt: command.occurredAt });
        if (command.operation === "resume") next = reconstructConversationControl({ ...current, ...authority, attentionReason: null, updatedAt: command.occurredAt });
        if (next.version !== current.version) {
          this.db.prepare("UPDATE conversation_controls SET state=?,controlling_actor_id=?,last_controlling_actor_id=?,taken_at=?,released_at=?,last_operator_activity_at=?,attention_reason=?,resolved_at=?,resolved_by=?,version=?,authority_generation=?,updated_at=? WHERE conversation_id=? AND version=?").run(next.state, next.controllingActorId, next.lastControllingActorId, next.takenAt, next.releasedAt, next.lastOperatorActivityAt, next.attentionReason, next.resolvedAt, next.resolvedBy, next.version, next.authorityGeneration, next.updatedAt, id, current.version);
        }
      }
      const result = outcome === "applied" ? next : current;
      const category = outcome === "applied" ? "success" : outcome === "stale_version" ? "conflict" : "not_found";
      const relation = result.controllingActorId === null ? "none" : result.controllingActorId === command.actorId ? "current_actor" : "other_actor";
      this.db.prepare("INSERT INTO conversation_control_operations(workspace_id,company_id,conversation_id,operation_id,actor_user_id,operation,request_fingerprint,expected_version,outcome,result_category,resulting_control_state,resulting_version,resulting_authority_generation,resulting_controller_relation,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(context.workspaceId, companyId, id, operationId, command.actorId, command.operation, fingerprint, command.expectedVersion, outcome, category, result.state, result.version, result.authorityGeneration, relation, command.occurredAt);
      const eventType = outcome === "applied" ? command.operation === "takeover" ? "takeover_applied" : command.operation === "release" ? "release_applied" : command.operation === "resolve" ? "conversation_resolved" : "automation_resumed" : command.operation === "takeover" ? "takeover_rejected" : command.operation === "release" ? "release_rejected" : "automation_blocked";
      this.db.prepare("INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,actor_user_id,control_version,authority_generation,related_message_id,related_operation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(`cev_${randomUUID().replaceAll("-", "")}`, context.workspaceId, companyId, id, eventType, command.actorId, result.version, result.authorityGeneration, null, operationId, command.occurredAt);
      this.db.exec("COMMIT");
      return outcome === "applied" ? Object.freeze({ kind: "applied", outcome, control: next }) : Object.freeze({ kind: "rejected", outcome, control: current });
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  public persistOperatorMessage(context: WorkspaceContext, companyId: number, id: ConversationId, actorId: import("../identity/domain/user.js").UserId, content: string, idempotencyKey: string, whatsAppConnectionId: string, occurredAt: string): OperatorMessagePersistenceResult {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.db.prepare("SELECT c.* FROM conversations c JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=? AND c.state='open'").get(context.workspaceId, companyId, id) as ConversationRow | undefined;
      if (!current) { this.db.exec("COMMIT"); return Object.freeze({ kind: "not_found" }); }
      const existing = this.db.prepare("SELECT m.* FROM conversation_messages m WHERE m.conversation_id=? AND m.idempotency_key=?").get(id, idempotencyKey) as MessageRow | undefined;
      if (existing) {
        this.db.exec("COMMIT");
        const value = message(existing);
        if (value.direction !== "outbound" || value.content !== content) return Object.freeze({ kind: "idempotency_mismatch" });
        const deliveryRow = this.db.prepare("SELECT d.id FROM outbound_deliveries d JOIN provider_message_records p ON p.id=d.provider_message_record_id WHERE p.conversation_message_id=? AND d.transport_connection_id=?").get(value.id, whatsAppConnectionId) as { id: string } | undefined;
        return deliveryRow ? Object.freeze({ kind: "replayed", message: value, deliveryId: deliveryRow.id }) : Object.freeze({ kind: "not_found" });
      }
      const controlRow = this.db.prepare("SELECT * FROM conversation_controls WHERE conversation_id=?").get(id) as ControlRow | undefined;
      if (!controlRow || controlRow.state !== "human_controlled" || controlRow.controlling_actor_id !== actorId) { this.db.exec("COMMIT"); return Object.freeze({ kind: "forbidden" }); }
      const participantId = `cpt_${randomUUID().replaceAll("-", "")}`;
      this.db.prepare("INSERT INTO conversation_participants(id,conversation_id,participant_type,reference,created_at) SELECT ?,?, 'human_operator',?,? WHERE NOT EXISTS(SELECT 1 FROM conversation_participants WHERE conversation_id=? AND participant_type='human_operator' AND reference=?)").run(participantId, id, actorId, occurredAt, id, actorId);
      const participantRow = this.db.prepare("SELECT * FROM conversation_participants WHERE conversation_id=? AND participant_type='human_operator' AND reference=?").get(id, actorId) as ParticipantRow;
      const messageId = `cmsg_${randomUUID().replaceAll("-", "")}`;
      this.db.prepare("INSERT INTO conversation_messages(id,conversation_id,sender_participant_id,direction,content,idempotency_key,assistant_execution_record_id,created_at) VALUES(?,?,?,'outbound',?,?,NULL,?)").run(messageId, id, participantRow.id, content, idempotencyKey, occurredAt);
      const providerMessageId = `pmr_${randomUUID().replaceAll("-", "")}`, deliveryId = `odl_${randomUUID().replaceAll("-", "")}`;
      const inserted = this.db.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) SELECT ?,'whatsapp','meta_whatsapp_cloud','outbound',?, ?,NULL,?,? WHERE EXISTS(SELECT 1 FROM whatsapp_connections WHERE id=? AND company_id=? AND status='active')").run(providerMessageId, whatsAppConnectionId, messageId, occurredAt, occurredAt, whatsAppConnectionId, companyId);
      if (inserted.changes !== 1) throw new Error("WhatsApp connection is invalid.");
      this.db.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,lease_owner,lease_expires_at,safe_error_category,created_at,updated_at) VALUES(?,?,?,'pending',0,?,NULL,NULL,NULL,?,?)").run(deliveryId, providerMessageId, whatsAppConnectionId, occurredAt, occurredAt, occurredAt);
      this.db.prepare("UPDATE conversation_controls SET last_operator_activity_at=?,updated_at=? WHERE conversation_id=? AND state='human_controlled' AND controlling_actor_id=?").run(occurredAt, occurredAt, id, actorId);
      const updatedControl = this.db.prepare("SELECT * FROM conversation_controls WHERE conversation_id=?").get(id) as ControlRow;
      this.db.prepare("INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,actor_user_id,control_version,authority_generation,related_message_id,related_operation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(`cev_${randomUUID().replaceAll("-", "")}`, context.workspaceId, companyId, id, "operator_message_created", actorId, updatedControl.version, updatedControl.authority_generation, messageId, null, occurredAt);
      this.db.exec("COMMIT");
      return Object.freeze({ kind: "created", message: message({ id: messageId, conversation_id: id, sender_participant_id: participantRow.id, direction: "outbound", content, idempotency_key: idempotencyKey, assistant_execution_record_id: null, created_at: occurredAt }), deliveryId });
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  public finalizeAssistantResponse(context: WorkspaceContext, companyId: number, id: ConversationId, inboundMessageId: ConversationMessageId, outboundParticipantId: ConversationParticipantId, executionRecordId: string, authorityGeneration: number, content: string, idempotencyKey: string, occurredAt: string, whatsAppConnectionId: string | null): AssistantResponseFinalizationResult {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.db.prepare("SELECT c.* FROM conversations c JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=? AND c.state='open'").get(context.workspaceId, companyId, id) as ConversationRow | undefined;
      if (!current) { this.db.exec("COMMIT"); return Object.freeze({ kind: "not_found" }); }
      const existing = this.db.prepare("SELECT * FROM conversation_messages WHERE conversation_id=? AND idempotency_key=?").get(id, idempotencyKey) as MessageRow | undefined;
      if (existing) { this.db.exec("COMMIT"); return existing.direction === "outbound" && existing.assistant_execution_record_id === executionRecordId ? Object.freeze({ kind: "replayed", message: message(existing) }) : Object.freeze({ kind: "execution_not_owned" }); }
      this.db.prepare("INSERT INTO conversation_controls(conversation_id,state,controlling_actor_id,last_controlling_actor_id,taken_at,released_at,last_operator_activity_at,attention_reason,resolved_at,resolved_by,version,created_at,updated_at) VALUES(?,'automated',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,?,?) ON CONFLICT(conversation_id) DO NOTHING").run(id, current.updated_at, current.updated_at);
      const currentControl = this.db.prepare("SELECT * FROM conversation_controls WHERE conversation_id=?").get(id) as ControlRow;
      const owned = this.db.prepare("SELECT id FROM assistant_execution_records WHERE id=? AND company_id=? AND purpose='operational_execution' AND json_extract(execution_snapshot_json,'$.conversationId')=? AND json_extract(execution_snapshot_json,'$.authorityGeneration')=?").get(executionRecordId, companyId, id, authorityGeneration);
      if (!owned) { this.db.exec("COMMIT"); return Object.freeze({ kind: "execution_not_owned" }); }
      if (currentControl.state === "human_controlled" || currentControl.authority_generation !== authorityGeneration) {
        const blocked = this.db.prepare("SELECT id FROM conversation_events WHERE workspace_id=? AND company_id=? AND conversation_id=? AND event_type='automation_blocked' AND related_message_id=?").get(context.workspaceId, companyId, id, inboundMessageId);
        if (!blocked) this.db.prepare("INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,actor_user_id,control_version,authority_generation,related_message_id,related_operation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(`cev_${randomUUID().replaceAll("-", "")}`, context.workspaceId, companyId, id, "automation_blocked", null, currentControl.version, currentControl.authority_generation, inboundMessageId, null, occurredAt);
        this.db.exec("COMMIT");
        return Object.freeze({ kind: "authority_lost" });
      }
      const insertedId = `cmsg_${randomUUID().replaceAll("-", "")}`;
      const inserted = this.db.prepare("INSERT INTO conversation_messages(id,conversation_id,sender_participant_id,direction,content,idempotency_key,assistant_execution_record_id,created_at) SELECT ?,c.id,p.id,'outbound',?,?,?,? FROM conversations c JOIN conversation_participants p ON p.id=? AND p.conversation_id=c.id WHERE c.id=? AND c.state='open'").run(insertedId, content, idempotencyKey, executionRecordId, occurredAt, outboundParticipantId, id);
      if (inserted.changes !== 1) throw new Error("Assistant response participant is invalid.");
      if (whatsAppConnectionId !== null) {
        const providerMessageId = `pmr_${randomUUID().replaceAll("-", "")}`, deliveryId = `odl_${randomUUID().replaceAll("-", "")}`;
        const providerInserted = this.db.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) SELECT ?,'whatsapp','meta_whatsapp_cloud','outbound',?,?,NULL,?,? WHERE EXISTS(SELECT 1 FROM whatsapp_connections WHERE id=? AND company_id=? AND status='active')").run(providerMessageId, whatsAppConnectionId, insertedId, occurredAt, occurredAt, whatsAppConnectionId, companyId);
        if (providerInserted.changes !== 1) throw new Error("WhatsApp connection is invalid.");
        const voicePolicy=this.db.prepare("SELECT voice_ai_enabled,audio_response_mode FROM whatsapp_voice_policies WHERE workspace_id=? AND company_id=? AND whatsapp_connection_id=?").get(context.workspaceId,companyId,whatsAppConnectionId) as {voice_ai_enabled:number;audio_response_mode:string}|undefined;
        if(voicePolicy?.voice_ai_enabled===1&&voicePolicy.audio_response_mode==="voice_with_text_fallback"){
          this.db.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,lease_owner,lease_expires_at,safe_error_category,payload_kind,response_policy,media_asset_id,expected_authority_generation,created_at,updated_at) VALUES(?,?,?,'blocked_by_synthesis',0,?,NULL,NULL,NULL,'deferred_voice','deferred_voice',NULL,?,?,?)").run(deliveryId,providerMessageId,whatsAppConnectionId,occurredAt,authorityGeneration,occurredAt,occurredAt);
          this.db.prepare("INSERT INTO voice_synthesis_requests(id,workspace_id,company_id,conversation_id,conversation_message_id,outbound_delivery_id,expected_authority_generation,state,lease_owner,lease_expires_at,attempt_count,safe_outcome,safe_failure_category,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,'pending',NULL,NULL,0,NULL,NULL,?,?,NULL)").run(`vsr_${randomUUID().replaceAll("-","")}`,context.workspaceId,companyId,id,insertedId,deliveryId,authorityGeneration,occurredAt,occurredAt);
        }else this.db.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,lease_owner,lease_expires_at,safe_error_category,created_at,updated_at) VALUES(?,?,?,'pending',0,?,NULL,NULL,NULL,?,?)").run(deliveryId, providerMessageId, whatsAppConnectionId, occurredAt, occurredAt, occurredAt);
      }
      this.db.prepare("INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,actor_user_id,control_version,authority_generation,related_message_id,related_operation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(`cev_${randomUUID().replaceAll("-", "")}`, context.workspaceId, companyId, id, "assistant_message_created", null, currentControl.version, currentControl.authority_generation, insertedId, null, occurredAt);
      const row = this.db.prepare("SELECT * FROM conversation_messages WHERE id=?").get(insertedId) as MessageRow;
      this.db.exec("COMMIT");
      return Object.freeze({ kind: "finalized", message: message(row) });
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
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
    for (const value of this.listConversations(context, companyId)) { const control = this.ensureConversationControl(context, companyId, value.id); if (control) projections.push(this.inboxProjection(context, companyId, value, control)); }
    return projections;
  }
  public listConversationInboxPage(context: WorkspaceContext, companyId: number, actorId: import("../identity/domain/user.js").UserId, filters: import("../conversation/domain/conversationInbox.js").ConversationInboxFilters, cursor: { readonly activity: string; readonly id: string } | null, limit: number): import("../conversation/domain/conversationInbox.js").ConversationInboxPage<ConversationInboxProjection> {
    const clauses = ["co.workspace_id=?", "c.company_id=?"];
    const params: Array<string | number | null> = [context.workspaceId, companyId];
    if (filters.controlState !== null) { clauses.push("COALESCE(cc.state,'automated')=?"); params.push(filters.controlState); }
    if (filters.state !== null) { clauses.push("c.state=?"); params.push(filters.state); }
    if (filters.channel !== null) { clauses.push("c.channel=?"); params.push(filters.channel); }
    const unread = "(SELECT COUNT(*) FROM conversation_messages um WHERE um.conversation_id=c.id AND um.direction='inbound' AND um.created_at>COALESCE(ar.read_at,''))";
    if (filters.unreadOnly) clauses.push(`${unread}>0`);
    const activity = "COALESCE((SELECT m.created_at FROM conversation_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1),c.updated_at)";
    if (cursor) { clauses.push(`(${activity}<? OR (${activity}=? AND c.id<?))`); params.push(cursor.activity, cursor.activity, cursor.id); }
    params.push(limit + 1);
    const rows = this.db.prepare(`SELECT c.id,c.channel,c.state,c.updated_at,COALESCE(cc.state,'automated') control_state,cc.attention_reason,cc.taken_at,cc.released_at,cc.last_operator_activity_at,cc.resolved_at,COALESCE(cc.version,1) control_version,latest.id latest_message_id,latest.content latest_content,latest.direction latest_direction,(SELECT p.reference FROM conversation_participants p WHERE p.conversation_id=c.id AND p.participant_type='whatsapp_contact' ORDER BY p.created_at,p.id LIMIT 1) whatsapp_reference,${activity} last_activity_at,${unread} unread_count FROM conversations c JOIN companies co ON co.id=c.company_id LEFT JOIN conversation_controls cc ON cc.conversation_id=c.id LEFT JOIN conversation_actor_reads ar ON ar.workspace_id=co.workspace_id AND ar.company_id=c.company_id AND ar.conversation_id=c.id AND ar.actor_user_id=? LEFT JOIN conversation_messages latest ON latest.id=(SELECT m.id FROM conversation_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) WHERE ${clauses.join(" AND ")} ORDER BY ${activity} DESC,c.id DESC LIMIT ?`).all(actorId, ...params) as Array<{id:string;channel:ConversationInboxProjection["channel"];state:ConversationInboxProjection["state"];updated_at:string;control_state:ConversationInboxProjection["controlState"];attention_reason:ConversationInboxProjection["attentionReason"];taken_at:string|null;released_at:string|null;last_operator_activity_at:string|null;resolved_at:string|null;control_version:number;latest_message_id:string|null;latest_content:string|null;latest_direction:"inbound"|"outbound"|null;whatsapp_reference:string|null;last_activity_at:string;unread_count:number}>;
    const page = rows.slice(0, limit).map((row) => { const contactLabel = contactLabelFor(row.channel, row.whatsapp_reference); return Object.freeze({ conversationId: row.id as ConversationInboxProjection["conversationId"], channel: row.channel, state: row.state, controlState: row.control_state, attentionReason: row.attention_reason, controllingActorId: null, takenAt: row.taken_at, releasedAt: row.released_at, lastOperatorActivityAt: row.last_operator_activity_at, resolvedAt: row.resolved_at, resolvedBy: null, controlVersion: row.control_version, updatedAt: row.updated_at, contactLabel, participant: contactLabel, preview: row.latest_content === null ? null : bounded(row.latest_content, 280), deliveryCategory: row.latest_direction === null ? null : deliveryCategory(row.latest_direction), lastActivityAt: row.last_activity_at, delivery: row.latest_message_id === null ? null : this.deliveryProjection(context, companyId, row.latest_message_id as ConversationMessageId), controlledByCurrentActor: this.isConversationControlledBy(context, companyId, row.id as ConversationInboxProjection["conversationId"], actorId), unreadCount: row.unread_count }); }) as ConversationInboxProjection[];
    const last = page[page.length - 1];
    return Object.freeze({ items: Object.freeze(page), nextCursor: rows.length > limit && last ? JSON.stringify({ activity: last.lastActivityAt, id: last.conversationId }) : null });
  }

  public findConversationDetail(context: WorkspaceContext, companyId: number, id: ConversationId, actorId?: import("../identity/domain/user.js").UserId): ConversationDetailProjection | null {
    const current = this.findConversation(context, companyId, id);
    if (!current) return null;
    const currentControl = this.ensureConversationControl(context, companyId, id);
    if (!currentControl) return null;
    const inbox = { ...this.inboxProjection(context, companyId, current, currentControl), unreadCount: actorId === undefined ? 0 : this.unreadCount(context, companyId, id, actorId) };
    const messages = this.listMessages(context, companyId, id).map((value) => { const participant = this.findParticipant(context, companyId, value.senderParticipantId); const senderRole = participant?.type === "human_operator" ? "operator" : participant?.type === "assistant" ? "assistant" : "customer"; return Object.freeze({ messageId: value.id, participant: senderRole, senderRole, deliveryCategory: deliveryCategory(value.direction), content: bounded(value.content, 4_000), createdAt: value.createdAt, delivery: this.deliveryProjection(context, companyId, value.id), voiceAvailable: this.hasVoiceReadModel(context, companyId, id, value.id) }); });
    return Object.freeze({ ...inbox, messages: Object.freeze(messages) });
  }
  public markConversationRead(context: WorkspaceContext, companyId: number, id: ConversationId, actorId: import("../identity/domain/user.js").UserId, readAt: string): boolean {
    const result = this.db.prepare("INSERT INTO conversation_actor_reads(workspace_id,company_id,conversation_id,actor_user_id,read_at,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=?) ON CONFLICT(workspace_id,company_id,conversation_id,actor_user_id) DO UPDATE SET read_at=CASE WHEN excluded.read_at>conversation_actor_reads.read_at THEN excluded.read_at ELSE conversation_actor_reads.read_at END,updated_at=excluded.updated_at").run(context.workspaceId, companyId, id, actorId, readAt, readAt, context.workspaceId, companyId, id);
    return result.changes > 0;
  }
  public isConversationControlledBy(context: WorkspaceContext, companyId: number, id: ConversationId, actorId: import("../identity/domain/user.js").UserId): boolean {
    return this.db.prepare("SELECT 1 FROM conversation_controls cc JOIN conversations c ON c.id=cc.conversation_id JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=? AND cc.state='human_controlled' AND cc.controlling_actor_id=?").get(context.workspaceId, companyId, id, actorId) !== undefined;
  }
  public conversationEventTail(context: WorkspaceContext, companyId: number): number { return Number((this.db.prepare("SELECT COALESCE(MAX(sequence),0) tail FROM conversation_events WHERE workspace_id=? AND company_id=?").get(context.workspaceId, companyId) as { tail: number }).tail); }
  public listConversationEventsAfter(context: WorkspaceContext, companyId: number, afterSequence: number, limit: number): readonly ConversationEventFeedEntry[] {
    return (this.db.prepare("SELECT sequence,id,conversation_id,event_type,control_version,authority_generation,related_message_id,occurred_at FROM conversation_events WHERE workspace_id=? AND company_id=? AND sequence>? ORDER BY sequence ASC LIMIT ?").all(context.workspaceId, companyId, afterSequence, limit) as Array<{ sequence: number; id: string; conversation_id: string; event_type: string; control_version: number | null; authority_generation: number | null; related_message_id: string | null; occurred_at: string }>).map((row) => Object.freeze({ sequence: row.sequence, eventId: row.id, conversationId: row.conversation_id as ConversationEventFeedEntry["conversationId"], type: row.event_type, controlVersion: row.control_version, authorityGeneration: row.authority_generation, relatedMessageId: row.related_message_id, occurredAt: row.occurred_at }));
  }

  private inboxProjection(context: WorkspaceContext, companyId: number, value: Conversation, valueControl: ConversationControl): ConversationInboxProjection {
    const messages = this.listMessages(context, companyId, value.id);
    const latest = messages[messages.length - 1] ?? null;
    const contactLabel = contactLabelFor(value.channel, this.whatsAppContactReference(context, companyId, value.id));
    return Object.freeze({ conversationId: value.id, channel: value.channel, state: value.state, controlState: valueControl.state, attentionReason: valueControl.attentionReason, controllingActorId: safeActorId(valueControl.controllingActorId), takenAt: valueControl.takenAt, releasedAt: valueControl.releasedAt, lastOperatorActivityAt: valueControl.lastOperatorActivityAt, resolvedAt: valueControl.resolvedAt, resolvedBy: safeActorId(valueControl.resolvedBy), controlVersion: valueControl.version, updatedAt: valueControl.updatedAt, contactLabel, participant: contactLabel, preview: latest === null ? null : bounded(latest.content, 280), deliveryCategory: latest === null ? null : deliveryCategory(latest.direction), lastActivityAt: latest?.createdAt ?? value.updatedAt, delivery: latest === null ? null : this.deliveryProjection(context, companyId, latest.id), controlledByCurrentActor: false, unreadCount: 0 });
  }
  private whatsAppContactReference(context: WorkspaceContext, companyId: number, id: ConversationId): string | null { const row = this.db.prepare("SELECT p.reference FROM conversation_participants p JOIN conversations c ON c.id=p.conversation_id JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=? AND p.participant_type='whatsapp_contact' ORDER BY p.created_at,p.id LIMIT 1").get(context.workspaceId, companyId, id) as { reference: string | null } | undefined; return row?.reference ?? null; }
  private unreadCount(context: WorkspaceContext, companyId: number, id: ConversationId, actorId: import("../identity/domain/user.js").UserId): number { return Number((this.db.prepare("SELECT COUNT(*) count FROM conversation_messages m WHERE m.conversation_id=? AND m.direction='inbound' AND m.created_at>COALESCE((SELECT read_at FROM conversation_actor_reads WHERE workspace_id=? AND company_id=? AND conversation_id=? AND actor_user_id=?),'')").get(id, context.workspaceId, companyId, id, actorId) as { count: number }).count); }
  private deliveryProjection(context: WorkspaceContext, companyId: number, messageId: ConversationMessageId): WhatsAppOutboundDeliveryProjection | null {
    const row = this.db.prepare("SELECT d.state,d.updated_at,d.safe_error_category FROM outbound_deliveries d JOIN provider_message_records pmr ON pmr.id=d.provider_message_record_id AND pmr.direction='outbound' AND pmr.communication_channel='whatsapp' JOIN conversation_messages m ON m.id=pmr.conversation_message_id JOIN conversations c ON c.id=m.conversation_id JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND m.id=?").get(context.workspaceId, companyId, messageId) as { state: WhatsAppOutboundDeliveryProjection["state"]; updated_at: string; safe_error_category: string | null } | undefined;
    return delivery(row);
  }
  private hasVoiceReadModel(context: WorkspaceContext, companyId: number, conversationId: ConversationId, messageId: ConversationMessageId): boolean {
    return this.db.prepare("SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id JOIN conversation_messages m ON m.conversation_id=c.id WHERE co.workspace_id=? AND c.company_id=? AND c.id=? AND m.id=? AND (EXISTS(SELECT 1 FROM audio_transcription_requests t WHERE t.workspace_id=co.workspace_id AND t.company_id=c.company_id AND t.conversation_id=c.id AND t.conversation_message_id=m.id) OR EXISTS(SELECT 1 FROM provider_message_records p JOIN outbound_deliveries d ON d.provider_message_record_id=p.id WHERE p.conversation_message_id=m.id AND p.communication_channel='whatsapp' AND p.direction='outbound' AND d.response_policy='deferred_voice'))").get(context.workspaceId, companyId, conversationId, messageId) !== undefined;
  }
}

function replayControl(id: ConversationId, value: ControlOperationRow): ConversationControl {
  const actorId = value.resulting_controller_relation === "current_actor" ? value.actor_user_id as ConversationControl["controllingActorId"] : null;
  const resolved = value.operation === "resolve" && value.outcome === "applied";
  return reconstructConversationControl({ conversationId: id, state: value.resulting_control_state, controllingActorId: actorId, lastControllingActorId: value.operation === "takeover" && value.outcome === "applied" ? value.actor_user_id as ConversationControl["lastControllingActorId"] : null, takenAt: value.resulting_control_state === "human_controlled" ? value.occurred_at : null, releasedAt: null, lastOperatorActivityAt: null, attentionReason: null, resolvedAt: resolved ? value.occurred_at : null, resolvedBy: resolved ? value.actor_user_id as ConversationControl["resolvedBy"] : null, version: value.resulting_version, authorityGeneration: value.resulting_authority_generation, createdAt: value.occurred_at, updatedAt: value.occurred_at });
}

function contactLabelFor(channel: ConversationInboxProjection["channel"], whatsappReference: string | null): string {
  return channel === "whatsapp" ? whatsappContactLabel(null, whatsappReference) : channel === "web_chat" ? "Web chat visitor" : "Customer";
}
