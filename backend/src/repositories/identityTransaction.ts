import type { DatabaseSync } from "node:sqlite";
import type { AuthenticationRepositories, AuthenticationTransactionPort, IdentityRepositories, IdentityTransactionPort } from "../identity/application/ports.js";
import { EmailVerificationRepository } from "./emailVerificationRepository.js";
import { UserRepository } from "./userRepository.js";
import { CredentialEnrollmentRepository, LoginThrottleRepository, PasswordCredentialRepository, SessionRepository } from "./authenticationRepository.js";

export class SqliteIdentityTransaction implements IdentityTransactionPort {
  public constructor(private readonly db: DatabaseSync) {}

  public execute<T>(operation: (repositories: IdentityRepositories) => T): T {
    if (this.db.isTransaction) throw new Error("Nested identity transactions are not supported.");
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = operation({ users: new UserRepository(this.db), verifications: new EmailVerificationRepository(this.db) });
      this.db.exec("COMMIT;");
      return result;
    } catch (error: unknown) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK;");
      throw error;
    }
  }
}

export class SqliteAuthenticationTransaction implements AuthenticationTransactionPort {
  public constructor(private readonly db: DatabaseSync) {}
  public execute<T>(operation: (repositories: AuthenticationRepositories) => T): T {
    if (this.db.isTransaction) throw new Error("Nested authentication transactions are not supported.");
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = operation({ users:new UserRepository(this.db),verifications:new EmailVerificationRepository(this.db),credentials:new PasswordCredentialRepository(this.db),enrollments:new CredentialEnrollmentRepository(this.db),sessions:new SessionRepository(this.db),throttles:new LoginThrottleRepository(this.db) });
      this.db.exec("COMMIT;"); return result;
    } catch(error:unknown) { if(this.db.isTransaction)this.db.exec("ROLLBACK;"); throw error; }
  }
}
