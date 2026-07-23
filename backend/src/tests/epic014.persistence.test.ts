import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createDatabase, productionDatabaseConfiguration } from "../config/database.js";
import { LocalSqlDatabase } from "../config/sqlDatabase.js";
import { SynchronousLibsqlDatabase } from "../config/synchronousDatabase.js";

test("EPIC-014 rejects local persistence and incomplete Turso configuration in production", () => {
  assert.throws(() => productionDatabaseConfiguration({ NODE_ENV: "production" }), /DATABASE_PROVIDER=libsql/);
  assert.throws(() => productionDatabaseConfiguration({ NODE_ENV: "production", DATABASE_PROVIDER: "sqlite" }), /DATABASE_PROVIDER=libsql/);
  assert.throws(() => productionDatabaseConfiguration({ NODE_ENV: "production", DATABASE_PROVIDER: "libsql" }), /TURSO_DATABASE_URL and TURSO_AUTH_TOKEN/);
});

test("EPIC-014 accepts explicit Turso configuration without exposing its token", () => {
  const configuration = productionDatabaseConfiguration({
    NODE_ENV: "production", DATABASE_PROVIDER: "libsql", TURSO_DATABASE_URL: "libsql://atlas.turso.io", TURSO_AUTH_TOKEN: "test-token",
  });
  assert.deepEqual(configuration, { provider: "libsql", url: "libsql://atlas.turso.io", authToken: "test-token" });
});

test("EPIC-014 local async adapter keeps createDatabase memory tests functional", async () => {
  const local = new LocalSqlDatabase(createDatabase(":memory:"));
  await local.execute("CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  await local.execute("INSERT INTO probe (value) VALUES (?)", ["local"]);
  assert.deepEqual(await local.query<{ id: number; value: string }>("SELECT id, value FROM probe"), [{ id: 1, value: "local" }]);
  await local.close();
});

test("EPIC-014 libSQL adapter preserves the repository SQL result contract without cloud access", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-libsql-"));
  const database = new SynchronousLibsqlDatabase(pathToFileURL(join(directory, "atlas.sqlite")).href, "local-test-token");
  try {
    database.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    const inserted = database.prepare("INSERT INTO probe (value) VALUES (?)").run("libsql");
    assert.equal(inserted.changes, 1);
    assert.deepEqual(database.prepare("SELECT id, value FROM probe").all(), [{ id: 1, value: "libsql" }]);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
