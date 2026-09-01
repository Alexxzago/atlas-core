import { randomUUID } from "node:crypto";
import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import { reconstructConversationMessage } from "../conversation/domain/conversation.js";
import type { ProactiveActionRepositoryPort } from "../proactive/application/ports.js";
import { proactiveActionBounded, proactiveActionCancelFingerprint, proactiveActionCreateFingerprint, proactiveActionId, proactiveActionOperationId, proactiveActionPolicyFingerprint, proactiveActionPositive, proactiveActionTimestamp, type ProactiveAction, type ProactiveActionLease, type ProactiveActionOperationOutcome, type ProactiveActionPolicy, type ProactiveActionState } from "../proactive/domain/proactiveAction.js";

type PolicyRow = { workspace_id: number; company_id: number; enabled: number; version: number; created_at: string; updated_at: string };
type ActionRow = { id: string; workspace_id: number; company_id: number; conversation_id: string; whatsapp_connection_id: string; assistant_profile_id: string; assistant_participant_id: string; intent_kind: "follow_up"; run_at: string; state: ProactiveActionState; expected_authority_generation: number; attempt_count: number; next_attempt_at: string; lease_owner: string | null; lease_token: string | null; lease_acquired_at: string | null; lease_expires_at: string | null; safe_reason_code: string | null; assistant_execution_record_id: string | null; outbound_message_id: string | null; outbound_delivery_id: string | null; version: number; completed_at: string | null; cancelled_at: string | null; created_at: string; updated_at: string };
type OperationRow = { proactive_action_id: string | null; request_fingerprint: string; outcome: ProactiveActionOperationOutcome; resulting_policy_enabled: number | null; resulting_policy_version: number | null; resulting_action_state: ProactiveActionState | null; resulting_action_version: number | null };

const policy = (row: PolicyRow): ProactiveActionPolicy => Object.freeze({ workspaceId: row.workspace_id, companyId: row.company_id, enabled: row.enabled === 1, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at });
const action = (row: ActionRow): ProactiveAction => Object.freeze({ id: proactiveActionId(row.id), workspaceId: row.workspace_id, companyId: row.company_id, conversationId: row.conversation_id, whatsAppConnectionId: row.whatsapp_connection_id, assistantProfileId: row.assistant_profile_id, assistantParticipantId: row.assistant_participant_id, intentKind: row.intent_kind, runAt: row.run_at, state: row.state, expectedAuthorityGeneration: row.expected_authority_generation, attemptCount: row.attempt_count, nextAttemptAt: row.next_attempt_at, leaseOwner: row.lease_owner, leaseToken: row.lease_token, leaseAcquiredAt: row.lease_acquired_at, leaseExpiresAt: row.lease_expires_at, safeReasonCode: row.safe_reason_code, assistantExecutionRecordId: row.assistant_execution_record_id, outboundMessageId: row.outbound_message_id, outboundDeliveryId: row.outbound_delivery_id, version: row.version, completedAt: row.completed_at, cancelledAt: row.cancelled_at, createdAt: row.created_at, updatedAt: row.updated_at });

export type ProactivePolicyMutationResult = { readonly kind: "applied" | "stale_version" | "replayed_applied" | "replayed_stale"; readonly policy: ProactiveActionPolicy } | { readonly kind: "replay_mismatch" | "not_found" };
export type ProactiveActionCreateResult = { readonly kind: "created" | "replayed"; readonly action: ProactiveAction } | { readonly kind: "replay_mismatch" | "policy_disabled" | "not_found" | "authority_not_automated" | "service_window_closed" };
export type ProactiveActionCancelResult = { readonly kind: "cancelled" | "replayed"; readonly action: ProactiveAction } | { readonly kind: "replayed_stale" | "replayed_send_started" | "replay_mismatch" | "stale_version" | "send_started" | "not_found" };

const maximumAttempts = 5;

export class ProactiveActionRepository implements ProactiveActionRepositoryPort {
  public constructor(private readonly db: SynchronousDatabase) {}

  public findPolicy(context: WorkspaceContext, companyId: number): ProactiveActionPolicy | null {
    const row = this.db.prepare("SELECT * FROM proactive_action_policies WHERE workspace_id=? AND company_id=?").get(context.workspaceId, companyId) as PolicyRow | undefined;
    return row ? policy(row) : null;
  }

  public applyPolicy(context: WorkspaceContext, companyId: number, input: { readonly actorId: string; readonly operationId: string; readonly expectedVersion: number; readonly enabled: boolean; readonly occurredAt: string }): ProactivePolicyMutationResult {
    const actorId = proactiveActionBounded(input.actorId, "Proactive action actor", 128), operationId = proactiveActionOperationId(input.operationId), expectedVersion = proactiveActionPositive(input.expectedVersion, "Proactive action expected version"), occurredAt = proactiveActionTimestamp(input.occurredAt), digest = proactiveActionPolicyFingerprint({ actorId, expectedVersion, enabled: input.enabled });
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.findPolicy(context, companyId);
      if (!current) { this.db.exec("COMMIT;"); return { kind: "not_found" }; }
      const prior = this.operation(context, companyId, "policy_update", operationId);
      if (prior) {
        this.db.exec("COMMIT;");
        if (prior.request_fingerprint !== digest) return { kind: "replay_mismatch" };
        const replay = Object.freeze({ ...current, enabled: prior.resulting_policy_enabled === 1, version: prior.resulting_policy_version! });
        return prior.outcome === "applied" ? { kind: "replayed_applied", policy: replay } : { kind: "replayed_stale", policy: replay };
      }
      const stale = current.version !== expectedVersion;
      let saved = current;
      if (!stale) {
        if (this.db.prepare("UPDATE proactive_action_policies SET enabled=?,version=version+1,updated_at=? WHERE workspace_id=? AND company_id=? AND version=?").run(input.enabled ? 1 : 0, occurredAt, context.workspaceId, companyId, expectedVersion).changes !== 1) throw new Error("Proactive action policy CAS lost.");
        saved = this.findPolicy(context, companyId)!;
      }
      this.insertOperation(context, companyId, null, "policy_update", operationId, digest, stale ? "stale_version" : "applied", actorId, saved, null, occurredAt);
      this.db.exec("COMMIT;");
      return stale ? { kind: "stale_version", policy: saved } : { kind: "applied", policy: saved };
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }

