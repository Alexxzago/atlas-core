import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { runFreshAsyncMigrations } from "../config/asyncMigrations.js";
import { migrationHead, migrationRegistry } from "../config/migrations.js";
import { createLibsqlDatabase, type SqlDatabase } from "../config/sqlDatabase.js";
import { LiveDataObservationRepository } from "../repositories/liveDataObservationRepository.js";

test("EPIC054 PASS5A1 keeps the 75-migration bootstrap registry immutable", () => {
  assert.deepEqual(migrationHead, { id: 75, name: "0075_activation_verification_attempts", checksum: migrationHead.checksum });
  assert.equal(migrationRegistry.length, 75);
  assert.equal(Object.isFrozen(migrationRegistry), true);
  assert.equal(Object.isFrozen(migrationHead), true);
});

test("EPIC054 PASS5A1 runs a fresh 0001-0075 history through an isolated native async libSQL database", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-async-migration-"));
  const path = join(directory, "atlas.sqlite");
  const database = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token");
  try {
    await runFreshAsyncMigrations(database);
    assert.deepEqual(await database.query("SELECT id,name,checksum FROM schema_migrations ORDER BY id DESC LIMIT 1"), [{ id: 75, name: migrationHead.name, checksum: migrationHead.checksum }]);
    assert.equal((await database.query("SELECT id FROM schema_migrations")).length, 75);
    assert.equal((await database.query("SELECT name FROM sqlite_master WHERE type='table' AND name='activation_verification_attempts'")).length, 1);
    await assert.rejects(runFreshAsyncMigrations(database), /empty migration history/);
  } finally {
    await database.close();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    // The native libSQL client can retain a Windows file handle after close(); temp cleanup is best effort.
    try { rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {}
  }
});

test("EPIC054 PASS5A1 reads a production repository slice through the async event loop", async () => {
  const events: string[] = [];
  const directory = mkdtempSync(join(tmpdir(), "atlas-async-read-"));
  const path = join(directory, "atlas.sqlite");
  const database = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token");
  try {
    await runFreshAsyncMigrations(database);
    const yieldingDatabase: SqlDatabase = {
      execute: (sql, args) => database.execute(sql, args),
      executeScript: (script) => database.executeScript(script),
      query: async (sql, args) => { await new Promise<void>((resolve) => setImmediate(resolve)); events.push("query"); return database.query(sql, args); },
      transaction: (operation) => database.transaction(operation),
      close: () => database.close(),
    };
    const repository = new LiveDataObservationRepository(yieldingDatabase);
    const turn = new Promise<void>((resolve) => setImmediate(() => { events.push("event-loop"); resolve(); }));
    const result = await repository.findLatest({ workspaceId: 1, workspaceKey: "default" }, 1, "availability");
    await turn;
    assert.equal(result, null);
    assert.deepEqual(events, ["event-loop", "query"]);
  } finally {
    await database.close();
    try { rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {}
  }
});
