import type { SqlDatabase } from "../../config/sqlDatabase.js";
import { AsyncAuthenticationTransaction, AsyncIdentityTransaction } from "./asyncIdentity.js";

/** Isolated composition seam for the async identity/session persistence migration. */
export function createAsyncIdentityPersistence(database: SqlDatabase): Readonly<{
  identityTransaction: AsyncIdentityTransaction;
  authenticationTransaction: AsyncAuthenticationTransaction;
}> {
  return Object.freeze({
    identityTransaction: new AsyncIdentityTransaction(database),
    authenticationTransaction: new AsyncAuthenticationTransaction(database),
  });
}
