import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { resetRuntimeReadinessForTests } from "../config/runtimeReadiness.js";
import type { SqlDatabase, SqlResult, SqlValue } from "../config/sqlDatabase.js";
import { createHealthRouter } from "../routes/health.js";

class Deferred<T> {
  public readonly promise: Promise<T>;
  public resolve!: (value: T) => void;

  public constructor() {
    this.promise = new Promise<T>((resolve) => { this.resolve = resolve; });
  }
}

class DelayedAsyncDatabase implements SqlDatabase {
  public readonly delayedQuery = new Deferred<never[]>();
  public closeStarted = false;

  public async execute(_statement: string, _args: readonly SqlValue[] = []): Promise<SqlResult> { return { rowsAffected: 0 }; }
  public async executeScript(_script: string): Promise<void> {}
  public async query<Row extends Record<string, unknown>>(statement: string, _args: readonly SqlValue[] = []): Promise<Row[]> {
    if (statement === "SELECT delayed") return this.delayedQuery.promise;
    return [];
  }
  public async transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T> { return operation(this); }
  public async close(): Promise<void> { this.closeStarted = true; }
}

test("PASS 5A async database work does not block health, timers, or close scheduling", async () => {
  resetRuntimeReadinessForTests();
  const database = new DelayedAsyncDatabase();
  const pending = database.query("SELECT delayed");
  const app = express();
  app.use(createHealthRouter(database));
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const [response, timer] = await Promise.all([
      fetch(`http://127.0.0.1:${address.port}/health`),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1)),
    ]);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "online" });
    assert.equal(timer, true);

    await database.close();
    assert.equal(database.closeStarted, true);
    database.delayedQuery.resolve([]);
    await pending;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
