import { freshPortableMigrations, migrationHead, migrationRegistry, type PortableMigration } from "./migrations.js";
import type { SqlDatabase, SqlValue } from "./sqlDatabase.js";

interface MigrationRow extends Record<string, unknown> { readonly id: number; readonly name: string; readonly checksum: string; }
interface ForeignKeyRow extends Record<string, unknown> { readonly foreign_keys: number; }

/**
 * Applies the complete 0001-0075 history to an empty database using only the
 * asynchronous SqlDatabase contract. It deliberately rejects partial or
 * pre-existing histories: upgrades remain on the established synchronous path.
 */
export async function runFreshAsyncMigrations(database: SqlDatabase): Promise<void> {
  await database.executeScript("PRAGMA foreign_keys = ON;");
  await database.executeScript(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const applied = await database.query<MigrationRow>("SELECT id, name, checksum FROM schema_migrations ORDER BY id");
  if (applied.length > 0) throw new Error("Fresh async migrations require an empty migration history.");

  for (const migration of freshPortableMigrations()) await apply(database, migration);

  const head = await database.query<MigrationRow>("SELECT id, name, checksum FROM schema_migrations ORDER BY id DESC LIMIT 1");
  if (head.length !== 1 || head[0]!.id !== migrationHead.id || head[0]!.name !== migrationHead.name || head[0]!.checksum !== migrationHead.checksum) {
    throw new Error("Fresh async migrations did not reach the expected migration head.");
  }
  if ((await database.query("PRAGMA foreign_key_check")).length > 0) throw new Error("Foreign-key integrity check failed after fresh async migrations.");
}

async function apply(database: SqlDatabase, migration: PortableMigration): Promise<void> {
  if (migration.disableForeignKeys) await database.executeScript("PRAGMA foreign_keys = OFF;");
  try {
    await database.transaction(async (transaction) => {
      for (const operation of migration.operations) {
        if (operation.kind === "script") await transaction.executeScript(operation.sql);
        else await transaction.execute(operation.sql, operation.args as readonly SqlValue[]);
      }
      if ((await transaction.query("PRAGMA foreign_key_check")).length) throw new Error(`Foreign-key integrity check failed during ${migration.name}.`);
      await transaction.execute("INSERT INTO schema_migrations (id, name, checksum) VALUES (?, ?, ?)", [migration.id, migration.name, migration.checksum]);
    });
  } finally {
    if (migration.disableForeignKeys) await database.executeScript("PRAGMA foreign_keys = ON;");
  }
  if (Number((await database.query<ForeignKeyRow>("PRAGMA foreign_keys"))[0]?.foreign_keys) !== 1) throw new Error(`Foreign keys were not restored after ${migration.name}.`);
}

export { migrationHead, migrationRegistry };