  public createAction(context: WorkspaceContext, companyId: number, input: { readonly id: string; readonly actorId: string; readonly operationId: string; readonly conversationId: string; readonly whatsAppConnectionId: string; readonly assistantProfileId: string; readonly assistantParticipantId: string; readonly runAt: string; readonly expectedAuthorityGeneration: number; readonly occurredAt: string }): ProactiveActionCreateResult {
    const id = proactiveActionId(input.id), actorId = proactiveActionBounded(input.actorId, "Proactive action actor", 128), operationId = proactiveActionOperationId(input.operationId), conversationId = proactiveActionBounded(input.conversationId, "Conversation ID", 200), connectionId = proactiveActionBounded(input.whatsAppConnectionId, "WhatsApp connection ID", 200), profileId = proactiveActionBounded(input.assistantProfileId, "Assistant Profile ID", 200), participantId = proactiveActionBounded(input.assistantParticipantId, "Assistant participant ID", 200), runAt = proactiveActionTimestamp(input.runAt, "Proactive action runAt"), expectedAuthorityGeneration = proactiveActionPositive(input.expectedAuthorityGeneration, "Proactive action authority generation"), occurredAt = proactiveActionTimestamp(input.occurredAt), digest = proactiveActionCreateFingerprint({ actorId, conversationId, whatsAppConnectionId: connectionId, assistantProfileId: profileId, assistantParticipantId: participantId, runAt, intentKind: "follow_up" });
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const prior = this.operation(context, companyId, "create", operationId);
      if (prior) {
        this.db.exec("COMMIT;");
        if (prior.request_fingerprint !== digest || !prior.proactive_action_id) return { kind: "replay_mismatch" };
        const existing = this.findAction(context, companyId, prior.proactive_action_id);
        return existing ? { kind: "replayed", action: existing } : { kind: "not_found" };
      }
      const enabled = this.findPolicy(context, companyId);
      if (!enabled) { this.db.exec("COMMIT;"); return { kind: "not_found" }; }
      if (!enabled.enabled) { this.db.exec("COMMIT;"); return { kind: "policy_disabled" }; }
      const authority = this.db.prepare("SELECT cc.state,cc.authority_generation FROM conversation_controls cc JOIN conversations c ON c.id=cc.conversation_id JOIN companies co ON co.id=c.company_id JOIN whatsapp_conversation_bindings b ON b.conversation_id=c.id JOIN whatsapp_connections w ON w.id=b.whatsapp_connection_id JOIN assistant_profiles p ON p.id=w.assistant_profile_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=? AND c.state='open' AND c.channel='whatsapp' AND w.id=? AND w.workspace_id=? AND w.company_id=? AND w.status='active' AND w.assistant_profile_id=? AND p.company_id=? AND p.status='ready' AND b.assistant_participant_id=?").get(context.workspaceId, companyId, conversationId, connectionId, context.workspaceId, companyId, profileId, companyId, participantId) as { state: string; authority_generation: number } | undefined;
      if (!authority) { this.db.exec("COMMIT;"); return { kind: "not_found" }; }
      if (authority.state !== "automated" || authority.authority_generation !== expectedAuthorityGeneration) { this.db.exec("COMMIT;"); return { kind: "authority_not_automated" }; }
      const inboundAt = this.latestCustomerInboundAt(context, companyId, conversationId, connectionId);
      if (inboundAt === null || Date.parse(runAt) >= Date.parse(inboundAt) + 24 * 60 * 60 * 1_000) { this.db.exec("COMMIT;"); return { kind: "service_window_closed" }; }
      let inserted = 0;
      try { inserted = Number(this.db.prepare("INSERT INTO proactive_actions(id,workspace_id,company_id,conversation_id,whatsapp_connection_id,assistant_profile_id,assistant_participant_id,intent_kind,run_at,state,expected_authority_generation,attempt_count,next_attempt_at,lease_owner,lease_token,lease_acquired_at,lease_expires_at,safe_reason_code,assistant_execution_record_id,outbound_message_id,outbound_delivery_id,version,completed_at,cancelled_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'follow_up',?,'scheduled',?,0,?,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,NULL,NULL,?,?)").run(id, context.workspaceId, companyId, conversationId, connectionId, profileId, participantId, runAt, expectedAuthorityGeneration, runAt, occurredAt, occurredAt).changes); }
      catch { this.db.exec("COMMIT;"); return { kind: "not_found" }; }
      if (inserted !== 1) { this.db.exec("COMMIT;"); return { kind: "not_found" }; }
      const saved = this.findAction(context, companyId, id)!;
      this.insertOperation(context, companyId, saved.id, "create", operationId, digest, "applied", actorId, null, saved, occurredAt);
      this.appendAudit(context, companyId, saved.id, "created", null, actorId, operationId, occurredAt);
      this.db.exec("COMMIT;");
      return { kind: "created", action: saved };
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }

