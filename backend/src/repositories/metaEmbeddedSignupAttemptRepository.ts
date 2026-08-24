import type { SqlDatabase } from "../config/sqlDatabase.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import type { UserId } from "../identity/domain/user.js";
import type { MetaEmbeddedSignupAttemptRepositoryPort, MetaEmbeddedSignupClaimOutcome, MetaEmbeddedSignupTransitionOutcome } from "../whatsapp/application/metaEmbeddedSignupAttemptService.js";
import { metaEmbeddedSignupAttemptId, reconstructMetaEmbeddedSignupAttempt, type MetaEmbeddedSignupAttempt, type MetaEmbeddedSignupAttemptFailureCode, type MetaEmbeddedSignupAttemptId } from "../whatsapp/domain/metaEmbeddedSignupAttempt.js";

interface AttemptRow extends Record<string, unknown> {
  id: string; workspace_id: number; company_id: number; initiating_user_id: string; assistant_profile_id: string; target_whatsapp_connection_id: string | null; target_integration_connection_id: string | null; resolved_integration_connection_id: string | null; provider: "meta_whatsapp"; kind: "cloud_api"; status: MetaEmbeddedSignupAttempt["status"]; state_digest: string; completion_code_digest: string | null; created_at: string; expires_at: string; claimed_at: string | null; completed_at: string | null; failed_at: string | null; expired_at: string | null; safe_failure_code: MetaEmbeddedSignupAttemptFailureCode | null; version: number; updated_at: string;
}

