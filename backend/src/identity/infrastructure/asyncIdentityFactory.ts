import type { SqlDatabase } from "../../config/sqlDatabase.js";
import { AsyncAuthenticationTransaction, AsyncIdentityTransaction, AsyncUsers } from "./asyncIdentity.js";

/** Isolated composition seam for the async identity/session persistence migration. */
export function createAsyncIdentityPersistence(database: SqlDatabase): Readonly<{
  identityTransaction: AsyncIdentityTransaction;
  authenticationTransaction: AsyncAuthenticationTransaction;
  users: AsyncUsers;
}> {
  return Object.freeze({
    identityTransaction: new AsyncIdentityTransaction(database),
    authenticationTransaction: new AsyncAuthenticationTransaction(database),
    users: new AsyncUsers(database),
  });
}