  public requestCancel(context: WorkspaceContext, companyId: number, actionIdValue: string, input: { readonly actorId: string; readonly operationId: string; readonly expectedVersion: number; readonly occurredAt: string }): ProactiveActionCancelResult {
    const actionId = proactiveActionId(actionIdValue), actorId = proactiveActionBounded(input.actorId, "Proactive action actor", 128), operationId = proactiveActionOperationId(input.operationId), expectedVersion = proactiveActionPositive(input.expectedVersion, "Proactive action expected version"), occurredAt = proactiveActionTimestamp(input.occurredAt), digest = proactiveActionCancelFingerprint({ actorId, expectedVersion });
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const prior = this.operation(context, companyId, "cancel", operationId);
      if (prior) {
        this.db.exec("COMMIT;");
        if (prior.request_fingerprint !== digest || prior.proactive_action_id !== actionId) return { kind: "replay_mismatch" };
        const existing = this.findAction(context, companyId, actionId);
        if (!existing) return { kind: "not_found" };
        if (prior.outcome === "stale_version") return { kind: "replayed_stale" };
        if (prior.outcome === "cancel_after_send_started") return { kind: "replayed_send_started" };
        return { kind: "replayed", action: existing };
      }
      const current = this.findAction(context, companyId, actionId);
      if (!current) { this.db.exec("COMMIT;"); return { kind: "not_found" }; }
      if (current.version !== expectedVersion) { this.insertOperation(context, companyId, current.id, "cancel", operationId, digest, "stale_version", actorId, null, current, occurredAt); this.db.exec("COMMIT;"); return { kind: "stale_version" }; }
      if (current.outboundDeliveryId !== null) {
        const delivery = this.db.prepare("SELECT send_started_at FROM outbound_deliveries WHERE id=? AND proactive_action_id=?").get(current.outboundDeliveryId, current.id) as { send_started_at: string | null } | undefined;
        if (delivery?.send_started_at !== null) { this.insertOperation(context, companyId, current.id, "cancel", operationId, digest, "cancel_after_send_started", actorId, null, current, occurredAt); this.db.exec("COMMIT;"); return { kind: "send_started" }; }
      }
      if (!["scheduled", "ready", "leased", "retryable", "runtime_completed", "awaiting_outbound"].includes(current.state)) { this.insertOperation(context, companyId, current.id, "cancel", operationId, digest, "stale_version", actorId, null, current, occurredAt); this.db.exec("COMMIT;"); return { kind: "stale_version" }; }
      if (current.state === "awaiting_outbound") {
        if (!current.outboundDeliveryId || this.db.prepare("UPDATE outbound_deliveries SET state='suppressed',lease_owner=NULL,lease_expires_at=NULL,safe_error_category=NULL,updated_at=? WHERE id=? AND proactive_action_id=? AND state IN ('pending','leased','retryable') AND send_started_at IS NULL").run(occurredAt, current.outboundDeliveryId, current.id).changes !== 1) { this.db.exec("COMMIT;"); return { kind: "stale_version" }; }
        if (this.db.prepare("UPDATE proactive_actions SET state='cancelled',lease_owner=NULL,lease_token=NULL,lease_acquired_at=NULL,lease_expires_at=NULL,version=version+1,completed_at=?,cancelled_at=?,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND version=? AND state='awaiting_outbound'").run(occurredAt, occurredAt, occurredAt, current.id, context.workspaceId, companyId, expectedVersion).changes !== 1) throw new Error("Proactive action cancellation CAS lost.");
        const saved = this.findAction(context, companyId, current.id)!;
        this.insertOperation(context, companyId, saved.id, "cancel", operationId, digest, "applied", actorId, null, saved, occurredAt);
        this.appendAudit(context, companyId, saved.id, "cancelled", null, actorId, operationId, occurredAt);
        this.db.exec("COMMIT;");
        return { kind: "cancelled", action: saved };
      }
      if (this.db.prepare("UPDATE proactive_actions SET state='cancelled',lease_owner=NULL,lease_token=NULL,lease_acquired_at=NULL,lease_expires_at=NULL,version=version+1,completed_at=?,cancelled_at=?,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND version=? AND state IN ('scheduled','ready','leased','retryable','runtime_completed')").run(occurredAt, occurredAt, occurredAt, current.id, context.workspaceId, companyId, expectedVersion).changes !== 1) throw new Error("Proactive action cancellation CAS lost.");
      const saved = this.findAction(context, companyId, current.id)!;
      this.insertOperation(context, companyId, saved.id, "cancel", operationId, digest, "applied", actorId, null, saved, occurredAt);
      this.appendAudit(context, companyId, saved.id, "cancelled", null, actorId, operationId, occurredAt);
      this.db.exec("COMMIT;");
      return { kind: "cancelled", action: saved };
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }

  public findAction(context: WorkspaceContext, companyId: number, actionId: string): ProactiveAction | null {
    const row = this.db.prepare("SELECT * FROM proactive_actions WHERE workspace_id=? AND company_id=? AND id=?").get(context.workspaceId, companyId, actionId) as ActionRow | undefined;
    return row ? action(row) : null;
  }

  public resolveCreationScope(context: WorkspaceContext, companyId: number, conversationId: string): { readonly whatsAppConnectionId: string; readonly assistantProfileId: string; readonly assistantParticipantId: string; readonly authorityGeneration: number } | null {
    const row = this.db.prepare("SELECT w.id AS whatsapp_connection_id,w.assistant_profile_id,b.assistant_participant_id,cc.authority_generation FROM conversations c JOIN companies co ON co.id=c.company_id JOIN conversation_controls cc ON cc.conversation_id=c.id JOIN whatsapp_conversation_bindings b ON b.conversation_id=c.id JOIN whatsapp_connections w ON w.id=b.whatsapp_connection_id JOIN assistant_profiles p ON p.id=w.assistant_profile_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=? AND c.channel='whatsapp' AND c.state='open' AND cc.state='automated' AND w.workspace_id=? AND w.company_id=? AND w.status='active' AND p.company_id=? AND p.status='ready'").get(context.workspaceId, companyId, conversationId, context.workspaceId, companyId, companyId) as { whatsapp_connection_id: string; assistant_profile_id: string; assistant_participant_id: string; authority_generation: number } | undefined;
    return row ? Object.freeze({ whatsAppConnectionId: row.whatsapp_connection_id, assistantProfileId: row.assistant_profile_id, assistantParticipantId: row.assistant_participant_id, authorityGeneration: row.authority_generation }) : null;
  }

