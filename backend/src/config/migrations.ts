import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

interface Migration {
  id: number;
  name: string;
  checksumSource: string;
  disableForeignKeys?: boolean;
  apply(database: DatabaseSync): void;
}

interface MigrationRow {
  id: number;
  name: string;
  checksum: string;
}

const migrations: Migration[] = [
  {
    id: 1,
    name: "0001_baseline",
    checksumSource: "companies-v1|company_knowledge-v1|global-website-unique",
    apply(database): void {
      database.exec(`
        CREATE TABLE IF NOT EXISTS companies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          website TEXT NOT NULL UNIQUE,
          phone TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'processing',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS company_knowledge (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_id INTEGER NOT NULL UNIQUE,
          services_json TEXT NOT NULL DEFAULT '[]',
          hours TEXT NOT NULL DEFAULT '',
          locations_json TEXT NOT NULL DEFAULT '[]',
          faq_json TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    id: 2,
    name: "0002_workspace_foundation",
    checksumSource: "workspaces-v1|companies-workspace-not-null|workspace-website-unique|preserve-company-ids|verify-counts-and-fks",
    disableForeignKeys: true,
    apply(database): void {
      database.exec(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      database.prepare(`
        INSERT INTO workspaces (key, name)
        VALUES (?, ?)
        ON CONFLICT(key) DO NOTHING
      `).run("default", "Default Workspace");

      const defaultWorkspace = database
        .prepare("SELECT id FROM workspaces WHERE key = ?")
        .get("default") as { id: number } | undefined;
      if (!defaultWorkspace) throw new Error("Default workspace could not be created.");

      const columns = database.prepare("PRAGMA table_info(companies)").all() as Array<{ name: string }>;
      if (columns.some((column) => column.name === "workspace_id")) {
        throw new Error("Workspace company schema exists without its migration record.");
      }

      const companiesBefore = readCount(database, "companies");
      const knowledgeBefore = readCount(database, "company_knowledge");

      database.exec(`
        CREATE TABLE companies_workspace_migration (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          website TEXT NOT NULL,
          phone TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'processing',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
          UNIQUE (workspace_id, website)
        );
      `);
      database.prepare(`
        INSERT INTO companies_workspace_migration (
          id, workspace_id, name, website, phone, email, status, created_at
        )
        SELECT id, ?, name, website, phone, email, status, created_at
        FROM companies
      `).run(defaultWorkspace.id);

      const copiedCompanies = readCount(database, "companies_workspace_migration");
      if (copiedCompanies !== companiesBefore) {
        throw new Error("Company row count changed during workspace migration.");
      }

      database.exec(`
        DROP TABLE companies;
        ALTER TABLE companies_workspace_migration RENAME TO companies;
        CREATE INDEX idx_companies_workspace_id_id
          ON companies(workspace_id, id DESC);
      `);

      if (readCount(database, "companies") !== companiesBefore) {
        throw new Error("Company row count verification failed after workspace migration.");
      }
      if (readCount(database, "company_knowledge") !== knowledgeBefore) {
        throw new Error("Knowledge row count changed during workspace migration.");
      }
      const unowned = database
        .prepare("SELECT COUNT(*) AS count FROM companies WHERE workspace_id IS NULL")
        .get() as { count: number };
      if (unowned.count !== 0) throw new Error("Workspace migration left unowned companies.");
    },
  },
  {
    id: 3,
    name: "0003_identity_foundation",
    checksumSource: "users-v1|authentication-identities-v1|normalized-email-unique|no-bootstrap-users",
    apply(database): void {
      database.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK (status IN ('pending_verification', 'active', 'locked', 'disabled', 'deleted')),
          locale TEXT NOT NULL CHECK (locale IN ('en', 'es')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE authentication_identities (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          email TEXT NOT NULL,
          normalized_email TEXT NOT NULL UNIQUE,
          email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_authentication_identities_user_id
          ON authentication_identities(user_id);
      `);
    },
  },
];

function migrationChecksum(migration: Migration): string {
  return createHash("sha256")
    .update(`${migration.id}:${migration.name}:${migration.checksumSource}`)
    .digest("hex");
}

function readCount(database: DatabaseSync, table: "companies" | "company_knowledge" | "companies_workspace_migration"): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function foreignKeyViolations(database: DatabaseSync): unknown[] {
  return database.prepare("PRAGMA foreign_key_check").all();
}

export function runMigrations(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const appliedRows = database
    .prepare("SELECT id, name, checksum FROM schema_migrations ORDER BY id")
    .all() as unknown as MigrationRow[];
  const knownById = new Map(migrations.map((migration) => [migration.id, migration]));

  for (const applied of appliedRows) {
    const known = knownById.get(applied.id);
    if (!known || known.name !== applied.name) {
      throw new Error(`Database contains unknown migration ${applied.id}:${applied.name}.`);
    }
    if (applied.checksum !== migrationChecksum(known)) {
      throw new Error(`Migration checksum mismatch for ${known.name}.`);
    }
  }

  const appliedIds = new Set(appliedRows.map((row) => row.id));
  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) continue;
    applyMigration(database, migration);
  }

  if (foreignKeyViolations(database).length > 0) {
    throw new Error("Foreign-key integrity check failed after migrations.");
  }
}

function applyMigration(database: DatabaseSync, migration: Migration): void {
  if (migration.disableForeignKeys) {
    database.exec("PRAGMA foreign_keys = OFF;");
    const state = database.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    if (state.foreign_keys !== 0) throw new Error(`Could not disable foreign keys for ${migration.name}.`);
  }

  try {
    database.exec("BEGIN IMMEDIATE;");
    migration.apply(database);
    if (foreignKeyViolations(database).length > 0) {
      throw new Error(`Foreign-key integrity check failed during ${migration.name}.`);
    }
    database.prepare(`
      INSERT INTO schema_migrations (id, name, checksum)
      VALUES (?, ?, ?)
    `).run(migration.id, migration.name, migrationChecksum(migration));
    database.exec("COMMIT;");
  } catch (error: unknown) {
    if (database.isTransaction) database.exec("ROLLBACK;");
    throw error;
  } finally {
    if (migration.disableForeignKeys) database.exec("PRAGMA foreign_keys = ON;");
  }

  const foreignKeyState = database.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
  if (foreignKeyState.foreign_keys !== 1) {
    throw new Error(`Foreign keys were not restored after ${migration.name}.`);
  }
  if (foreignKeyViolations(database).length > 0) {
    throw new Error(`Foreign-key integrity check failed after ${migration.name}.`);
  }
}
