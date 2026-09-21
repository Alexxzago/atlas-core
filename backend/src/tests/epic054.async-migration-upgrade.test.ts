import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runAsyncMigrations, runFreshAsyncMigrations } from "../config/asyncMigrations.js";
import { migrationHead, runMigrations } from "../config/migrations.js";
import { DeferredSqlDatabase, LocalSqlDatabase, type SqlDatabase, type SqlResult, type SqlValue } from "../config/sqlDatabase.js";

function atHead(head: number): LocalSqlDatabase {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  runMigrations(database, head);
  return new LocalSqlDatabase(database);
}

class FailingMigrationDatabase implements SqlDatabase {
  public constructor(private readonly database: SqlDatabase, private readonly marker: string) {}
  public execute(statement: string, args: readonly SqlValue[] = []): Promise<SqlResult> { return this.database.execute(statement, args); }
  public executeScript(script: string): Promise<void> { if (script.includes(this.marker)) throw new Error("forced migration failure"); return this.database.executeScript(script); }
  public query<Row extends Record<string, unknown>>(statement: string, args: readonly SqlValue[] = []): Promise<Row[]> { return this.database.query<Row>(statement, args); }
  public transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T> { return this.database.transaction(() => operation(this)); }
  public close(): Promise<void> { return this.database.close(); }
}

test("EPIC054 production async migrations advance a validated existing 0074 ledger through 0076 exactly once", async () => {
  const database = atHead(74);
  try {
    await runAsyncMigrations(database);
    assert.deepEqual(await database.query("SELECT id,name FROM schema_migrations WHERE id>=75 ORDER BY id"), [
      { id: 75, name: "0075_activation_verification_attempts" },
      { id: 76, name: "0076_public_web_chat_durable_turn_claims" },
    ]);
    assert.deepEqual(await database.query("SELECT id,name,checksum FROM schema_migrations ORDER BY id DESC LIMIT 1"), [{ id: migrationHead.id, name: migrationHead.name, checksum: migrationHead.checksum }]);
    await runAsyncMigrations(database);
    assert.deepEqual(await database.query<{ count: number }>("SELECT COUNT(*) count FROM schema_migrations WHERE id>=75"), [{ count: 2 }]);
  } finally { await database.close(); }
});

test("EPIC054 production async migrations preserve fresh bootstrap through 0076", async () => {
  const database = new LocalSqlDatabase(new DatabaseSync(":memory:"));
  try {
    await runFreshAsyncMigrations(database);
    assert.deepEqual(await database.query("SELECT id,name FROM schema_migrations ORDER BY id DESC LIMIT 1"), [{ id: 76, name: "0076_public_web_chat_durable_turn_claims" }]);
  } finally { await database.close(); }
});

test("EPIC054 production async migrations fail closed for corrupt, future, and out-of-order ledgers", async () => {
  const corrupt = atHead(74), future = atHead(74), outOfOrder = atHead(74);
  try {
    await corrupt.execute("UPDATE schema_migrations SET checksum=? WHERE id=74", ["0".repeat(64)]);
    await assert.rejects(runAsyncMigrations(corrupt), /checksum mismatch/);
    await future.execute("INSERT INTO schema_migrations(id,name,checksum) VALUES(?,?,?)", [999, "0999_future", "f".repeat(64)]);
    await assert.rejects(runAsyncMigrations(future), /unknown or out-of-order/);
    await outOfOrder.execute("DELETE FROM schema_migrations WHERE id=73");
    await assert.rejects(runAsyncMigrations(outOfOrder), /unknown or out-of-order/);
  } finally {
    await corrupt.close();
    await future.close();
    await outOfOrder.close();
  }
});

test("EPIC054 failed async upgrades never record the failed migration and block startup before listen", async () => {
  const before75 = atHead(74), before76 = atHead(75);
  try {
    let listened = false;
    const start = async (database: SqlDatabase): Promise<void> => { await runAsyncMigrations(database); listened = true; };
    await assert.rejects(start(new FailingMigrationDatabase(before75, "CREATE TABLE activation_verification_attempts")), /forced migration failure/);
    assert.equal(listened, false);
    assert.deepEqual(await before75.query("SELECT id FROM schema_migrations WHERE id>=75"), []);
    await assert.rejects(runAsyncMigrations(new FailingMigrationDatabase(before76, "CREATE TABLE public_web_chat_turns")), /forced migration failure/);
    assert.deepEqual(await before76.query("SELECT id FROM schema_migrations WHERE id>=76"), []);
  } finally {
    await before75.close();
    await before76.close();
  }
});

test("EPIC054 deferred close ignores a rejected initialization while preserving initialized close failures", async () => {
  const rejected = new DeferredSqlDatabase(async () => { throw new Error("initialization failed"); });
  await assert.rejects(rejected.initialize(), /initialization failed/);
  await assert.doesNotReject(rejected.close());
  const initialized = new DeferredSqlDatabase(async () => ({
    execute: async (): Promise<SqlResult> => ({ rowsAffected: 0 }),
    executeScript: async (): Promise<void> => {},
    query: async <Row extends Record<string, unknown>>(): Promise<Row[]> => [],
    transaction: async <T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T> => operation({} as SqlDatabase),
    close: async (): Promise<void> => { throw new Error("close failed"); },
  }));
  await initialized.initialize();
  await assert.rejects(initialized.close(), /close failed/);
});
