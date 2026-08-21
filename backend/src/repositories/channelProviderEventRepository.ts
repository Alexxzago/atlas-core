import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import type { ChannelProviderEventRepositoryPort } from "../transport/application/ports.js";
import { reconstructChannelExecutionRequest, reconstructChannelProviderEvent, type ChannelExecutionMediaGateState, type ChannelExecutionRequest, type ChannelExecutionRequestId, type ChannelProviderEvent, type ChannelProviderEventId, type MediaGateRecomputeOutcome, type ProviderEventProcessingState } from "../transport/domain/providerDelivery.js";
import { communicationChannel, conversationId, conversationMessageId, reconstructConversationMessage, type ConversationMessage } from "../conversation/domain/conversation.js";
import { WhatsAppInboundMediaError, type WhatsAppInboundMedia, type WhatsAppInboundMediaFailure, type WhatsAppInboundMediaState } from "../whatsapp/domain/whatsappInboundMedia.js";

interface Row { id:string; communication_channel:string; transport_provider:string; transport_connection_id:string; external_event_id:string; state:ProviderEventProcessingState; conversation_id:string|null; conversation_message_id:string|null; created_at:string; updated_at:string; }
interface MessageRow { id:string; conversation_id:string; sender_participant_id:string; direction:"inbound"|"outbound"; content:string; idempotency_key:string|null; assistant_execution_record_id:string|null; created_at:string; }
interface RequestRow { id:string;channel_provider_event_id:string;state:string;media_gate_state:"open"|"blocked_by_media";snapshot_json:string;lease_owner:string|null;lease_expires_at:string|null;outcome:string|null;created_at:string;updated_at:string; }
interface MediaRow { id:string;workspace_id:number;company_id:number;whatsapp_connection_id:string;channel_provider_event_id:string;conversation_message_id:string;provider_media_id:string;provider_kind:WhatsAppInboundMedia["descriptor"]["kind"];declared_mime:string;safe_filename:string|null;ordinal:number;caption_present:number;state:WhatsAppInboundMediaState;media_asset_id:string|null;failure_code:WhatsAppInboundMediaFailure|null;attempt_count:number;next_attempt_at:string|null;created_at:string;updated_at:string;completed_at:string|null; }
function event(row: Row): ChannelProviderEvent { return reconstructChannelProviderEvent({ id: row.id as ChannelProviderEventId, communicationChannel: communicationChannel(row.communication_channel), transportProvider: row.transport_provider, transportConnectionId: row.transport_connection_id, externalEventId: row.external_event_id, state: row.state, conversationId: row.conversation_id === null ? null : conversationId(row.conversation_id), conversationMessageId: row.conversation_message_id === null ? null : conversationMessageId(row.conversation_message_id), createdAt: row.created_at, updatedAt: row.updated_at }); }
function message(row: MessageRow): ConversationMessage { return reconstructConversationMessage({ id: conversationMessageId(row.id), conversationId: conversationId(row.conversation_id), senderParticipantId: row.sender_participant_id as ConversationMessage["senderParticipantId"], direction: row.direction, content: row.content, idempotencyKey: row.idempotency_key, executionRecordId: row.assistant_execution_record_id, createdAt: row.created_at }); }
function request(row: RequestRow): ChannelExecutionRequest { return reconstructChannelExecutionRequest({ id: row.id as ChannelExecutionRequestId, channelProviderEventId: row.channel_provider_event_id as ChannelProviderEventId, state: row.state as ChannelExecutionRequest["state"], mediaGateState: row.media_gate_state ?? "open", snapshot: JSON.parse(row.snapshot_json) as Record<string, unknown>, leaseOwner: row.lease_owner, leaseExpiresAt: row.lease_expires_at, outcome: row.outcome, createdAt: row.created_at, updatedAt: row.updated_at }); }
function media(row:MediaRow):WhatsAppInboundMedia{return Object.freeze({id:row.id,workspaceId:row.workspace_id,companyId:row.company_id,connectionId:row.whatsapp_connection_id,eventId:row.channel_provider_event_id,conversationMessageId:row.conversation_message_id,descriptor:Object.freeze({wamid:"",providerMediaId:row.provider_media_id,kind:row.provider_kind,declaredMime:row.declared_mime,filename:row.safe_filename,caption:null,ordinal:row.ordinal}),state:row.state,mediaAssetId:row.media_asset_id,failureCode:row.failure_code,attemptCount:row.attempt_count,nextAttemptAt:row.next_attempt_at,createdAt:row.created_at,updatedAt:row.updated_at,completedAt:row.completed_at});}