  public listActions(context: WorkspaceContext, companyId: number, limit: number): readonly ProactiveAction[] {
    if (!Number.isSafeInteger(limit) || limit < 1) return Object.freeze([]);
    return Object.freeze((this.db.prepare("SELECT * FROM proactive_actions WHERE workspace_id=? AND company_id=? ORDER BY run_at DESC,id DESC LIMIT ?").all(context.workspaceId, companyId, limit) as ActionRow[]).map(action));
  }

  public promoteDue(nowValue: string, limit: number): readonly ProactiveAction[] {
    const now = proactiveActionTimestamp(nowValue), promoted: ProactiveAction[] = [];
    if (!Number.isSafeInteger(limit) || limit < 1) return Object.freeze(promoted);
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const rows = this.db.prepare("SELECT * FROM proactive_actions WHERE (state='scheduled' AND run_at<=?) OR (state='retryable' AND next_attempt_at<=?) ORDER BY run_at,id LIMIT ?").all(now, now, limit) as ActionRow[];
      for (const row of rows) {
        const current = action(row), reason = this.preflight(current, now);
        if (reason) {
          if (this.db.prepare("UPDATE proactive_actions SET state='suppressed',lease_owner=NULL,lease_token=NULL,lease_acquired_at=NULL,lease_expires_at=NULL,safe_reason_code=?,version=version+1,completed_at=?,updated_at=? WHERE id=? AND state IN ('scheduled','retryable')").run(reason, now, now, current.id).changes === 1) this.appendAudit({ workspaceId: current.workspaceId, workspaceKey: "proactive" }, current.companyId, current.id, "suppressed", reason, null, null, now);
          continue;
        }
        if (this.db.prepare("UPDATE proactive_actions SET state='ready',lease_owner=NULL,lease_token=NULL,lease_acquired_at=NULL,lease_expires_at=NULL,safe_reason_code=NULL,version=version+1,updated_at=? WHERE id=? AND state IN ('scheduled','retryable')").run(now, current.id).changes === 1) promoted.push(this.findAction({ workspaceId: current.workspaceId, workspaceKey: "proactive" }, current.companyId, current.id)!);
      }
      this.db.exec("COMMIT;");
      return Object.freeze(promoted);
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }

  public claimDue(ownerValue: string, nowValue: string, expiresAtValue: string, limit: number): readonly ProactiveActionLease[] {
    const owner = proactiveActionBounded(ownerValue, "Proactive action worker owner", 128), now = proactiveActionTimestamp(nowValue), expiresAt = proactiveActionTimestamp(expiresAtValue), leases: ProactiveActionLease[] = [];
    if (Date.parse(expiresAt) <= Date.parse(now) || !Number.isSafeInteger(limit) || limit < 1) return Object.freeze(leases);
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const rows = this.db.prepare("SELECT * FROM proactive_actions WHERE (state='ready' AND run_at<=?) OR (state='leased' AND lease_expires_at<=?) ORDER BY run_at,id LIMIT ?").all(now, now, limit) as ActionRow[];
      for (const row of rows) {
        const current = action(row), reason = this.preflight(current, now);
        if (reason) { this.suppressCurrent(current, now, reason); continue; }
        if (current.attemptCount >= maximumAttempts) { this.failCurrent(current, now, "proactive_retry_exhausted"); continue; }
        const token = `pal_${randomUUID().replaceAll("-", "")}`;
        if (this.db.prepare("UPDATE proactive_actions SET state='leased',attempt_count=attempt_count+1,lease_owner=?,lease_token=?,lease_acquired_at=?,lease_expires_at=?,safe_reason_code=NULL,version=version+1,updated_at=? WHERE id=? AND ((state='ready' AND run_at<=?) OR (state='leased' AND lease_expires_at<=?))").run(owner, token, now, expiresAt, now, current.id, now, now).changes === 1) {
          const saved = this.findAction({ workspaceId: current.workspaceId, workspaceKey: "proactive" }, current.companyId, current.id)!;
          this.appendAudit({ workspaceId: current.workspaceId, workspaceKey: "proactive" }, current.companyId, current.id, "claimed", current.state === "leased" ? "lease_recovered" : null, null, token, now);
          leases.push(Object.freeze({ action: saved, leaseToken: token }));
        }
      }
      this.db.exec("COMMIT;");
      return Object.freeze(leases);
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }

  public validateClaim(lease: ProactiveActionLease, nowValue: string): "valid" | "suppressed" | "stale" {
    const now = proactiveActionTimestamp(nowValue), current = this.findAction({ workspaceId: lease.action.workspaceId, workspaceKey: "proactive" }, lease.action.companyId, lease.action.id);
    if (!current || current.state !== "leased" || current.leaseToken !== lease.leaseToken || current.leaseOwner === null || current.leaseExpiresAt === null || current.leaseExpiresAt < now) return "stale";
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const locked = this.findAction({ workspaceId: lease.action.workspaceId, workspaceKey: "proactive" }, lease.action.companyId, lease.action.id);
      if (!locked || locked.state !== "leased" || locked.leaseToken !== lease.leaseToken || locked.leaseExpiresAt === null || locked.leaseExpiresAt < now) { this.db.exec("COMMIT;"); return "stale"; }
      const reason = this.preflight(locked, now);
      if (!reason) { this.db.exec("COMMIT;"); return "valid"; }
      this.suppressCurrent(locked, now, reason, lease.leaseToken);
      this.db.exec("COMMIT;");
      return "suppressed";
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }

