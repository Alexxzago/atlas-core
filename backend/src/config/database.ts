import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrations.js";
import { createLibsqlDatabase, type SqlDatabase } from "./sqlDatabase.js";
import { SynchronousLibsqlDatabase, type SynchronousDatabase } from "./synchronousDatabase.js";

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

export interface ProductionDatabaseConfiguration {
  readonly provider: "libsql";
  readonly url: string;
  readonly authToken: string;
}

export function productionDatabaseConfiguration(environment: NodeJS.ProcessEnv = process.env): ProductionDatabaseConfiguration {
  if (environment.NODE_ENV !== "production") {
    throw new Error("Production database configuration is only available when NODE_ENV=production.");
  }
  if (environment.DATABASE_PROVIDER !== "libsql") {
    throw new Error("Production requires DATABASE_PROVIDER=libsql; local SQLite is not permitted.");
  }
  const url = environment.TURSO_DATABASE_URL?.trim();
  const authToken = environment.TURSO_AUTH_TOKEN?.trim();
  if (!url || !authToken) {
    throw new Error("Production requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
  }
  if (!/^libsqls?:\/\//i.test(url) && !/^https:\/\//i.test(url)) {
    throw new Error("TURSO_DATABASE_URL must be a libsql or HTTPS URL.");
  }
  return { provider: "libsql", url, authToken };
}

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
