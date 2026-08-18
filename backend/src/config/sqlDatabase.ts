import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import type { SynchronousDatabase } from "./synchronousDatabase.js";

export type SqlValue = string | number | bigint | null | Uint8Array;
export interface SqlResult { readonly rowsAffected: number | bigint; readonly lastInsertRowid?: number | bigint; }

/** The only persistence API shared by local SQLite and libSQL. */
export interface SqlDatabase {
  execute(statement: string, args?: readonly SqlValue[]): Promise<SqlResult>;
  query<Row extends Record<string, unknown>>(statement: string, args?: readonly SqlValue[]): Promise<Row[]>;
  transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function statement(sql: string, args: readonly SqlValue[] = []): InStatement {
  return { sql, args: args as InArgs };
}

interface TransactionCoordinator { tail: Promise<void>; }
const fileTransactionCoordinators = new Map<string, TransactionCoordinator>();
const memoryTransactionCoordinators = new WeakMap<DatabaseSync, TransactionCoordinator>();

function transactionCoordinator(database: DatabaseSync): TransactionCoordinator {
  const file = (database.prepare("PRAGMA database_list").get() as { file: string }).file;
  if (!file) {
    const existing = memoryTransactionCoordinators.get(database);
    if (existing) return existing;
    const coordinator = { tail: Promise.resolve() };
    memoryTransactionCoordinators.set(database, coordinator);
    return coordinator;
  }
  const existing = fileTransactionCoordinators.get(file);
  if (existing) return existing;
  const coordinator = { tail: Promise.resolve() };
  fileTransactionCoordinators.set(file, coordinator);
  return coordinator;
}

export class LocalSqlDatabase implements SqlDatabase {
  private readonly transactionContext = new AsyncLocalStorage<boolean>();
  private readonly coordinator: TransactionCoordinator;
  public constructor(private readonly database: DatabaseSync) { this.coordinator = transactionCoordinator(database); }

  public async execute(sql: string, args: readonly SqlValue[] = []): Promise<SqlResult> {
    const result = this.database.prepare(sql).run(...args);
    return { rowsAffected: result.changes, lastInsertRowid: result.lastInsertRowid };
  }

  public async query<Row extends Record<string, unknown>>(sql: string, args: readonly SqlValue[] = []): Promise<Row[]> {
    return (this.database.prepare(sql).all(...args) as Row[]).map((row) => ({ ...row }));
  }

  public async transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T> {
    if (this.transactionContext.getStore()) return operation(this);
    const previous = this.coordinator.tail;
    let release: (() => void) | undefined;
    this.coordinator.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    let began = false;
    try {
      this.database.exec("BEGIN IMMEDIATE;");
      began = true;
      const value = await this.transactionContext.run(true, () => operation(this));
      this.database.exec("COMMIT;");
      return value;
    } catch (error: unknown) {
      if (began) this.database.exec("ROLLBACK;");
      throw error;
    } finally {
      release!();
    }
  }

  public async close(): Promise<void> { this.database.close(); }
}

/** Async-shaped adapter for the existing local and worker-backed synchronous runtime database. */
export class SynchronousSqlDatabaseAdapter implements SqlDatabase {
  public constructor(private readonly database: SynchronousDatabase) {}
  public async execute(sql: string, args: readonly SqlValue[] = []): Promise<SqlResult> { const result=this.database.prepare(sql).run(...args); return { rowsAffected:result.changes,lastInsertRowid:result.lastInsertRowid }; }
  public async query<Row extends Record<string, unknown>>(sql: string, args: readonly SqlValue[] = []): Promise<Row[]> { return (this.database.prepare(sql).all(...args) as Row[]).map(row=>({...row})); }
  public async transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T> { if(this.database.isTransaction)return operation(this);this.database.exec("BEGIN IMMEDIATE;");try{const value=await operation(this);this.database.exec("COMMIT;");return value;}catch(error:unknown){this.database.exec("ROLLBACK;");throw error;} }
  public async close(): Promise<void> { this.database.close(); }
}

export class LibsqlDatabase implements SqlDatabase {
  public constructor(private readonly client: Client) {}

  public async execute(sql: string, args: readonly SqlValue[] = []): Promise<SqlResult> {
    const result = await this.client.execute(statement(sql, args));
    return result.lastInsertRowid === undefined
      ? { rowsAffected: result.rowsAffected }
      : { rowsAffected: result.rowsAffected, lastInsertRowid: result.lastInsertRowid };
  }

  public async query<Row extends Record<string, unknown>>(sql: string, args: readonly SqlValue[] = []): Promise<Row[]> {
    const result = await this.client.execute(statement(sql, args));
    return result.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? null])) as Row);
  }

  public async transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T> {
    const transaction = await this.client.transaction("write");
    const database: SqlDatabase = {
      execute: async (sql, args = []) => {
        const result = await transaction.execute(statement(sql, args));
        return result.lastInsertRowid === undefined
          ? { rowsAffected: result.rowsAffected }
          : { rowsAffected: result.rowsAffected, lastInsertRowid: result.lastInsertRowid };
      },
      query: async <Row extends Record<string, unknown>>(sql: string, args: readonly SqlValue[] = []) => {
        const result = await transaction.execute(statement(sql, args));
        return result.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? null])) as Row);
      },
      transaction: async <R>(nested: (nestedDatabase: SqlDatabase) => Promise<R>) => nested(database),
      close: async () => undefined,
    };
    try {
      const value = await operation(database);
      await transaction.commit();
      return value;
    } catch (error: unknown) {
      transaction.rollback();
      throw error;
    }
  }

  public async close(): Promise<void> { this.client.close(); }
}

export function createLibsqlDatabase(url: string, authToken: string): SqlDatabase {
  return new LibsqlDatabase(createClient({ url, authToken }));
}