  public scheduleRetry(lease: ProactiveActionLease, nowValue: string, safeReasonCode: string): ProactiveAction | null {
    const now = proactiveActionTimestamp(nowValue), reason = proactiveActionBounded(safeReasonCode, "Proactive retry reason", 100), current = this.currentLease(lease, now);
    if (!current) return null;
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const locked = this.currentLease(lease, now);
      if (!locked) { this.db.exec("COMMIT;"); return null; }
      if (locked.attemptCount >= maximumAttempts) { this.failCurrent(locked, now, "proactive_retry_exhausted", lease.leaseToken); this.db.exec("COMMIT;"); return this.findAction({ workspaceId: locked.workspaceId, workspaceKey: "proactive" }, locked.companyId, locked.id); }
      const nextAttemptAt = new Date(Date.parse(now) + Math.min(300_000, 1_000 * 2 ** Math.min(locked.attemptCount, 8))).toISOString();
      if (this.db.prepare("UPDATE proactive_actions SET state='retryable',next_attempt_at=?,lease_owner=NULL,lease_token=NULL,lease_acquired_at=NULL,lease_expires_at=NULL,safe_reason_code=?,version=version+1,updated_at=? WHERE id=? AND state='leased' AND lease_token=?").run(nextAttemptAt, reason, now, locked.id, lease.leaseToken).changes === 1) this.appendAudit({ workspaceId: locked.workspaceId, workspaceKey: "proactive" }, locked.companyId, locked.id, "retry_scheduled", reason, null, lease.leaseToken, now);
      this.db.exec("COMMIT;");
      return this.findAction({ workspaceId: locked.workspaceId, workspaceKey: "proactive" }, locked.companyId, locked.id);
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }

  public suppressClaim(lease: ProactiveActionLease, nowValue: string, safeReasonCode: string): ProactiveAction | null {
    const now = proactiveActionTimestamp(nowValue), reason = proactiveActionBounded(safeReasonCode, "Proactive suppression reason", 100), current = this.currentLease(lease, now);
    if (!current) return null;
    this.db.exec("BEGIN IMMEDIATE;");
    try { const locked = this.currentLease(lease, now); if (!locked) { this.db.exec("COMMIT;"); return null; } this.suppressCurrent(locked, now, reason, lease.leaseToken); this.db.exec("COMMIT;"); return this.findAction({ workspaceId: locked.workspaceId, workspaceKey: "proactive" }, locked.companyId, locked.id); } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }

  public renewClaim(lease: ProactiveActionLease, nowValue: string, expiresAtValue: string): boolean {
    const now = proactiveActionTimestamp(nowValue), expiresAt = proactiveActionTimestamp(expiresAtValue);
    if (Date.parse(expiresAt) <= Date.parse(now)) return false;
    return this.db.prepare("UPDATE proactive_actions SET lease_expires_at=?,updated_at=? WHERE id=? AND state='leased' AND lease_owner=? AND lease_token=? AND lease_expires_at>=?").run(expiresAt, now, lease.action.id, lease.action.leaseOwner, lease.leaseToken, now).changes === 1;
  }

  public failClaim(lease: ProactiveActionLease, nowValue: string, safeReasonCode: string): ProactiveAction | null {
    const now = proactiveActionTimestamp(nowValue), reason = proactiveActionBounded(safeReasonCode, "Proactive runtime failure reason", 100), current = this.currentLease(lease, now);
    if (!current) return null;
    this.db.exec("BEGIN IMMEDIATE;");
    try { const locked = this.currentLease(lease, now); if (!locked) { this.db.exec("COMMIT;"); return null; } this.failCurrent(locked, now, reason, lease.leaseToken); this.db.exec("COMMIT;"); return this.findAction({ workspaceId: locked.workspaceId, workspaceKey: "proactive" }, locked.companyId, locked.id); } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }

  public selectCompletedExecution(context: WorkspaceContext, companyId: number, input: { readonly actionId: string; readonly executionRecordId: string; readonly leaseToken: string; readonly now: string }): ProactiveAction | null {
    const actionId = proactiveActionId(input.actionId), executionId = proactiveActionBounded(input.executionRecordId, "Assistant execution record ID", 200), leaseToken = proactiveActionBounded(input.leaseToken, "Proactive action lease token", 200), now = proactiveActionTimestamp(input.now);
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.findAction(context, companyId, actionId);
      if (!current || current.state !== "leased" || current.leaseToken !== leaseToken || current.leaseExpiresAt === null || current.leaseExpiresAt < now || current.assistantExecutionRecordId !== null) { this.db.exec("COMMIT;"); return null; }
      const reason = this.preflight(current, now);
      if (reason) { this.suppressCurrent(current, now, reason, leaseToken); this.db.exec("COMMIT;"); return null; }
      const valid = this.db.prepare("SELECT 1 FROM assistant_execution_records e WHERE e.id=? AND e.company_id=? AND e.assistant_profile_id=? AND e.purpose='proactive_execution' AND e.state IN ('answered','safe_fallback') AND e.result IS NOT NULL AND json_valid(e.execution_snapshot_json) AND json_extract(e.execution_snapshot_json,'$.version')='execution-snapshot-v2' AND json_extract(e.execution_snapshot_json,'$.workspaceId')=? AND json_extract(e.execution_snapshot_json,'$.companyId')=? AND json_extract(e.execution_snapshot_json,'$.assistantProfileId')=? AND json_extract(e.execution_snapshot_json,'$.conversationId')=? AND json_extract(e.execution_snapshot_json,'$.whatsAppConnectionId')=? AND json_extract(e.execution_snapshot_json,'$.authorityGeneration')=? AND json_extract(e.execution_snapshot_json,'$.proactiveActionId')=?").get(executionId, companyId, current.assistantProfileId, context.workspaceId, companyId, current.assistantProfileId, current.conversationId, current.whatsAppConnectionId, current.expectedAuthorityGeneration, current.id);
      if (!valid) { this.db.exec("COMMIT;"); return null; }
      const changed = this.db.prepare("UPDATE proactive_actions SET assistant_execution_record_id=?,state='runtime_completed',lease_owner=NULL,lease_token=NULL,lease_acquired_at=NULL,lease_expires_at=NULL,safe_reason_code=NULL,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND state='leased' AND lease_token=? AND assistant_execution_record_id IS NULL").run(executionId, now, current.id, context.workspaceId, companyId, leaseToken).changes === 1;
      if (changed) this.appendAudit(context, companyId, current.id, "completed", null, null, executionId, now);
      this.db.exec("COMMIT;");
      return changed ? this.findAction(context, companyId, current.id) : null;
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }

