import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { OutboundDeliveryRepositoryPort } from "../transport/application/ports.js";
import { providerExternalMessageId, reconstructOutboundDelivery, type OutboundDelivery, type OutboundDeliveryId, type OutboundDeliveryState } from "../transport/domain/providerDelivery.js";

interface Row { id:string; provider_message_record_id:string; transport_connection_id:string; state:OutboundDeliveryState; attempt_count:number; next_attempt_at:string; lease_owner:string|null; lease_expires_at:string|null; safe_error_category:string|null; payload_kind:"text"|"deferred_voice"|"audio"; response_policy:"standard"|"deferred_voice"; media_asset_id:string|null; expected_authority_generation:number|null; send_started_at:string|null; created_at:string; updated_at:string; }
function delivery(row: Row): OutboundDelivery { return reconstructOutboundDelivery({ id: row.id as OutboundDeliveryId, providerMessageRecordId: row.provider_message_record_id as OutboundDelivery["providerMessageRecordId"], transportConnectionId: row.transport_connection_id, state: row.state, attemptCount: row.attempt_count, nextAttemptAt: row.next_attempt_at, leaseOwner: row.lease_owner, leaseExpiresAt: row.lease_expires_at, safeErrorCategory: row.safe_error_category, payloadKind:row.payload_kind, responsePolicy:row.response_policy,mediaAssetId:row.media_asset_id,expectedAuthorityGeneration:row.expected_authority_generation,sendStartedAt:row.send_started_at, createdAt: row.created_at, updatedAt: row.updated_at }); }

export class OutboundDeliveryRepository implements OutboundDeliveryRepositoryPort {
  public constructor(private readonly db: SynchronousDatabase) {}