export class ChannelProviderEventRepository implements ChannelProviderEventRepositoryPort {
  public constructor(private readonly db: SynchronousDatabase) {}

  public claim(value: ChannelProviderEvent): { readonly event: ChannelProviderEvent; readonly claimed: boolean } {
    const result = this.db.prepare("INSERT INTO channel_provider_events(id,communication_channel,transport_provider,transport_connection_id,external_event_id,state,conversation_id,conversation_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(transport_provider,external_event_id) DO UPDATE SET state='claimed',updated_at=excluded.updated_at WHERE channel_provider_events.state='failed'").run(value.id, value.communicationChannel, value.transportProvider, value.transportConnectionId, value.externalEventId, value.state, value.conversationId, value.conversationMessageId, value.createdAt, value.updatedAt);
    const current = this.findByTransportProviderAndExternalEventId(value.transportProvider, value.externalEventId);
    if (!current) throw new Error("Channel Provider Event could not be read after claim.");
    return { event: current, claimed: result.changes === 1 };
  }

  public findByTransportProviderAndExternalEventId(transportProvider: string, externalEventId: string): ChannelProviderEvent | null {
    const row = this.db.prepare("SELECT * FROM channel_provider_events WHERE transport_provider=? AND external_event_id=?").get(transportProvider, externalEventId) as Row | undefined;
    return row ? event(row) : null;
  }

