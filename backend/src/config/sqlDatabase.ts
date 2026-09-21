import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import type { SynchronousDatabase } from "./synchronousDatabase.js";

export type SqlValue = string | number | bigint | null | Uint8Array;
export interface SqlResult { readonly rowsAffected: number | bigint; readonly lastInsertRowid?: number | bigint; }

/** The only persistence API shared by local SQLite and libSQL. */
export interface SqlDatabase {
  execute(statement: string, args?: readonly SqlValue[]): Promise<SqlResult>;
  /** Executes a SQL script without parameters. Use this for schema operations, not application data. */
  executeScript(script: string): Promise<void>;
  query<Row extends Record<string, unknown>>(statement: string, args?: readonly SqlValue[]): Promise<Row[]>;
  transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Concrete async database facade that defers connection readiness without exposing its promise to consumers. */
export class DeferredSqlDatabase implements SqlDatabase {
  private database: Promise<SqlDatabase> | null = null;
  private initializationFailed = false;

  public constructor(private readonly connect: () => Promise<SqlDatabase>) {}

  private current(): Promise<SqlDatabase> {
    if (!this.database) {
      this.database = this.connect().catch((error: unknown) => {
        this.initializationFailed = true;
        throw error;
      });
      void this.database.catch(() => undefined);
    }
    return this.database;
  }

  public async initialize(): Promise<void> { await this.current(); }
  public async execute(statement: string, args: readonly SqlValue[] = []): Promise<SqlResult> { return (await this.current()).execute(statement, args); }
  public async executeScript(script: string): Promise<void> { await (await this.current()).executeScript(script); }
  public async query<Row extends Record<string, unknown>>(statement: string, args: readonly SqlValue[] = []): Promise<Row[]> { return (await this.current()).query<Row>(statement, args); }
  public async transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T> { return (await this.current()).transaction(operation); }
  public async close(): Promise<void> {
    if (!this.database) return;
    try { await (await this.database).close(); }
    catch (error: unknown) { if (!this.initializationFailed) throw error; }
  }
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

  public async executeScript(script: string): Promise<void> { this.database.exec(script); }

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
  public async executeScript(script: string): Promise<void> { this.database.exec(script); }
  public async query<Row extends Record<string, unknown>>(sql: string, args: readonly SqlValue[] = []): Promise<Row[]> { return (this.database.prepare(sql).all(...args) as Row[]).map(row=>({...row})); }
  public async transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T> {
    if (this.database.isTransaction) return operation(this);
    for (let attempt = 0; ; attempt += 1) {
      try { this.database.exec("BEGIN IMMEDIATE;"); break; }
      catch (error: unknown) {
        if (!isBusy(error) || attempt === 2) throw error;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    try { const value=await operation(this);this.database.exec("COMMIT;");return value; }
    catch(error:unknown){this.database.exec("ROLLBACK;");throw error;}
  }
  public async close(): Promise<void> { this.database.close(); }
}

function isBusy(error: unknown): boolean { return error instanceof Error && /database is locked|SQLITE_BUSY/i.test(error.message); }

export class LibsqlDatabase implements SqlDatabase {
  public constructor(private readonly client: Client) {}

  public async execute(sql: string, args: readonly SqlValue[] = []): Promise<SqlResult> {
    const result = await this.client.execute(statement(sql, args));
    return result.lastInsertRowid === undefined
      ? { rowsAffected: result.rowsAffected }
      : { rowsAffected: result.rowsAffected, lastInsertRowid: result.lastInsertRowid };
  }

  public async executeScript(script: string): Promise<void> { await this.client.executeMultiple(script); }

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
      executeScript: async (script) => { await transaction.executeMultiple(script); },
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
      await transaction.rollback();
      throw error;
    }
  }

  public async close(): Promise<void> { this.client.close(); }
}

export function createLibsqlDatabase(url: string, authToken: string): SqlDatabase {
  return new LibsqlDatabase(createClient({ url, authToken }));
}