  public findSelectedExecution(context: WorkspaceContext, companyId: number, actionIdValue: string): { readonly action: ProactiveAction; readonly executionRecordId: string; readonly result: string } | null {
    const actionId = proactiveActionId(actionIdValue), row = this.db.prepare("SELECT a.*,e.id AS execution_id,e.result FROM proactive_actions a JOIN assistant_execution_records e ON e.id=a.assistant_execution_record_id WHERE a.workspace_id=? AND a.company_id=? AND a.id=? AND a.state='runtime_completed' AND e.purpose='proactive_execution' AND e.state IN ('answered','safe_fallback') AND e.result IS NOT NULL").get(context.workspaceId, companyId, actionId) as (ActionRow & { execution_id: string; result: string }) | undefined;
    return row ? Object.freeze({ action: action(row), executionRecordId: row.execution_id, result: row.result }) : null;
  }

  public materializeCompleted(nowValue: string, limit: number): readonly ProactiveAction[] {
    const now = proactiveActionTimestamp(nowValue), materialized: ProactiveAction[] = [];
    if (!Number.isSafeInteger(limit) || limit < 1) return Object.freeze(materialized);
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const rows = this.db.prepare("SELECT * FROM proactive_actions WHERE state='runtime_completed' ORDER BY updated_at,id LIMIT ?").all(limit) as ActionRow[];
      for (const row of rows) {
        const current = action(row), context = { workspaceId: current.workspaceId, workspaceKey: "proactive" }, selected = this.findSelectedExecution(context, current.companyId, current.id);
        if (!selected) continue;
        const reason = this.preflight(current, now);
        if (reason) { this.suppressCurrent(current, now, reason); continue; }
        const messageId = `cmsg_${randomUUID().replaceAll("-", "")}`, recordId = `pmr_${randomUUID().replaceAll("-", "")}`, deliveryId = `odl_${randomUUID().replaceAll("-", "")}`;
        const message = this.db.prepare("INSERT INTO conversation_messages(id,conversation_id,sender_participant_id,direction,content,idempotency_key,assistant_execution_record_id,created_at) VALUES(?,?,?,'outbound',?,?,?,?)").run(messageId, current.conversationId, current.assistantParticipantId, selected.result, `proactive:${current.id}`, selected.executionRecordId, now);
        if (message.changes !== 1) throw new Error("Proactive outbound message could not be materialized.");
        const record = this.db.prepare("INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,'whatsapp','meta_whatsapp_cloud','outbound',?,?,NULL,?,?)").run(recordId, current.whatsAppConnectionId, messageId, now, now);
        if (record.changes !== 1) throw new Error("Proactive provider message could not be materialized.");
        const delivery = this.db.prepare("INSERT INTO outbound_deliveries(id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,lease_owner,lease_expires_at,safe_error_category,expected_authority_generation,proactive_action_id,created_at,updated_at) VALUES(?,?,?,'pending',0,?,NULL,NULL,NULL,?,?,?,?)").run(deliveryId, recordId, current.whatsAppConnectionId, now, current.expectedAuthorityGeneration, current.id, now, now);
        if (delivery.changes !== 1) throw new Error("Proactive outbound delivery could not be materialized.");
        if (this.db.prepare("UPDATE proactive_actions SET state='awaiting_outbound',outbound_message_id=?,outbound_delivery_id=?,version=version+1,updated_at=? WHERE id=? AND state='runtime_completed' AND assistant_execution_record_id=?").run(messageId, deliveryId, now, current.id, selected.executionRecordId).changes !== 1) throw new Error("Proactive materialization CAS lost.");
        this.appendAudit(context, current.companyId, current.id, "outbound_reserved", null, null, deliveryId, now);
        materialized.push(this.findAction(context, current.companyId, current.id)!);
      }
      this.db.exec("COMMIT;");
      return Object.freeze(materialized);
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK;"); throw error; }
  }

  public latestCustomerInboundAt(context: WorkspaceContext, companyId: number, conversationId: string, whatsAppConnectionId: string): string | null {
    const row = this.db.prepare("SELECT m.created_at FROM whatsapp_conversation_bindings b JOIN conversations c ON c.id=b.conversation_id JOIN companies co ON co.id=c.company_id JOIN conversation_messages m ON m.conversation_id=b.conversation_id AND m.sender_participant_id=b.customer_participant_id JOIN channel_provider_events e ON e.conversation_id=c.id AND e.conversation_message_id=m.id AND e.communication_channel='whatsapp' AND e.transport_connection_id=b.whatsapp_connection_id JOIN provider_message_records p ON p.conversation_message_id=m.id AND p.communication_channel='whatsapp' AND p.direction='inbound' AND p.transport_connection_id=b.whatsapp_connection_id AND p.external_message_id IS NOT NULL WHERE b.whatsapp_connection_id=? AND b.conversation_id=? AND co.workspace_id=? AND c.company_id=? AND m.direction='inbound' ORDER BY m.created_at DESC,m.id DESC LIMIT 1").get(whatsAppConnectionId, conversationId, context.workspaceId, companyId) as { created_at: string } | undefined;
    return row?.created_at ?? null;
  }

