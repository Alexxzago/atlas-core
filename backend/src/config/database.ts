import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrations.js";
import { createLibsqlDatabase, type SqlDatabase } from "./sqlDatabase.js";
import { SynchronousLibsqlDatabase, type SynchronousDatabase } from "./synchronousDatabase.js";
import { productionConfiguration, productionDatabaseConfiguration, type ProductionConfiguration, type ProductionDatabaseConfiguration } from "./productionConfiguration.js";

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

export interface ProductionRuntimeDatabase { readonly database: SynchronousDatabase; readonly configuration: ProductionConfiguration; }

/** Validates every production dependency before opening the runtime database or applying migrations. */
export function createProductionRuntimeDatabase(environment: NodeJS.ProcessEnv, factory: (configuration: ProductionDatabaseConfiguration) => SynchronousDatabase): ProductionRuntimeDatabase {
  const configuration = productionConfiguration(environment);
  const instance = factory(configuration.database);
  try { runMigrations(instance); return Object.freeze({ database: instance, configuration }); }
  catch (error: unknown) { instance.close(); throw error; }
}

function createRuntimeDatabase(): { readonly database: SynchronousDatabase; readonly configuration: ProductionConfiguration | null } {
  if (process.env.NODE_ENV !== "production") return Object.freeze({ database: createDatabase(databasePath), configuration: null });
  const runtime = createProductionRuntimeDatabase(process.env, (configuration) => new SynchronousLibsqlDatabase(configuration.url, configuration.authToken));
  return Object.freeze(runtime);
}

const runtime = createRuntimeDatabase();
export const database = runtime.database;
export const runtimeProductionConfiguration = runtime.configuration;
