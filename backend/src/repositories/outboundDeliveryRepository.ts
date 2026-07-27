import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { OutboundDeliveryRepositoryPort } from "../transport/application/ports.js";
import { reconstructOutboundDelivery, type OutboundDelivery, type OutboundDeliveryId, type OutboundDeliveryState } from "../transport/domain/providerDelivery.js";

interface Row { id:string; provider_message_record_id:string; transport_connection_id:string; state:OutboundDeliveryState; attempt_count:number; next_attempt_at:string; lease_owner:string|null; lease_expires_at:string|null; safe_error_category:string|null; created_at:string; updated_at:string; }
function delivery(row: Row): OutboundDelivery { return reconstructOutboundDelivery({ id: row.id as OutboundDeliveryId, providerMessageRecordId: row.provider_message_record_id as OutboundDelivery["providerMessageRecordId"], transportConnectionId: row.transport_connection_id, state: row.state, attemptCount: row.attempt_count, nextAttemptAt: row.next_attempt_at, leaseOwner: row.lease_owner, leaseExpiresAt: row.lease_expires_at, safeErrorCategory: row.safe_error_category, createdAt: row.created_at, updatedAt: row.updated_at }); }

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
}
