import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import { SynchronousSqlDatabaseAdapter } from "../config/sqlDatabase.js";
import { AsyncAuthenticationTransaction, AsyncIdentityTransaction } from "../identity/infrastructure/asyncIdentity.js";

/** @deprecated Live identity persistence is asynchronous; retained for local callers. */
export class SqliteIdentityTransaction extends AsyncIdentityTransaction {
  public constructor(database: SynchronousDatabase) { super(new SynchronousSqlDatabaseAdapter(database)); }
}

/** @deprecated Live identity persistence is asynchronous; retained for local callers. */
export class SqliteAuthenticationTransaction extends AsyncAuthenticationTransaction {
  public constructor(database: SynchronousDatabase) { super(new SynchronousSqlDatabaseAdapter(database)); }
}
