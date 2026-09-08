import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrations.js";
import { createLibsqlDatabase, type SqlDatabase } from "./sqlDatabase.js";
import { SynchronousLibsqlDatabase, type SynchronousDatabase } from "./synchronousDatabase.js";
import { productionDatabaseConfiguration, type ProductionDatabaseConfiguration } from "./productionConfiguration.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const databasePath = resolve(projectRoot, "database/atlas.sqlite");

export function createDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const instance = new DatabaseSync(path);
  try {
    instance.exec("PRAGMA foreign_keys = ON;");
    runMigrations(instance);
    return instance;
  } catch (error: unknown) {
    instance.close();
    throw error;
  }
}

export { productionDatabaseConfiguration, type ProductionDatabaseConfiguration };

export async function createProductionDatabase(environment: NodeJS.ProcessEnv = process.env): Promise<SqlDatabase> {
  const configuration = productionDatabaseConfiguration(environment);
  return createLibsqlDatabase(configuration.url, configuration.authToken);
}

// The synchronous export is intentionally test/development-only. Production composition must use createProductionDatabase.
function createRuntimeDatabase(): SynchronousDatabase {
  if (process.env.NODE_ENV !== "production") return createDatabase(databasePath);
  const configuration = productionDatabaseConfiguration();
  const instance = new SynchronousLibsqlDatabase(configuration.url, configuration.authToken);
  try { runMigrations(instance); return instance; }
  catch (error: unknown) { instance.close(); throw error; }
}

export const database = createRuntimeDatabase();