export class MetaEmbeddedSignupAttemptRepository implements MetaEmbeddedSignupAttemptRepositoryPort {
  public constructor(private readonly database: SqlDatabase) {}
  public async create(context: WorkspaceContext, value: MetaEmbeddedSignupAttempt): Promise<MetaEmbeddedSignupAttempt | null> {
    const result = await this.database.execute(`INSERT INTO meta_embedded_signup_attempts(id,workspace_id,company_id,initiating_user_id,assistant_profile_id,target_whatsapp_connection_id,target_integration_connection_id,resolved_integration_connection_id,provider,kind,status,state_digest,completion_code_digest,created_at,expires_at,claimed_at,completed_at,failed_at,expired_at,safe_failure_code,version,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [value.id, context.workspaceId, value.companyId, value.initiatingUserId, value.assistantProfileId, value.targetWhatsAppConnectionId, value.targetIntegrationConnectionId, value.resolvedIntegrationConnectionId, value.provider, value.kind, value.status, value.stateDigest, value.completionCodeDigest, value.createdAt, value.expiresAt, value.claimedAt, value.completedAt, value.failedAt, value.expiredAt, value.safeFailureCode, value.version, value.updatedAt]);
    return Number(result.rowsAffected) === 1 ? value : null;
  }
  public async find(context: WorkspaceContext, companyId: number, initiatingUserId: UserId, id: MetaEmbeddedSignupAttemptId): Promise<MetaEmbeddedSignupAttempt | null> { return this.findOn(this.database, context, companyId, initiatingUserId, id); }
  public async reserveIntegrationConnection(context: WorkspaceContext, companyId: number, initiatingUserId: UserId, id: MetaEmbeddedSignupAttemptId, expectedVersion: number, reservedId: import("../integrations/domain/integrationConnection.js").IntegrationConnectionId, at: string): Promise<MetaEmbeddedSignupTransitionOutcome> { return this.database.transaction(async database => { const current = await this.findOn(database, context, companyId, initiatingUserId, id); if (!current) return { kind: "not_found" }; if (current.status === "expired" || current.expiresAt <= at) return { kind: "conflict", attempt: current }; if (current.status !== "completing" || current.version !== expectedVersion) return { kind: "conflict", attempt: current }; if (current.resolvedIntegrationConnectionId !== null) return current.resolvedIntegrationConnectionId === reservedId ? { kind: "replayed", attempt: current } : { kind: "conflict", attempt: current }; const updated = await database.execute("UPDATE meta_embedded_signup_attempts SET resolved_integration_connection_id=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND initiating_user_id=? AND status='completing' AND version=? AND resolved_integration_connection_id IS NULL", [reservedId, at, id, context.workspaceId, companyId, initiatingUserId, expectedVersion]); if (Number(updated.rowsAffected) !== 1) return { kind: "conflict" }; const saved = await this.findOn(database, context, companyId, initiatingUserId, id); return saved ? { kind: "applied", attempt: saved } : { kind: "not_found" }; }); }
  public async claim(context: WorkspaceContext, companyId: number, initiatingUserId: UserId, id: MetaEmbeddedSignupAttemptId, completionCodeDigest: string, at: string): Promise<MetaEmbeddedSignupClaimOutcome> {
    return this.database.transaction(async database => {
      const current = await this.findOn(database, context, companyId, initiatingUserId, id);
      if (!current) return { kind: "not_found" };
      if (current.status === "started" && current.expiresAt <= at) return await this.expireOn(database, context, companyId, initiatingUserId, current, at) ? { kind: "expired" } : { kind: "not_found" };
      if (current.status === "completing" && current.expiresAt <= at) return await this.expireOn(database, context, companyId, initiatingUserId, current, at) ? { kind: "expired" } : { kind: "not_found" };
      if (current.status === "started") {
        const updated = await database.execute("UPDATE meta_embedded_signup_attempts SET status='completing',completion_code_digest=?,claimed_at=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND initiating_user_id=? AND status='started' AND version=?", [completionCodeDigest, at, at, id, context.workspaceId, companyId, initiatingUserId, current.version]);
        if (Number(updated.rowsAffected) !== 1) return { kind: "replay_mismatch" };
        const claimed = await this.findOn(database, context, companyId, initiatingUserId, id);
        return claimed ? { kind: "claimed", attempt: claimed } : { kind: "not_found" };
      }
      if (current.status === "completing") return current.completionCodeDigest === completionCodeDigest ? { kind: "already_claimed_same_completion", attempt: current } : { kind: "replay_mismatch", attempt: current };
      if (current.status === "completed") return current.completionCodeDigest === completionCodeDigest ? { kind: "already_completed", attempt: current } : { kind: "replay_mismatch", attempt: current };
      return current.status === "expired" ? { kind: "expired", attempt: current } : { kind: "replay_mismatch", attempt: current };
    });
  }
  public async markCompleted(context: WorkspaceContext, companyId: number, initiatingUserId: UserId, id: MetaEmbeddedSignupAttemptId, expectedVersion: number, at: string): Promise<MetaEmbeddedSignupTransitionOutcome> {
    return this.transition(context, companyId, initiatingUserId, id, expectedVersion, at, "completed", null);
  }
  public async markFailed(context: WorkspaceContext, companyId: number, initiatingUserId: UserId, id: MetaEmbeddedSignupAttemptId, expectedVersion: number, failureCode: MetaEmbeddedSignupAttemptFailureCode, at: string): Promise<MetaEmbeddedSignupTransitionOutcome> {
    return this.transition(context, companyId, initiatingUserId, id, expectedVersion, at, "failed", failureCode);
  }
  public async expire(context: WorkspaceContext, companyId: number, initiatingUserId: UserId, id: MetaEmbeddedSignupAttemptId, expectedVersion: number, at: string): Promise<MetaEmbeddedSignupTransitionOutcome> {
    return this.database.transaction(async database => {
      const current = await this.findOn(database, context, companyId, initiatingUserId, id);
      if (!current) return { kind: "not_found" };
      if (current.status === "expired") return { kind: "replayed", attempt: current };
      if (current.status === "completed" || current.status === "failed" || current.version !== expectedVersion || current.expiresAt > at) return { kind: "conflict", attempt: current };
      if (!await this.expireOn(database, context, companyId, initiatingUserId, current, at)) return { kind: "conflict" };
      const expired = await this.findOn(database, context, companyId, initiatingUserId, id);
      return expired ? { kind: "applied", attempt: expired } : { kind: "not_found" };
    });
  }
  private async transition(context: WorkspaceContext, companyId: number, initiatingUserId: UserId, id: MetaEmbeddedSignupAttemptId, expectedVersion: number, at: string, target: "completed" | "failed", failureCode: MetaEmbeddedSignupAttemptFailureCode | null): Promise<MetaEmbeddedSignupTransitionOutcome> {
    return this.database.transaction(async database => {
      const current = await this.findOn(database, context, companyId, initiatingUserId, id);
      if (!current) return { kind: "not_found" };
      if (current.status === target && (target === "completed" || current.safeFailureCode === failureCode)) return { kind: "replayed", attempt: current };
      if ((current.status !== "completing" && !(target === "failed" && current.status === "started")) || current.version !== expectedVersion) return { kind: "conflict", attempt: current };
      if (current.expiresAt <= at) {
        if (!await this.expireOn(database, context, companyId, initiatingUserId, current, at)) return { kind: "conflict" };
        const expired = await this.findOn(database, context, companyId, initiatingUserId, id);
        return expired ? { kind: "conflict", attempt: expired } : { kind: "conflict" };
      }
      const updated = target === "completed"
        ? await database.execute("UPDATE meta_embedded_signup_attempts SET status='completed',completed_at=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND initiating_user_id=? AND status='completing' AND version=?", [at, at, id, context.workspaceId, companyId, initiatingUserId, expectedVersion])
        : await database.execute("UPDATE meta_embedded_signup_attempts SET status='failed',failed_at=?,safe_failure_code=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND initiating_user_id=? AND status IN ('started','completing') AND version=?", [at, failureCode, at, id, context.workspaceId, companyId, initiatingUserId, expectedVersion]);
      if (Number(updated.rowsAffected) !== 1) return { kind: "conflict" };
      const saved = await this.findOn(database, context, companyId, initiatingUserId, id);
      return saved ? { kind: "applied", attempt: saved } : { kind: "not_found" };
    });
  }
  private async expireOn(database: SqlDatabase, context: WorkspaceContext, companyId: number, initiatingUserId: UserId, current: MetaEmbeddedSignupAttempt, at: string): Promise<boolean> {
    const result = await database.execute("UPDATE meta_embedded_signup_attempts SET status='expired',expired_at=?,safe_failure_code='expired',version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND initiating_user_id=? AND status IN ('started','completing') AND version=? AND expires_at<=?", [at, at, current.id, context.workspaceId, companyId, initiatingUserId, current.version, at]);
    return Number(result.rowsAffected) === 1;
  }
  private async findOn(database: SqlDatabase, context: WorkspaceContext, companyId: number, initiatingUserId: UserId, id: MetaEmbeddedSignupAttemptId): Promise<MetaEmbeddedSignupAttempt | null> {
    const rows = await database.query<AttemptRow>("SELECT * FROM meta_embedded_signup_attempts WHERE id=? AND workspace_id=? AND company_id=? AND initiating_user_id=?", [id, context.workspaceId, companyId, initiatingUserId]);
    return rows[0] ? attempt(rows[0]) : null;
  }
}

function attempt(row: AttemptRow): MetaEmbeddedSignupAttempt { return reconstructMetaEmbeddedSignupAttempt({ id: metaEmbeddedSignupAttemptId(row.id), workspaceId: row.workspace_id, companyId: row.company_id, initiatingUserId: row.initiating_user_id as MetaEmbeddedSignupAttempt["initiatingUserId"], assistantProfileId: row.assistant_profile_id as MetaEmbeddedSignupAttempt["assistantProfileId"], targetWhatsAppConnectionId: row.target_whatsapp_connection_id as MetaEmbeddedSignupAttempt["targetWhatsAppConnectionId"], targetIntegrationConnectionId: row.target_integration_connection_id as MetaEmbeddedSignupAttempt["targetIntegrationConnectionId"], resolvedIntegrationConnectionId: row.resolved_integration_connection_id as MetaEmbeddedSignupAttempt["resolvedIntegrationConnectionId"], provider: row.provider, kind: row.kind, status: row.status, stateDigest: row.state_digest, completionCodeDigest: row.completion_code_digest, createdAt: row.created_at, expiresAt: row.expires_at, claimedAt: row.claimed_at, completedAt: row.completed_at, failedAt: row.failed_at, expiredAt: row.expired_at, safeFailureCode: row.safe_failure_code, version: row.version, updatedAt: row.updated_at }); }