  public updateState(id: ChannelProviderEventId, expectedState: ProviderEventProcessingState, state: ProviderEventProcessingState, updatedAt: string): ChannelProviderEvent | null {
    const result = this.db.prepare("UPDATE channel_provider_events SET state=?,updated_at=? WHERE id=? AND state=?").run(state, updatedAt, id, expectedState);
    if (result.changes !== 1) return null;
    const row = this.db.prepare("SELECT * FROM channel_provider_events WHERE id=?").get(id) as Row | undefined;
    return row ? event(row) : null;
  }
  public captureInbound(value: ChannelProviderEvent, inbound: ConversationMessage, providerMessage: import("../transport/domain/providerDelivery.js").ProviderMessageRecord): { readonly event: ChannelProviderEvent; readonly inbound: ConversationMessage; readonly claimed: boolean } {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const inserted = this.db.prepare("INSERT INTO channel_provider_events(id,communication_channel,transport_provider,transport_connection_id,external_event_id,state,conversation_id,conversation_message_id,created_at,updated_at) VALUES(?,?,?,?,?,'claimed',NULL,NULL,?,?) ON CONFLICT(transport_provider,external_event_id) DO NOTHING").run(value.id, value.communicationChannel, value.transportProvider, value.transportConnectionId, value.externalEventId, value.createdAt, value.updatedAt).changes === 1;
      let current = this.findByTransportProviderAndExternalEventId(value.transportProvider, value.externalEventId);
      if (!current) throw new Error("Channel Provider Event could not be read after capture.");
      if (current.conversationMessageId === null) {
        this.db.prepare("INSERT INTO conversation_messages(id,conversation_id,sender_participant_id,direction,content,idempotency_key,assistant_execution_record_id,created_at) SELECT ?,c.id,p.id,?,?,?,?,? FROM conversations c JOIN conversation_participants p ON p.id=? AND p.conversation_id=c.id WHERE c.id=? AND c.channel='whatsapp' ON CONFLICT DO NOTHING").run(inbound.id, inbound.direction, inbound.content, inbound.idempotencyKey, inbound.executionRecordId, inbound.createdAt, inbound.senderParticipantId, inbound.conversationId);
        const row = this.db.prepare("SELECT * FROM conversation_messages WHERE conversation_id=? AND idempotency_key=?").get(inbound.conversationId, inbound.idempotencyKey) as MessageRow | undefined;
        if (!row) throw new Error("Inbound conversation message could not be persisted.");
        const canonical = message(row);
        this.db.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING").run(providerMessage.id, providerMessage.communicationChannel, providerMessage.transportProvider, providerMessage.direction, providerMessage.transportConnectionId, canonical.id, providerMessage.externalMessageId, providerMessage.createdAt, providerMessage.updatedAt);
        this.db.prepare("UPDATE channel_provider_events SET conversation_id=?,conversation_message_id=?,updated_at=? WHERE id=? AND conversation_message_id IS NULL").run(canonical.conversationId, canonical.id, value.updatedAt, current.id);
      }
      current = this.findByTransportProviderAndExternalEventId(value.transportProvider, value.externalEventId);
      if (!current?.conversationMessageId) throw new Error("Inbound event could not be linked.");
      const row = this.db.prepare("SELECT * FROM conversation_messages WHERE id=?").get(current.conversationMessageId) as MessageRow | undefined;
      if (!row) throw new Error("Inbound conversation message could not be read.");
      this.db.exec("COMMIT;");
      return { event: current, inbound: message(row), claimed: inserted };
    } catch (error: unknown) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }
  public captureInboundExecution(value: ChannelProviderEvent, inbound: ConversationMessage, providerMessage: import("../transport/domain/providerDelivery.js").ProviderMessageRecord, execution: ChannelExecutionRequest, attachments: readonly WhatsAppInboundMedia[] = []): { readonly event: ChannelProviderEvent; readonly inbound: ConversationMessage; readonly request: ChannelExecutionRequest; readonly media: readonly WhatsAppInboundMedia[]; readonly claimed: boolean } {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const inserted = this.db.prepare("INSERT INTO channel_provider_events(id,communication_channel,transport_provider,transport_connection_id,external_event_id,state,conversation_id,conversation_message_id,created_at,updated_at) VALUES(?,?,?,?,?,'claimed',NULL,NULL,?,?) ON CONFLICT(transport_provider,external_event_id) DO NOTHING").run(value.id, value.communicationChannel, value.transportProvider, value.transportConnectionId, value.externalEventId, value.createdAt, value.updatedAt).changes === 1;
      let current = this.findByTransportProviderAndExternalEventId(value.transportProvider, value.externalEventId); if (!current) throw new Error("Channel Provider Event could not be read after capture.");
      if (!current.conversationMessageId) {
        this.db.prepare("INSERT INTO conversation_messages(id,conversation_id,sender_participant_id,direction,content,idempotency_key,assistant_execution_record_id,created_at) SELECT ?,c.id,p.id,?,?,?,?,? FROM conversations c JOIN conversation_participants p ON p.id=? AND p.conversation_id=c.id WHERE c.id=? AND c.channel='whatsapp' ON CONFLICT DO NOTHING").run(inbound.id, inbound.direction, inbound.content, inbound.idempotencyKey, inbound.executionRecordId, inbound.createdAt, inbound.senderParticipantId, inbound.conversationId);
        const row = this.db.prepare("SELECT * FROM conversation_messages WHERE conversation_id=? AND idempotency_key=?").get(inbound.conversationId, inbound.idempotencyKey) as MessageRow | undefined; if (!row) throw new Error("Inbound conversation message could not be persisted.");
        const canonical = message(row);
        this.db.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING").run(providerMessage.id, providerMessage.communicationChannel, providerMessage.transportProvider, providerMessage.direction, providerMessage.transportConnectionId, canonical.id, providerMessage.externalMessageId, providerMessage.createdAt, providerMessage.updatedAt);
        this.db.prepare("UPDATE channel_provider_events SET conversation_id=?,conversation_message_id=?,updated_at=? WHERE id=? AND conversation_message_id IS NULL").run(canonical.conversationId, canonical.id, value.updatedAt, current.id);
      }
       current = this.findByTransportProviderAndExternalEventId(value.transportProvider, value.externalEventId); if (!current?.conversationMessageId || current.transportConnectionId !== value.transportConnectionId) throw new Error("Inbound event could not be linked.");
       const scope = this.db.prepare("SELECT workspace_id,company_id FROM whatsapp_connections WHERE id=?").get(value.transportConnectionId) as {workspace_id:number;company_id:number}|undefined;
       if (!scope) throw new Error("Inbound connection could not be resolved.");
       if (attachments.some((attachment) => attachment.workspaceId !== scope.workspace_id || attachment.companyId !== scope.company_id || attachment.connectionId !== value.transportConnectionId) || (inserted && attachments.some((attachment) => attachment.eventId !== current!.id || attachment.conversationMessageId !== current!.conversationMessageId))) throw new WhatsAppInboundMediaError("media_ingest_failed");
       if (!inserted) {
         const existingMessage = this.db.prepare("SELECT conversation_id,sender_participant_id,direction,content,idempotency_key FROM conversation_messages WHERE id=?").get(current.conversationMessageId) as { conversation_id:string;sender_participant_id:string;direction:string;content:string;idempotency_key:string|null } | undefined;
         if (!existingMessage || existingMessage.conversation_id !== inbound.conversationId || existingMessage.sender_participant_id !== inbound.senderParticipantId || existingMessage.direction !== inbound.direction || existingMessage.content !== inbound.content || existingMessage.idempotency_key !== inbound.idempotencyKey) throw new Error("Inbound replay conflicts with the durable message.");
         const existingMedia = this.db.prepare("SELECT provider_media_id,provider_kind,declared_mime,safe_filename,ordinal FROM whatsapp_inbound_media WHERE whatsapp_connection_id=? AND channel_provider_event_id=? ORDER BY ordinal,provider_media_id").all(value.transportConnectionId, current.id) as Array<{provider_media_id:string;provider_kind:string;declared_mime:string;safe_filename:string|null;ordinal:number}>;
         if (existingMedia.length !== attachments.length || existingMedia.some((stored, index) => { const attachment = attachments.slice().sort((left, right) => left.descriptor.ordinal - right.descriptor.ordinal || left.descriptor.providerMediaId.localeCompare(right.descriptor.providerMediaId))[index]; return !attachment || stored.provider_media_id !== attachment.descriptor.providerMediaId || stored.provider_kind !== attachment.descriptor.kind || stored.declared_mime !== attachment.descriptor.declaredMime || stored.safe_filename !== attachment.descriptor.filename || stored.ordinal !== attachment.descriptor.ordinal; })) throw new Error("Inbound replay conflicts with the durable media descriptor.");
       }
       this.db.prepare("INSERT INTO channel_execution_requests(id,channel_provider_event_id,state,media_gate_state,snapshot_json,lease_owner,lease_expires_at,outcome,created_at,updated_at) VALUES(?,?,'pending',?,?,NULL,NULL,NULL,?,?) ON CONFLICT(channel_provider_event_id) DO NOTHING").run(execution.id, current.id, attachments.length === 0 ? "open" : "blocked_by_media", JSON.stringify(execution.snapshot), execution.createdAt, execution.updatedAt);
      const saved = this.db.prepare("SELECT * FROM channel_execution_requests WHERE channel_provider_event_id=?").get(current.id) as RequestRow | undefined; if (!saved) throw new Error("Execution request could not be persisted.");
       const row = this.db.prepare("SELECT * FROM conversation_messages WHERE id=?").get(current.conversationMessageId) as MessageRow | undefined; if (!row) throw new Error("Inbound conversation message could not be read.");
       const capturedMedia:WhatsAppInboundMedia[]=[];
       for(const attachment of attachments){
         if(attachment.connectionId!==value.transportConnectionId)throw new WhatsAppInboundMediaError("media_ingest_failed");
         this.db.prepare("INSERT INTO whatsapp_inbound_media(id,workspace_id,company_id,whatsapp_connection_id,channel_provider_event_id,conversation_message_id,provider_media_id,provider_kind,declared_mime,safe_filename,ordinal,caption_present,state,media_asset_id,failure_code,attempt_count,next_attempt_at,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'pending_download',NULL,NULL,0,NULL,?,?,NULL) ON CONFLICT(whatsapp_connection_id,channel_provider_event_id,provider_media_id,ordinal) DO NOTHING").run(attachment.id,attachment.workspaceId,attachment.companyId,attachment.connectionId,current.id,current.conversationMessageId,attachment.descriptor.providerMediaId,attachment.descriptor.kind,attachment.descriptor.declaredMime,attachment.descriptor.filename,attachment.descriptor.ordinal,attachment.descriptor.caption===null?0:1,attachment.createdAt,attachment.updatedAt);
         const stored=this.db.prepare("SELECT * FROM whatsapp_inbound_media WHERE whatsapp_connection_id=? AND channel_provider_event_id=? AND provider_media_id=? AND ordinal=?").get(attachment.connectionId,current.id,attachment.descriptor.providerMediaId,attachment.descriptor.ordinal)as MediaRow|undefined;
         if(!stored)throw new WhatsAppInboundMediaError("media_ingest_failed");
         if(stored.provider_kind!==attachment.descriptor.kind||stored.declared_mime!==attachment.descriptor.declaredMime||stored.safe_filename!==attachment.descriptor.filename)throw new WhatsAppInboundMediaError("media_mime_mismatch");
         capturedMedia.push(media(stored));
       }
       this.db.exec("COMMIT;"); return { event: current, inbound: message(row), request: request(saved), media:Object.freeze(capturedMedia), claimed: inserted };
    } catch (error: unknown) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }
  public leaseExecutionRequests(owner: string, now: string, expiresAt: string, limit: number): ChannelExecutionRequest[] {
    if (!Number.isSafeInteger(limit) || limit < 1) return [];
    this.db.exec("BEGIN IMMEDIATE;"); try {
       const rows = this.db.prepare("SELECT * FROM channel_execution_requests WHERE media_gate_state='open' AND (state='pending' OR (state='leased' AND lease_expires_at<=?)) ORDER BY created_at,id LIMIT ?").all(now, limit) as RequestRow[];
      const leased: ChannelExecutionRequest[] = [];
      for (const row of rows) if (this.db.prepare("UPDATE channel_execution_requests SET state='leased',lease_owner=?,lease_expires_at=?,updated_at=? WHERE id=? AND (state='pending' OR (state='leased' AND lease_expires_at<=?))").run(owner, expiresAt, now, row.id, now).changes === 1) leased.push(request({ ...row, state: "leased", lease_owner: owner, lease_expires_at: expiresAt, updated_at: now }));
      this.db.exec("COMMIT;"); return leased;
    } catch (error: unknown) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }
  public recomputeExecutionMediaGate(context: WorkspaceContext, companyId: number, connectionId: string, executionRequestId: ChannelExecutionRequestId, updatedAt: string): MediaGateRecomputeOutcome {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.db.prepare("SELECT r.*,e.id AS event_id,e.conversation_message_id AS event_message_id FROM channel_execution_requests r JOIN channel_provider_events e ON e.id=r.channel_provider_event_id JOIN whatsapp_connections wc ON wc.id=e.transport_connection_id JOIN companies c ON c.id=wc.company_id AND c.workspace_id=wc.workspace_id WHERE r.id=? AND wc.workspace_id=? AND wc.company_id=? AND wc.id=? AND e.communication_channel='whatsapp'").get(executionRequestId, context.workspaceId, companyId, connectionId) as (RequestRow & { event_id: string; event_message_id: string | null }) | undefined;
      if (!current) { this.db.exec("COMMIT;"); return { kind: "not_found" }; }
      const media = current.event_message_id === null ? [] : this.db.prepare("SELECT state FROM whatsapp_inbound_media WHERE workspace_id=? AND company_id=? AND whatsapp_connection_id=? AND channel_provider_event_id=? AND conversation_message_id=?").all(context.workspaceId, companyId, connectionId, current.event_id, current.event_message_id) as Array<{ state: WhatsAppInboundMediaState }>;
      if (media.length === 0) {
        this.db.exec("COMMIT;");
        return current.media_gate_state === "blocked_by_media" ? { kind: "conflict" } : { kind: "unchanged", gate: "open" };
      }
      const gate: ChannelExecutionMediaGateState = media.some((row) => row.state === "pending_download" || row.state === "ingesting") ? "blocked_by_media" : "open";
      if (current.media_gate_state === gate) { this.db.exec("COMMIT;"); return { kind: "unchanged", gate }; }
      this.db.prepare("UPDATE channel_execution_requests SET media_gate_state=?,updated_at=? WHERE id=? AND media_gate_state=?").run(gate, updatedAt, executionRequestId, current.media_gate_state);
      this.db.exec("COMMIT;");
      return { kind: "updated", gate };
    } catch (error: unknown) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }
  public findExecutionRequestIdForEvent(context: WorkspaceContext, companyId: number, connectionId: string, eventId: string): ChannelExecutionRequestId | null {
    const row = this.db.prepare("SELECT r.id FROM channel_execution_requests r JOIN channel_provider_events e ON e.id=r.channel_provider_event_id JOIN whatsapp_connections wc ON wc.id=e.transport_connection_id JOIN companies c ON c.id=wc.company_id AND c.workspace_id=wc.workspace_id WHERE e.id=? AND wc.workspace_id=? AND wc.company_id=? AND wc.id=? AND e.communication_channel='whatsapp'").get(eventId, context.workspaceId, companyId, connectionId) as { id: string } | undefined;
    return row ? row.id as ChannelExecutionRequestId : null;
  }
  public completeExecutionRequest(id: ChannelExecutionRequestId, owner: string, state: "completed" | "failed", outcome: string | null, updatedAt: string): ChannelExecutionRequest | null {
    if (this.db.prepare("UPDATE channel_execution_requests SET state=?,lease_owner=NULL,lease_expires_at=NULL,outcome=?,updated_at=? WHERE id=? AND state='leased' AND lease_owner=?").run(state, outcome, updatedAt, id, owner).changes !== 1) return null;
    const row = this.db.prepare("SELECT * FROM channel_execution_requests WHERE id=?").get(id) as RequestRow | undefined; return row ? request(row) : null;
  }
  public releaseExecutionRequest(id: ChannelExecutionRequestId, owner: string, updatedAt: string): ChannelExecutionRequest | null {
    if (this.db.prepare("UPDATE channel_execution_requests SET state='pending',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND state='leased' AND lease_owner=?").run(updatedAt, id, owner).changes !== 1) return null;
    const row = this.db.prepare("SELECT * FROM channel_execution_requests WHERE id=?").get(id) as RequestRow | undefined; return row ? request(row) : null;
  }
  public captureUnsupportedExecution(value: ChannelProviderEvent, execution: ChannelExecutionRequest): { readonly event: ChannelProviderEvent; readonly request: ChannelExecutionRequest; readonly claimed: boolean } {
    this.db.exec("BEGIN IMMEDIATE;"); try {
      const inserted = this.db.prepare("INSERT INTO channel_provider_events(id,communication_channel,transport_provider,transport_connection_id,external_event_id,state,conversation_id,conversation_message_id,created_at,updated_at) VALUES(?,?,?,?,?,'completed',NULL,NULL,?,?) ON CONFLICT(transport_provider,external_event_id) DO NOTHING").run(value.id, value.communicationChannel, value.transportProvider, value.transportConnectionId, value.externalEventId, value.createdAt, value.updatedAt).changes === 1;
      const current = this.findByTransportProviderAndExternalEventId(value.transportProvider, value.externalEventId); if (!current) throw new Error("Unsupported event could not be read after capture.");
      this.db.prepare("INSERT INTO channel_execution_requests(id,channel_provider_event_id,state,snapshot_json,lease_owner,lease_expires_at,outcome,created_at,updated_at) VALUES(?,?,'unsupported',?,NULL,NULL,'unsupported',?,?) ON CONFLICT(channel_provider_event_id) DO NOTHING").run(execution.id, current.id, JSON.stringify(execution.snapshot), execution.createdAt, execution.updatedAt);
      const saved = this.db.prepare("SELECT * FROM channel_execution_requests WHERE channel_provider_event_id=?").get(current.id) as RequestRow | undefined; if (!saved) throw new Error("Unsupported execution request could not be persisted.");
      this.db.exec("COMMIT;"); return { event: current, request: request(saved), claimed: inserted };
    } catch (error: unknown) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }
  public listRecoverable(transportProvider: string, limit: number): ChannelProviderEvent[] {
    if (!Number.isSafeInteger(limit) || limit < 1) return [];
    return (this.db.prepare("SELECT * FROM channel_provider_events WHERE transport_provider=? AND state!='completed' AND conversation_id IS NOT NULL AND conversation_message_id IS NOT NULL ORDER BY updated_at,id LIMIT ?").all(transportProvider, limit) as unknown as Row[]).map(event);
  }
  public acquireForRecovery(id: ChannelProviderEventId, staleBefore: string, updatedAt: string): ChannelProviderEvent | null {
    const result = this.db.prepare("UPDATE channel_provider_events SET state='processing',updated_at=? WHERE id=? AND (state IN ('claimed','failed') OR (state='processing' AND updated_at<=?))").run(updatedAt, id, staleBefore);
    if (result.changes !== 1) return null;
    const row = this.db.prepare("SELECT * FROM channel_provider_events WHERE id=?").get(id) as Row | undefined;
    return row ? event(row) : null;
  }
}
