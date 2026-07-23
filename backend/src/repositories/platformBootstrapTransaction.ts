import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import { PasswordCredentialRepository, SessionRepository } from "./authenticationRepository.js";
import { UserRepository } from "./userRepository.js";
import { MembershipRepository, SqliteWorkspaceSelectionRepository } from "./workspaceAdministrationRepository.js";
import { WorkspaceRepository } from "./workspaceRepository.js";

export interface PlatformBootstrapRepositories {
  readonly users: UserRepository;
  readonly credentials: PasswordCredentialRepository;
  readonly sessions: SessionRepository;
  readonly workspaces: WorkspaceRepository;
  readonly memberships: MembershipRepository;
  readonly selections: SqliteWorkspaceSelectionRepository;
  isClaimed(): boolean;
  claim(userId: string, at: string): boolean;
}

export interface PlatformBootstrapTransactionPort {
  execute<T>(operation: (repositories: PlatformBootstrapRepositories) => T): T;
}

export class SqlitePlatformBootstrapTransaction implements PlatformBootstrapTransactionPort {
  public constructor(private readonly db: SynchronousDatabase) {}

  public execute<T>(operation: (repositories: PlatformBootstrapRepositories) => T): T {
    if (this.db.isTransaction) throw new Error("Nested platform bootstrap transactions are not supported.");
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const repositories: PlatformBootstrapRepositories = {
        users: new UserRepository(this.db),
        credentials: new PasswordCredentialRepository(this.db),
        sessions: new SessionRepository(this.db),
        workspaces: new WorkspaceRepository(this.db),
        memberships: new MembershipRepository(this.db),
        selections: new SqliteWorkspaceSelectionRepository(this.db),
        isClaimed: () => {
          const row = this.db.prepare("SELECT claimed_by_user_id FROM platform_bootstrap WHERE singleton = 1").get() as { claimed_by_user_id: string | null } | undefined;
          if (!row) throw new Error("Platform bootstrap state is unavailable.");
          return row.claimed_by_user_id !== null;
        },
        claim: (userId: string, at: string) => this.db.prepare(`
          UPDATE platform_bootstrap
          SET claimed_by_user_id = ?, claimed_at = ?
          WHERE singleton = 1 AND claimed_by_user_id IS NULL
        `).run(userId, at).changes === 1,
      };
      const result = operation(repositories);
      this.db.exec("COMMIT;");
      return result;
    } catch (error: unknown) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK;");
      throw error;
    }
  }
}
