import type { DatabaseSync } from "node:sqlite";
import type { UserRepositoryPort } from "../application/ports/repositories.js";
import type { NormalizedEmail } from "../identity/domain/email.js";
import { reconstructUser, type User, type UserId, type UserState } from "../identity/domain/user.js";

interface UserRow {
  id: string;
  status: UserState["status"];
  locale: UserState["locale"];
  created_at: string;
  updated_at: string;
}

interface AuthenticationIdentityRow {
  id: string;
  email: string;
  normalized_email: string;
  email_verified: number;
  created_at: string;
  updated_at: string;
}

interface SqliteConstraintError extends Error {
  errcode?: number;
}

export class NormalizedEmailAlreadyExistsError extends Error {
  public constructor() {
    super("Normalized email is already assigned to an identity.");
  }
}

export class UserPersistenceConflictError extends Error {
  public constructor() {
    super("User aggregate could not be persisted because its identity state changed.");
  }
}

function isNormalizedEmailConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const sqliteError = error as SqliteConstraintError;
  return sqliteError.errcode === 2067
    && error.message.includes("authentication_identities.normalized_email");
}

function mapUser(row: UserRow, identities: AuthenticationIdentityRow[]): User {
  return reconstructUser({
    id: row.id,
    status: row.status,
    locale: row.locale,
    authenticationIdentities: identities.map((identity) => ({
      id: identity.id,
      email: identity.email,
      normalizedEmail: identity.normalized_email,
      emailVerified: identity.email_verified === 1,
      createdAt: identity.created_at,
      updatedAt: identity.updated_at,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class UserRepository implements UserRepositoryPort {
  public constructor(private readonly db: DatabaseSync) {}

  public findById(id: UserId): User | null {
    const row = this.db.prepare(`
      SELECT id, status, locale, created_at, updated_at
      FROM users
      WHERE id = ?
    `).get(id) as UserRow | undefined;
    return row ? mapUser(row, this.findAuthenticationIdentities(row.id)) : null;
  }

  public findByNormalizedEmail(email: NormalizedEmail): User | null {
    const row = this.db.prepare(`
      SELECT users.id, users.status, users.locale, users.created_at, users.updated_at
      FROM authentication_identities
      INNER JOIN users ON users.id = authentication_identities.user_id
      WHERE authentication_identities.normalized_email = ?
    `).get(email) as UserRow | undefined;
    return row ? mapUser(row, this.findAuthenticationIdentities(row.id)) : null;
  }

  public create(user: User): User {
    try {
      this.db.exec("BEGIN IMMEDIATE;");
      this.db.prepare(`
        INSERT INTO users (id, status, locale, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(user.id, user.status, user.locale, user.createdAt, user.updatedAt);
      const insertIdentity = this.db.prepare(`
        INSERT INTO authentication_identities (
          id, user_id, email, normalized_email, email_verified, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const identity of user.authenticationIdentities) {
        insertIdentity.run(
          identity.id,
          user.id,
          identity.email,
          identity.normalizedEmail,
          identity.emailVerified ? 1 : 0,
          identity.createdAt,
          identity.updatedAt,
        );
      }
      this.db.exec("COMMIT;");
      return user;
    } catch (error: unknown) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK;");
      if (isNormalizedEmailConflict(error)) throw new NormalizedEmailAlreadyExistsError();
      throw error;
    }
  }

  public update(user: User): User | null {
    try {
      this.db.exec("BEGIN IMMEDIATE;");
      const updated = this.db.prepare(`
        UPDATE users
        SET status = ?, locale = ?, updated_at = ?
        WHERE id = ?
      `).run(user.status, user.locale, user.updatedAt, user.id);
      if (updated.changes === 0) {
        this.db.exec("ROLLBACK;");
        return null;
      }

      const identityCount = this.db.prepare(`
        SELECT COUNT(*) AS count
        FROM authentication_identities
        WHERE user_id = ?
      `).get(user.id) as { count: number };
      if (identityCount.count !== user.authenticationIdentities.length) {
        throw new UserPersistenceConflictError();
      }

      const updateIdentity = this.db.prepare(`
        UPDATE authentication_identities
        SET email = ?, normalized_email = ?, email_verified = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `);
      for (const identity of user.authenticationIdentities) {
        const result = updateIdentity.run(
          identity.email,
          identity.normalizedEmail,
          identity.emailVerified ? 1 : 0,
          identity.updatedAt,
          identity.id,
          user.id,
        );
        if (result.changes !== 1) throw new UserPersistenceConflictError();
      }

      this.db.exec("COMMIT;");
      return user;
    } catch (error: unknown) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK;");
      if (isNormalizedEmailConflict(error)) throw new NormalizedEmailAlreadyExistsError();
      throw error;
    }
  }

  private findAuthenticationIdentities(userId: string): AuthenticationIdentityRow[] {
    return this.db.prepare(`
      SELECT id, email, normalized_email, email_verified, created_at, updated_at
      FROM authentication_identities
      WHERE user_id = ?
      ORDER BY created_at, id
    `).all(userId) as unknown as AuthenticationIdentityRow[];
  }
}
