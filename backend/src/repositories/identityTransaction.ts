import type { DatabaseSync } from "node:sqlite";
import type { IdentityRepositories, IdentityTransactionPort } from "../identity/application/ports.js";
import { EmailVerificationRepository } from "./emailVerificationRepository.js";
import { UserRepository } from "./userRepository.js";

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