  public create(value: OutboundDelivery): OutboundDelivery | null {
    const result = this.db.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,lease_owner,lease_expires_at,safe_error_category,created_at,updated_at) SELECT ?,pmr.id,?,?,?,?,?,?,?,?,? FROM provider_message_records pmr WHERE pmr.id=? AND pmr.transport_connection_id=? AND pmr.direction='outbound' ON CONFLICT(provider_message_record_id,transport_connection_id) DO NOTHING").run(value.id, value.transportConnectionId, value.state, value.attemptCount, value.nextAttemptAt, value.leaseOwner, value.leaseExpiresAt, value.safeErrorCategory, value.createdAt, value.updatedAt, value.providerMessageRecordId, value.transportConnectionId);
    return result.changes === 1 ? this.findById(value.id) : null;
  }

  public findById(id: OutboundDeliveryId): OutboundDelivery | null {
    const row = this.db.prepare("SELECT * FROM outbound_deliveries WHERE id=?").get(id) as Row | undefined;
    return row ? delivery(row) : null;
  }
  public findByProviderMessageRecordAndConnection(providerMessageRecordId: string, transportConnectionId: string): OutboundDelivery | null {
    const row = this.db.prepare("SELECT * FROM outbound_deliveries WHERE provider_message_record_id=? AND transport_connection_id=?").get(providerMessageRecordId, transportConnectionId) as Row | undefined;
    return row ? delivery(row) : null;
  }
  public updateState(id: OutboundDeliveryId, state: OutboundDelivery["state"], safeErrorCategory: string | null, updatedAt: string): OutboundDelivery | null { const result=this.db.prepare("UPDATE outbound_deliveries SET state=?,safe_error_category=?,updated_at=? WHERE id=?").run(state,safeErrorCategory,updatedAt,id); return result.changes===1?this.findById(id):null; }
  public compareAndSetState(id: OutboundDeliveryId, expectedState: OutboundDelivery["state"], state: OutboundDelivery["state"], safeErrorCategory: string | null, updatedAt: string): OutboundDelivery | null { const result=this.db.prepare("UPDATE outbound_deliveries SET state=?,safe_error_category=?,updated_at=? WHERE id=? AND state=?").run(state,safeErrorCategory,updatedAt,id,expectedState); return result.changes===1?this.findById(id):null; }
  public leaseReady(owner: string, now: string, expiresAt: string, limit: number): OutboundDelivery[] {
    if (!Number.isSafeInteger(limit) || limit < 1) return [];
    const leased: OutboundDelivery[] = [];
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db.prepare("UPDATE outbound_deliveries SET state='uncertain',lease_owner=NULL,lease_expires_at=NULL,safe_error_category='send_outcome_unknown',updated_at=? WHERE state='leased' AND send_started_at IS NOT NULL").run(now);
      const rows = this.db.prepare("SELECT d.id FROM outbound_deliveries d JOIN provider_message_records p ON p.id=d.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id WHERE (d.payload_kind='text' OR (d.payload_kind='audio' AND EXISTS(SELECT 1 FROM whatsapp_outbound_media_uploads u WHERE u.outbound_delivery_id=d.id AND u.state='uploaded' AND u.provider_media_id IS NOT NULL))) AND ((d.state IN ('pending','retryable') AND d.next_attempt_at<=?) OR (d.state='leased' AND d.lease_expires_at<=? AND d.send_started_at IS NULL)) AND NOT EXISTS(SELECT 1 FROM outbound_deliveries earlier JOIN provider_message_records earlier_p ON earlier_p.id=earlier.provider_message_record_id JOIN conversation_messages earlier_m ON earlier_m.id=earlier_p.conversation_message_id WHERE earlier_m.conversation_id=m.conversation_id AND earlier.rowid<d.rowid AND earlier.state IN ('pending','leased','retryable','uncertain','blocked_by_synthesis')) ORDER BY d.next_attempt_at,d.rowid LIMIT ?").all(now, now, limit) as Array<{ id: OutboundDeliveryId }>;
      for (const row of rows) {
        const result = this.db.prepare("UPDATE outbound_deliveries SET state='leased',attempt_count=attempt_count+1,lease_owner=?,lease_expires_at=?,updated_at=? WHERE id=? AND (payload_kind='text' OR (payload_kind='audio' AND EXISTS(SELECT 1 FROM whatsapp_outbound_media_uploads u WHERE u.outbound_delivery_id=outbound_deliveries.id AND u.state='uploaded' AND u.provider_media_id IS NOT NULL))) AND ((state IN ('pending','retryable') AND next_attempt_at<=?) OR (state='leased' AND lease_expires_at<=? AND send_started_at IS NULL)) AND NOT EXISTS(SELECT 1 FROM outbound_deliveries d JOIN provider_message_records p ON p.id=d.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id JOIN outbound_deliveries earlier ON earlier.rowid<d.rowid JOIN provider_message_records earlier_p ON earlier_p.id=earlier.provider_message_record_id JOIN conversation_messages earlier_m ON earlier_m.id=earlier_p.conversation_message_id WHERE d.id=? AND earlier_m.conversation_id=m.conversation_id AND earlier.state IN ('pending','leased','retryable','uncertain','blocked_by_synthesis'))").run(owner, expiresAt, now, row.id, now, now, row.id);
        if (result.changes === 1) { const value = this.findById(row.id); if (value) leased.push(value); }
      }
      this.db.exec("COMMIT;");
      return leased;
    } catch (error: unknown) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }
  public authorizeLease(id: OutboundDeliveryId, owner: string, at: string): boolean {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.db.prepare("SELECT d.expected_authority_generation,c.id AS conversation_id,cc.state AS control_state,cc.authority_generation FROM outbound_deliveries d JOIN provider_message_records p ON p.id=d.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id JOIN conversations c ON c.id=m.conversation_id LEFT JOIN conversation_controls cc ON cc.conversation_id=c.id WHERE d.id=? AND d.state='leased' AND d.lease_owner=?").get(id, owner) as { expected_authority_generation:number|null; conversation_id:string; control_state:string|null; authority_generation:number|null }|undefined;
      if (!current) { this.db.exec("COMMIT;"); return false; }
      if (current.expected_authority_generation === null || (current.control_state === "automated" && current.authority_generation === current.expected_authority_generation)) { this.db.exec("COMMIT;"); return true; }
      this.db.prepare("UPDATE outbound_deliveries SET state='suppressed',lease_owner=NULL,lease_expires_at=NULL,safe_error_category=NULL,updated_at=? WHERE id=? AND state='leased' AND lease_owner=?").run(at, id, owner);
      this.db.exec("COMMIT;");
      return false;
    } catch (error: unknown) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }
  public beginSend(id: OutboundDeliveryId, owner: string, at: string): boolean {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.db.prepare("SELECT d.response_policy,d.expected_authority_generation,cc.state AS control_state,cc.authority_generation,p.voice_ai_enabled,p.audio_response_mode FROM outbound_deliveries d JOIN provider_message_records p0 ON p0.id=d.provider_message_record_id JOIN conversation_messages m ON m.id=p0.conversation_message_id LEFT JOIN conversation_controls cc ON cc.conversation_id=m.conversation_id LEFT JOIN whatsapp_voice_policies p ON p.whatsapp_connection_id=d.transport_connection_id WHERE d.id=? AND d.state='leased' AND d.lease_owner=? AND d.send_started_at IS NULL").get(id, owner) as { response_policy: "standard"|"deferred_voice"; expected_authority_generation:number|null; control_state:string|null; authority_generation:number|null; voice_ai_enabled:number|null; audio_response_mode:string|null } | undefined;
      const authorized = current && (current.expected_authority_generation === null || (current.control_state === "automated" && current.authority_generation === current.expected_authority_generation)) && (current.response_policy !== "deferred_voice" || (current.voice_ai_enabled === 1 && current.audio_response_mode === "voice_with_text_fallback"));
      if (!authorized) { if (current) this.db.prepare("UPDATE outbound_deliveries SET state='suppressed',lease_owner=NULL,lease_expires_at=NULL,safe_error_category=NULL,updated_at=? WHERE id=? AND state='leased' AND lease_owner=? AND send_started_at IS NULL").run(at,id,owner); this.db.exec("COMMIT;"); return false; }
      const changed = this.db.prepare("UPDATE outbound_deliveries SET send_started_at=?,updated_at=? WHERE id=? AND state='leased' AND lease_owner=? AND send_started_at IS NULL").run(at,at,id,owner).changes === 1;
      this.db.exec("COMMIT;");
      return changed;
    } catch (error: unknown) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }
  public acceptSend(id: OutboundDeliveryId, owner: string, externalMessageId: string, updatedAt: string): OutboundDelivery | null {
    const externalId = providerExternalMessageId(externalMessageId);
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.db.prepare("SELECT d.state,d.lease_owner,d.response_policy,p.id AS provider_message_record_id,p.external_message_id,p.conversation_message_id,m.conversation_id FROM outbound_deliveries d JOIN provider_message_records p ON p.id=d.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id WHERE d.id=? AND d.send_started_at IS NOT NULL").get(id) as {state:OutboundDeliveryState;lease_owner:string|null;response_policy:"standard"|"deferred_voice";provider_message_record_id:string;external_message_id:string|null;conversation_message_id:string;conversation_id:string}|undefined;
      if (!current) { this.db.exec("COMMIT;"); return null; }
      if (current.state === "accepted" || current.state === "delivered" || current.state === "read") { this.db.exec("COMMIT;"); return current.external_message_id === externalId ? this.findById(id) : null; }
      if (!((current.state === "leased" && current.lease_owner === owner) || current.state === "uncertain") || current.external_message_id !== null) { this.db.exec("COMMIT;"); return null; }
      this.db.prepare("UPDATE provider_message_records SET external_message_id=?,updated_at=? WHERE id=? AND external_message_id IS NULL").run(externalId,updatedAt,current.provider_message_record_id);
      this.db.prepare("UPDATE outbound_deliveries SET state='accepted',lease_owner=NULL,lease_expires_at=NULL,safe_error_category=NULL,updated_at=? WHERE id=?").run(updatedAt,id);
      if (current.response_policy === "deferred_voice") this.db.prepare("INSERT INTO voice_response_visibility(workspace_id,company_id,conversation_id,conversation_message_id,outbound_delivery_id,kind,committed_at,created_at) SELECT co.workspace_id,co.id,?,?,?,'externally_committed',?,? FROM conversations c JOIN companies co ON co.id=c.company_id WHERE c.id=? ON CONFLICT(outbound_delivery_id) DO NOTHING").run(current.conversation_id,current.conversation_message_id,id,updatedAt,updatedAt,current.conversation_id);
      this.db.exec("COMMIT;");
      return this.findById(id);
    } catch (error: unknown) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }
  public settleUncertainSend(id: OutboundDeliveryId, owner: string, safeErrorCategory: string, updatedAt: string): OutboundDelivery | null {
    const changed = this.db.prepare("UPDATE outbound_deliveries SET state='uncertain',lease_owner=NULL,lease_expires_at=NULL,safe_error_category=?,updated_at=? WHERE id=? AND state='leased' AND lease_owner=? AND send_started_at IS NOT NULL").run(safeErrorCategory,updatedAt,id,owner).changes === 1;
    return changed ? this.findById(id) : null;
  }
  public completeLease(id: OutboundDeliveryId, owner: string, state: "accepted" | "uncertain", safeErrorCategory: string | null, updatedAt: string): OutboundDelivery | null {
    const result = this.db.prepare("UPDATE outbound_deliveries SET state=?,lease_owner=NULL,lease_expires_at=NULL,safe_error_category=?,updated_at=? WHERE id=? AND state='leased' AND lease_owner=?").run(state, safeErrorCategory, updatedAt, id, owner);
    return result.changes === 1 ? this.findById(id) : null;
  }
  public retryLease(id: OutboundDeliveryId, owner: string, nextAttemptAt: string, safeErrorCategory: string | null, updatedAt: string): OutboundDelivery | null {
    const result = this.db.prepare("UPDATE outbound_deliveries SET state='retryable',next_attempt_at=?,lease_owner=NULL,lease_expires_at=NULL,safe_error_category=?,updated_at=? WHERE id=? AND state='leased' AND lease_owner=?").run(nextAttemptAt, safeErrorCategory, updatedAt, id, owner);
    return result.changes === 1 ? this.findById(id) : null;
  }
  public settleLease(id: OutboundDeliveryId, owner: string, outcome: "accepted" | "retryable" | "permanent_failure", nextAttemptAt: string | null, safeErrorCategory: string | null, updatedAt: string): OutboundDelivery | null {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.db.prepare("SELECT attempt_count FROM outbound_deliveries WHERE id=? AND state='leased' AND lease_owner=?").get(id, owner) as { attempt_count: number } | undefined;
      if (!current) { this.db.exec("COMMIT;"); return null; }
      const result = this.db.prepare("UPDATE outbound_deliveries SET state=?,next_attempt_at=COALESCE(?,next_attempt_at),lease_owner=NULL,lease_expires_at=NULL,send_started_at=CASE WHEN ? IN ('retryable','permanent_failure') THEN NULL ELSE send_started_at END,safe_error_category=?,updated_at=? WHERE id=? AND state='leased' AND lease_owner=?").run(outcome, nextAttemptAt, outcome, safeErrorCategory, updatedAt, id, owner);
      if (result.changes === 1) this.db.prepare("INSERT INTO outbound_delivery_attempts(id,outbound_delivery_id,attempt_number,outcome,safe_error_category,occurred_at) VALUES('oda_' || lower(hex(randomblob(16))),?,?,?,?,?)").run(id, current.attempt_count, outcome, safeErrorCategory, updatedAt);
      this.db.exec("COMMIT;");
      return result.changes === 1 ? this.findById(id) : null;
    } catch (error: unknown) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }
}