  public findVisibility(context: WorkspaceContext, companyId: number, actionId: string): { readonly actionId: string; readonly messageId: string; readonly deliveryId: string; readonly committedAt: string } | null {
    const row = this.db.prepare("SELECT proactive_action_id,conversation_message_id,outbound_delivery_id,committed_at FROM proactive_action_visibility WHERE workspace_id=? AND company_id=? AND proactive_action_id=?").get(context.workspaceId, companyId, actionId) as { proactive_action_id: string; conversation_message_id: string; outbound_delivery_id: string; committed_at: string } | undefined;
    return row ? Object.freeze({ actionId: row.proactive_action_id, messageId: row.conversation_message_id, deliveryId: row.outbound_delivery_id, committedAt: row.committed_at }) : null;
  }

  public findVisibleAssistantMessages(context: WorkspaceContext, companyId: number, limit: number): readonly import("../conversation/domain/conversation.js").ConversationMessage[] {
    if (!Number.isSafeInteger(limit) || limit < 1) return Object.freeze([]);
    const rows = this.db.prepare("SELECT m.* FROM proactive_action_visibility v JOIN proactive_actions a ON a.id=v.proactive_action_id JOIN conversation_messages m ON m.id=v.conversation_message_id WHERE v.workspace_id=? AND v.company_id=? AND a.state='succeeded' AND NOT EXISTS(SELECT 1 FROM conversation_intelligence_applied_messages i WHERE i.conversation_id=m.conversation_id AND i.conversation_message_id=m.id) ORDER BY v.committed_at,v.proactive_action_id LIMIT ?").all(context.workspaceId, companyId, limit) as Array<{ id: string; conversation_id: string; sender_participant_id: string; direction: "inbound" | "outbound"; content: string; idempotency_key: string | null; assistant_execution_record_id: string | null; created_at: string }>;
    return Object.freeze(rows.map((row) => reconstructConversationMessage({ id: row.id as never, conversationId: row.conversation_id as never, senderParticipantId: row.sender_participant_id as never, direction: row.direction, content: row.content, idempotencyKey: row.idempotency_key, executionRecordId: row.assistant_execution_record_id, createdAt: row.created_at })));
  }

  public recoverableSemanticScopes(limit: number): readonly { readonly workspaceId: number; readonly companyId: number }[] {
    if (!Number.isSafeInteger(limit) || limit < 1) return Object.freeze([]);
    return Object.freeze((this.db.prepare("SELECT v.workspace_id,v.company_id FROM proactive_action_visibility v JOIN proactive_actions a ON a.id=v.proactive_action_id JOIN conversation_messages m ON m.id=v.conversation_message_id WHERE a.state='succeeded' AND NOT EXISTS(SELECT 1 FROM conversation_intelligence_applied_messages i WHERE i.conversation_id=m.conversation_id AND i.conversation_message_id=m.id) GROUP BY v.workspace_id,v.company_id ORDER BY MIN(v.committed_at),v.workspace_id,v.company_id LIMIT ?").all(limit) as Array<{ workspace_id: number; company_id: number }>).map((row) => Object.freeze({ workspaceId: row.workspace_id, companyId: row.company_id })));
  }

  /** PASS5 calls this while settling provider acceptance in its owning transaction. */
  public createVisibilityExactlyOnce(context: WorkspaceContext, companyId: number, input: { readonly actionId: string; readonly conversationId: string; readonly messageId: string; readonly deliveryId: string; readonly committedAt: string; readonly createdAt: string }): { readonly kind: "created" | "replayed" | "conflict" } {
    const actionId = proactiveActionId(input.actionId), conversationId = proactiveActionBounded(input.conversationId, "Conversation ID", 200), messageId = proactiveActionBounded(input.messageId, "Conversation message ID", 200), deliveryId = proactiveActionBounded(input.deliveryId, "Outbound delivery ID", 200), committedAt = proactiveActionTimestamp(input.committedAt), createdAt = proactiveActionTimestamp(input.createdAt);
    try {
      this.db.prepare("INSERT INTO proactive_action_visibility(proactive_action_id,workspace_id,company_id,conversation_id,conversation_message_id,outbound_delivery_id,kind,committed_at,created_at) VALUES(?,?,?,?,?,?,'externally_committed',?,?)").run(actionId, context.workspaceId, companyId, conversationId, messageId, deliveryId, committedAt, createdAt);
      return { kind: "created" };
    } catch {
      const existing = this.findVisibility(context, companyId, actionId);
      return existing && existing.messageId === messageId && existing.deliveryId === deliveryId && existing.committedAt === committedAt ? { kind: "replayed" } : { kind: "conflict" };
    }
  }

  private currentLease(lease: ProactiveActionLease, now: string): ProactiveAction | null {
    const current = this.findAction({ workspaceId: lease.action.workspaceId, workspaceKey: "proactive" }, lease.action.companyId, lease.action.id);
    return current && current.state === "leased" && current.leaseToken === lease.leaseToken && current.leaseOwner !== null && current.leaseExpiresAt !== null && current.leaseExpiresAt >= now ? current : null;
  }

