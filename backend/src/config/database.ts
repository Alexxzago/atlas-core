import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrations.js";
import { runAsyncMigrations } from "./asyncMigrations.js";
import { createLibsqlDatabase, DeferredSqlDatabase, LocalSqlDatabase, type SqlDatabase } from "./sqlDatabase.js";
import type { SynchronousDatabase, SqlStatement } from "./synchronousDatabase.js";
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
  const database = createLibsqlDatabase(configuration.url, configuration.authToken);
  try {
    await runAsyncMigrations(database);
    return database;
  } catch (error: unknown) {
    await database.close();
    throw error;
  }
}

export interface ProductionRuntimeDatabase { readonly database: SynchronousDatabase; readonly configuration: ProductionConfiguration; }

/** Validates every production dependency before opening the runtime database or applying migrations. */
export function createProductionRuntimeDatabase(environment: NodeJS.ProcessEnv, factory: (configuration: ProductionDatabaseConfiguration) => SynchronousDatabase): ProductionRuntimeDatabase {
  const configuration = productionConfiguration(environment);
  const instance = factory(configuration.database);
  try { runMigrations(instance); return Object.freeze({ database: instance, configuration }); }
  catch (error: unknown) { instance.close(); throw error; }
}

class LocalSynchronousDatabase implements SynchronousDatabase {
  private database: SynchronousDatabase | null = null;

  private current(): SynchronousDatabase {
    if (process.env.NODE_ENV === "production") throw new Error("Synchronous database access is unavailable in production.");
    this.database ??= createDatabase(databasePath);
    return this.database;
  }

  public prepare(sql: string): SqlStatement { return this.current().prepare(sql); }
  public exec(sql: string): void { this.current().exec(sql); }
  public get isTransaction(): boolean { return this.current().isTransaction; }
  public close(): void { this.database?.close(); }
}

const production = process.env.NODE_ENV === "production";
const runtimeConfiguration = production ? productionConfiguration(process.env) : null;
export const database: SynchronousDatabase = new LocalSynchronousDatabase();
export const sqlDatabase: SqlDatabase = production
  ? new DeferredSqlDatabase(() => createProductionDatabase())
  : new LocalSqlDatabase(createDatabase(databasePath));
export async function initializeSqlDatabase(): Promise<void> { if (sqlDatabase instanceof DeferredSqlDatabase) await sqlDatabase.initialize(); }
export const runtimeProductionConfiguration = runtimeConfiguration;
