import type { DatabaseSync } from "node:sqlite";
import type { EmailVerificationRepositoryPort } from "../identity/application/ports.js";
import { reconstructEmailVerification, type DigestAlgorithmVersion, type EmailVerificationWorkflow, type TokenDigest, type VerificationDeliveryStatus, type VerificationPurpose } from "../identity/domain/emailVerification.js";
import type { AuthenticationIdentityId, UserId } from "../identity/domain/user.js";

interface VerificationRow {
  id: string; user_id: string; authentication_identity_id: string; purpose: VerificationPurpose;
  digest_version: DigestAlgorithmVersion; token_digest: string; status: EmailVerificationWorkflow["status"];
  delivery_status: VerificationDeliveryStatus; issued_at: string; expires_at: string; consumed_at: string | null;
  superseded_at: string | null; invalidated_at: string | null; created_at: string; updated_at: string;
}

function mapWorkflow(row: VerificationRow): EmailVerificationWorkflow {
  return reconstructEmailVerification({
    id: row.id,
    userId: row.user_id as UserId,
    authenticationIdentityId: row.authentication_identity_id as AuthenticationIdentityId,
    purpose: row.purpose,
    digestVersion: row.digest_version,
    tokenDigest: row.token_digest as TokenDigest,
    status: row.status,
    deliveryStatus: row.delivery_status,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    supersededAt: row.superseded_at,
    invalidatedAt: row.invalidated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

const columns = `id, user_id, authentication_identity_id, purpose, digest_version, token_digest,
  status, delivery_status, issued_at, expires_at, consumed_at, superseded_at, invalidated_at, created_at, updated_at`;

export class EmailVerificationRepository implements EmailVerificationRepositoryPort {
  public constructor(private readonly db: DatabaseSync) {}

  public findByDigest(purpose: VerificationPurpose, version: DigestAlgorithmVersion, digest: TokenDigest): EmailVerificationWorkflow | null {
    const row = this.db.prepare(`SELECT ${columns} FROM email_verifications
      WHERE purpose = ? AND digest_version = ? AND token_digest = ?`).get(purpose, version, digest) as VerificationRow | undefined;
    return row ? mapWorkflow(row) : null;
  }

  public findCurrent(authenticationIdentityId: string, purpose: VerificationPurpose): EmailVerificationWorkflow | null {
    const row = this.db.prepare(`SELECT ${columns} FROM email_verifications
      WHERE authentication_identity_id = ? AND purpose = ? AND status = 'pending'`).get(authenticationIdentityId, purpose) as VerificationRow | undefined;
    return row ? mapWorkflow(row) : null;
  }

  public create(workflow: EmailVerificationWorkflow): EmailVerificationWorkflow {
    this.db.prepare(`INSERT INTO email_verifications (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(workflow.id, workflow.userId, workflow.authenticationIdentityId, workflow.purpose, workflow.digestVersion,
        workflow.tokenDigest, workflow.status, workflow.deliveryStatus, workflow.issuedAt, workflow.expiresAt,
        workflow.consumedAt, workflow.supersededAt, workflow.invalidatedAt, workflow.createdAt, workflow.updatedAt);
    return workflow;
  }

  public update(workflow: EmailVerificationWorkflow, expectedStatus: EmailVerificationWorkflow["status"]): boolean {
    const result = this.db.prepare(`UPDATE email_verifications SET status = ?, delivery_status = ?, consumed_at = ?,
      superseded_at = ?, invalidated_at = ?, updated_at = ? WHERE id = ? AND status = ?`)
      .run(workflow.status, workflow.deliveryStatus, workflow.consumedAt, workflow.supersededAt,
        workflow.invalidatedAt, workflow.updatedAt, workflow.id, expectedStatus);
    return result.changes === 1;
  }

  public setDeliveryStatus(id: string, status: VerificationDeliveryStatus, updatedAt: string): boolean {
    const result = this.db.prepare(`UPDATE email_verifications SET delivery_status = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
      .run(status, updatedAt, id);
    return result.changes === 1;
  }
}