  private preflight(current: ProactiveAction, now: string): string | null {
    const scope = this.db.prepare("SELECT p.enabled,c.state AS conversation_state,w.status AS connection_status,w.assistant_profile_id AS connection_profile,b.customer_participant_id,b.assistant_participant_id,cc.state AS control_state,cc.authority_generation FROM proactive_actions a LEFT JOIN proactive_action_policies p ON p.company_id=a.company_id AND p.workspace_id=a.workspace_id LEFT JOIN conversations c ON c.id=a.conversation_id AND c.company_id=a.company_id LEFT JOIN whatsapp_connections w ON w.id=a.whatsapp_connection_id AND w.workspace_id=a.workspace_id AND w.company_id=a.company_id LEFT JOIN whatsapp_conversation_bindings b ON b.whatsapp_connection_id=a.whatsapp_connection_id AND b.conversation_id=a.conversation_id LEFT JOIN conversation_controls cc ON cc.conversation_id=a.conversation_id WHERE a.id=? AND a.workspace_id=? AND a.company_id=?").get(current.id, current.workspaceId, current.companyId) as { enabled: number | null; conversation_state: string | null; connection_status: string | null; connection_profile: string | null; customer_participant_id: string | null; assistant_participant_id: string | null; control_state: string | null; authority_generation: number | null } | undefined;
    if (!scope || scope.enabled !== 1) return "proactive_policy_disabled";
    if (scope.conversation_state !== "open") return "conversation_closed";
    if (scope.connection_status !== "active") return "whatsapp_connection_unavailable";
    if (scope.connection_profile !== current.assistantProfileId) return "assistant_assignment_changed";
    if (scope.customer_participant_id === null || scope.assistant_participant_id !== current.assistantParticipantId) return "whatsapp_binding_invalid";
    if (scope.control_state !== "automated" || scope.authority_generation !== current.expectedAuthorityGeneration) return "authority_lost";
    const inboundAt = this.latestCustomerInboundAt({ workspaceId: current.workspaceId, workspaceKey: "proactive" }, current.companyId, current.conversationId, current.whatsAppConnectionId);
    return inboundAt !== null && Date.parse(now) < Date.parse(inboundAt) + 24 * 60 * 60 * 1_000 ? null : "whatsapp_service_window_closed";
  }

  private suppressCurrent(current: ProactiveAction, now: string, reason: string, leaseToken: string | null = null): void {
    const changed = this.db.prepare(`UPDATE proactive_actions SET state='suppressed',lease_owner=NULL,lease_token=NULL,lease_acquired_at=NULL,lease_expires_at=NULL,safe_reason_code=?,version=version+1,completed_at=?,updated_at=? WHERE id=? AND state IN ('scheduled','ready','leased','retryable','runtime_completed')${leaseToken === null ? "" : " AND lease_token=?"}`).run(...(leaseToken === null ? [reason, now, now, current.id] : [reason, now, now, current.id, leaseToken])).changes === 1;
    if (changed) this.appendAudit({ workspaceId: current.workspaceId, workspaceKey: "proactive" }, current.companyId, current.id, "suppressed", reason, null, leaseToken, now);
  }

  private failCurrent(current: ProactiveAction, now: string, reason: string, leaseToken: string | null = null): void {
    const changed = this.db.prepare(`UPDATE proactive_actions SET state='permanent_failure',lease_owner=NULL,lease_token=NULL,lease_acquired_at=NULL,lease_expires_at=NULL,safe_reason_code=?,version=version+1,completed_at=?,updated_at=? WHERE id=? AND state IN ('ready','leased','retryable')${leaseToken === null ? "" : " AND lease_token=?"}`).run(...(leaseToken === null ? [reason, now, now, current.id] : [reason, now, now, current.id, leaseToken])).changes === 1;
    if (changed) this.appendAudit({ workspaceId: current.workspaceId, workspaceKey: "proactive" }, current.companyId, current.id, "runtime_failed", reason, null, leaseToken, now);
  }

  private operation(context: WorkspaceContext, companyId: number, operation: "policy_update" | "create" | "cancel", operationId: string): OperationRow | null {
    const row = this.db.prepare("SELECT proactive_action_id,request_fingerprint,outcome,resulting_policy_enabled,resulting_policy_version,resulting_action_state,resulting_action_version FROM proactive_action_operations WHERE workspace_id=? AND company_id=? AND operation=? AND operation_id=?").get(context.workspaceId, companyId, operation, operationId) as OperationRow | undefined;
    return row ?? null;
  }

  private insertOperation(context: WorkspaceContext, companyId: number, actionId: string | null, operation: "policy_update" | "create" | "cancel", operationId: string, digest: string, outcome: ProactiveActionOperationOutcome, actorId: string, resultingPolicy: ProactiveActionPolicy | null, resultingAction: ProactiveAction | null, occurredAt: string): void {
    this.db.prepare("INSERT INTO proactive_action_operations(id,workspace_id,company_id,proactive_action_id,operation,operation_id,request_fingerprint,outcome,actor_user_id,resulting_policy_enabled,resulting_policy_version,resulting_action_state,resulting_action_version,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(`pao_${randomUUID().replaceAll("-", "")}`, context.workspaceId, companyId, actionId, operation, operationId, digest, outcome, actorId, resultingPolicy?.enabled === undefined ? null : resultingPolicy.enabled ? 1 : 0, resultingPolicy?.version ?? null, resultingAction?.state ?? null, resultingAction?.version ?? null, occurredAt);
  }

  private appendAudit(context: WorkspaceContext, companyId: number, actionId: string, eventType: "created" | "cancelled" | "claimed" | "retry_scheduled" | "suppressed" | "runtime_failed" | "outbound_reserved" | "completed", safeReasonCode: string | null, actorId: string | null, correlationId: string | null, occurredAt: string): void {
    this.db.prepare("INSERT INTO proactive_action_audit_events(id,workspace_id,company_id,proactive_action_id,event_type,safe_reason_code,actor_user_id,correlation_id,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)").run(`pae_${randomUUID().replaceAll("-", "")}`, context.workspaceId, companyId, actionId, eventType, safeReasonCode, actorId, correlationId, occurredAt);
  }
}
