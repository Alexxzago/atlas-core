import { createHash } from "node:crypto";
import type { SynchronousDatabase } from "./synchronousDatabase.js";

interface Migration {
  id: number;
  name: string;
  checksumSource: string;
  disableForeignKeys?: boolean;
  apply(database: SynchronousDatabase): void;
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
  {
    id: 4,
    name: "0004_email_verification",
    checksumSource: "email-verifications-v1|purpose-version-digest-lookup|one-current-per-identity-purpose|no-raw-proof",
    apply(database): void {
      database.exec(`
        CREATE TABLE email_verifications (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          authentication_identity_id TEXT NOT NULL,
          purpose TEXT NOT NULL CHECK (purpose = 'email_verification'),
          digest_version TEXT NOT NULL CHECK (digest_version = 'sha256-v1'),
          token_digest TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'consumed', 'superseded', 'invalidated')),
          delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending', 'accepted', 'temporary_failure', 'permanent_failure', 'uncertain')),
          issued_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          consumed_at TEXT,
          superseded_at TEXT,
          invalidated_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (authentication_identity_id) REFERENCES authentication_identities(id) ON DELETE CASCADE,
          UNIQUE (purpose, digest_version, token_digest)
        );

        CREATE UNIQUE INDEX idx_email_verifications_current_identity_purpose
          ON email_verifications(authentication_identity_id, purpose)
          WHERE status = 'pending';

        CREATE INDEX idx_email_verifications_digest_lookup
          ON email_verifications(purpose, digest_version, token_digest);
      `);
    },
  },
  {
    id: 5,
    name: "0005_authentication_sessions",
    checksumSource: "password-credentials-v1|credential-enrollment-v1|opaque-sessions-v1|login-throttle-v1|no-workspace-authority",
    apply(database): void {
      database.exec(`
        CREATE TABLE password_credentials (
          id TEXT PRIMARY KEY, authentication_identity_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('active','replaced')),
          algorithm TEXT NOT NULL CHECK(algorithm='scrypt'), algorithm_version TEXT NOT NULL, parameters TEXT NOT NULL,
          salt TEXT NOT NULL, confirmation TEXT NOT NULL, credential_version INTEGER NOT NULL CHECK(credential_version>0),
          created_at TEXT NOT NULL, replaced_at TEXT, upgraded_at TEXT,
          FOREIGN KEY(authentication_identity_id) REFERENCES authentication_identities(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX idx_password_credentials_current ON password_credentials(authentication_identity_id) WHERE state='active';
        CREATE INDEX idx_password_credentials_identity ON password_credentials(authentication_identity_id);

        CREATE TABLE credential_enrollments (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, authentication_identity_id TEXT NOT NULL,
          purpose TEXT NOT NULL CHECK(purpose='credential_enrollment'), digest_version TEXT NOT NULL CHECK(digest_version='sha256-v1'),
          proof_digest TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','consumed','superseded','invalidated')),
          delivery_status TEXT NOT NULL CHECK(delivery_status IN ('pending','accepted','temporary_failure','permanent_failure','uncertain')),
          issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, superseded_at TEXT, invalidated_at TEXT, updated_at TEXT NOT NULL,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(authentication_identity_id) REFERENCES authentication_identities(id) ON DELETE CASCADE,
          UNIQUE(purpose,digest_version,proof_digest)
        );
        CREATE UNIQUE INDEX idx_credential_enrollments_current ON credential_enrollments(authentication_identity_id,purpose) WHERE status='pending';
        CREATE INDEX idx_credential_enrollments_digest ON credential_enrollments(purpose,digest_version,proof_digest);

        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, authentication_identity_id TEXT NOT NULL, strategy TEXT NOT NULL CHECK(strategy='password'),
          authentication_version INTEGER NOT NULL, credential_version INTEGER NOT NULL, digest_version TEXT NOT NULL CHECK(digest_version='sha256-v1'),
          identifier_digest TEXT NOT NULL UNIQUE, csrf_digest TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('active','replaced','revoked','expired')),
          issued_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, idle_expires_at TEXT NOT NULL, absolute_expires_at TEXT NOT NULL,
          predecessor_id TEXT, replaced_at TEXT, revoked_at TEXT, revocation_reason TEXT,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(authentication_identity_id) REFERENCES authentication_identities(id) ON DELETE CASCADE,
          FOREIGN KEY(predecessor_id) REFERENCES sessions(id) ON DELETE SET NULL
        );
        CREATE INDEX idx_sessions_digest ON sessions(digest_version,identifier_digest);
        CREATE INDEX idx_sessions_user_state ON sessions(user_id,state);

        CREATE TABLE login_throttles (
          identity_key TEXT NOT NULL, origin_key TEXT NOT NULL, failure_count INTEGER NOT NULL,
          first_failure_at TEXT NOT NULL, last_failure_at TEXT NOT NULL, expires_at TEXT NOT NULL,
          PRIMARY KEY(identity_key,origin_key)
        );
        CREATE INDEX idx_login_throttles_expiry ON login_throttles(expires_at);
      `);
    },
  },
  {
    id:6,
    name:"0006_workspace_memberships_invitations",
    checksumSource:"workspace-public-ids-v1|memberships-v1|invitations-v1|workspace-selection-v1|no-bootstrap-authority",
    apply(database):void{
      database.exec(`
        ALTER TABLE workspaces ADD COLUMN public_id TEXT;
        UPDATE workspaces SET public_id='wsp_' || lower(hex(randomblob(16))) WHERE public_id IS NULL;
        CREATE UNIQUE INDEX idx_workspaces_public_id ON workspaces(public_id);

        CREATE TABLE memberships (
          id TEXT PRIMARY KEY, workspace_id INTEGER NOT NULL, user_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('owner','administrator','operator','viewer')),
          status TEXT NOT NULL CHECK(status IN ('active','suspended','removed')), version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL, activated_at TEXT NOT NULL, suspended_at TEXT, reactivated_at TEXT, removed_at TEXT, role_changed_at TEXT,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT
        );
        CREATE UNIQUE INDEX idx_memberships_current_user_workspace ON memberships(user_id,workspace_id) WHERE status!='removed';
        CREATE INDEX idx_memberships_user_status ON memberships(user_id,status,workspace_id);
        CREATE INDEX idx_memberships_workspace_status ON memberships(workspace_id,status);
        CREATE INDEX idx_memberships_active_owners ON memberships(workspace_id,role,status) WHERE role='owner' AND status='active';

        CREATE TABLE workspace_invitations (
          id TEXT PRIMARY KEY, workspace_id INTEGER NOT NULL, issuer_membership_id TEXT NOT NULL, issuer_user_id TEXT NOT NULL,
          recipient_normalized_email TEXT NOT NULL, proposed_role TEXT NOT NULL CHECK(proposed_role IN ('administrator','operator','viewer')),
          purpose TEXT NOT NULL CHECK(purpose='workspace_invitation'), digest_version TEXT NOT NULL CHECK(digest_version='sha256-v1'), proof_digest TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','revoked','expired','superseded')),
          delivery_status TEXT NOT NULL CHECK(delivery_status IN ('pending','accepted','temporary_failure','permanent_failure','uncertain')),
          version INTEGER NOT NULL DEFAULT 1, issued_at TEXT NOT NULL, expires_at TEXT NOT NULL,
          accepted_at TEXT, accepted_by_user_id TEXT, accepted_ip TEXT, accepted_user_agent TEXT,
          rejected_at TEXT, revoked_at TEXT, superseded_at TEXT, updated_at TEXT NOT NULL,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
          FOREIGN KEY(issuer_membership_id) REFERENCES memberships(id) ON DELETE RESTRICT,
          FOREIGN KEY(issuer_user_id) REFERENCES users(id) ON DELETE RESTRICT,
          FOREIGN KEY(accepted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
        );
        CREATE UNIQUE INDEX idx_invitations_current_recipient ON workspace_invitations(workspace_id,recipient_normalized_email) WHERE status='pending';
        CREATE INDEX idx_invitations_digest ON workspace_invitations(purpose,digest_version,proof_digest);
        CREATE INDEX idx_invitations_workspace_status ON workspace_invitations(workspace_id,status,expires_at);

        CREATE TABLE workspace_selections (
          user_id TEXT PRIMARY KEY, workspace_id INTEGER NOT NULL, selected_at TEXT NOT NULL,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );
        CREATE INDEX idx_workspace_selections_workspace ON workspace_selections(workspace_id);
      `);
    },
  },
  {
    id: 7,
    name: "0007_assistant_profiles",
    checksumSource: "assistant-profiles-v1|company-owned-multiple|normalized-name-unique|mutable-lifecycle|no-bootstrap-profiles",
    apply(database): void {
      database.exec(`
        CREATE TABLE assistant_profiles (
          id TEXT PRIMARY KEY,
          company_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          normalized_name TEXT NOT NULL,
          description TEXT,
          business_role TEXT,
          objective TEXT,
          audience TEXT,
          tone TEXT NOT NULL CHECK(tone IN ('professional','friendly','concise','empathetic')),
          assistant_language TEXT NOT NULL CHECK(assistant_language IN ('es','en')),
          welcome_message TEXT,
          fallback_message TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('draft','ready','disabled','archived')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT,
          FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,
          UNIQUE(company_id,normalized_name),
          CHECK((status='archived' AND archived_at IS NOT NULL) OR (status!='archived' AND archived_at IS NULL))
        );
        CREATE INDEX idx_assistant_profiles_company_status_created
          ON assistant_profiles(company_id,status,created_at DESC,id DESC);
      `);
    },
  },
  {
    id: 8,
    name: "0008_session_csrf_generation",
    checksumSource: "session-csrf-generation-v1|positive-generation|preserve-session-identifiers",
    apply(database): void {
      database.exec(`
        ALTER TABLE sessions
        ADD COLUMN csrf_generation INTEGER NOT NULL DEFAULT 1
        CHECK (csrf_generation > 0);
      `);
    },
  },
  {
    id: 9,
    name: "0009_company_knowledge_foundation",
    checksumSource: "knowledge-sources-v1|immutable-revisions-v1|published-versions-v1|single-current-publication-v1|legacy-backfill-v1",
    apply(database): void {
      database.exec(`
        CREATE TABLE knowledge_sources (
          id TEXT PRIMARY KEY,
          company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK(kind IN ('manual_text','public_url','pdf')),
          origin TEXT NOT NULL CHECK(origin IN ('user','legacy_migration')),
          name TEXT NOT NULL, normalized_name TEXT NOT NULL, locator TEXT,
          status TEXT NOT NULL CHECK(status IN ('active','archived')),
          version INTEGER NOT NULL CHECK(version > 0),
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT,
          UNIQUE(company_id, normalized_name),
          CHECK((kind='public_url' AND locator IS NOT NULL) OR (kind!='public_url' AND locator IS NULL)),
          CHECK((status='archived' AND archived_at IS NOT NULL) OR (status='active' AND archived_at IS NULL))
        );
        CREATE INDEX idx_knowledge_sources_company_status_created ON knowledge_sources(company_id,status,created_at DESC,id DESC);

        CREATE TABLE knowledge_source_revisions (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
          revision_number INTEGER NOT NULL CHECK(revision_number > 0),
          status TEXT NOT NULL CHECK(status IN ('pending','ready','failed')),
          media_type TEXT NOT NULL, content_digest TEXT, normalized_text TEXT, extracted_knowledge_json TEXT,
          extractor_schema_version TEXT NOT NULL CHECK(extractor_schema_version='company-business-knowledge-v1'),
          input_bytes INTEGER NOT NULL CHECK(input_bytes >= 0), normalized_bytes INTEGER, normalized_characters INTEGER,
          page_count INTEGER, failure_code TEXT, created_at TEXT NOT NULL, completed_at TEXT,
          UNIQUE(source_id,revision_number),
          CHECK((status='pending' AND completed_at IS NULL AND failure_code IS NULL AND content_digest IS NULL AND extracted_knowledge_json IS NULL)
             OR (status='failed' AND completed_at IS NOT NULL AND failure_code IS NOT NULL AND content_digest IS NULL AND normalized_text IS NULL AND extracted_knowledge_json IS NULL)
             OR (status='ready' AND completed_at IS NOT NULL AND failure_code IS NULL AND content_digest IS NOT NULL AND extracted_knowledge_json IS NOT NULL))
        );
        CREATE UNIQUE INDEX idx_knowledge_revision_pending ON knowledge_source_revisions(source_id) WHERE status='pending';
        CREATE INDEX idx_knowledge_revision_source_number ON knowledge_source_revisions(source_id,revision_number DESC);
        CREATE TABLE company_knowledge_versions (
          id TEXT PRIMARY KEY,
          company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL CHECK(version_number > 0),
          compiler_version TEXT NOT NULL CHECK(compiler_version='company-knowledge-compiler-v1'),
          knowledge_json TEXT NOT NULL, snapshot_digest TEXT NOT NULL,
          published_by_actor_id TEXT NOT NULL, published_at TEXT NOT NULL,
          UNIQUE(company_id,version_number), UNIQUE(company_id,snapshot_digest)
        );
        CREATE INDEX idx_knowledge_versions_company_published ON company_knowledge_versions(company_id,published_at DESC,id DESC);

        CREATE TABLE company_knowledge_version_sources (
          knowledge_version_id TEXT NOT NULL REFERENCES company_knowledge_versions(id) ON DELETE CASCADE,
          source_revision_id TEXT NOT NULL REFERENCES knowledge_source_revisions(id) ON DELETE CASCADE,
          ordinal INTEGER NOT NULL CHECK(ordinal > 0),
          PRIMARY KEY(knowledge_version_id,source_revision_id), UNIQUE(knowledge_version_id,ordinal)
        );

        CREATE TABLE company_knowledge_publications (
          company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
          knowledge_version_id TEXT NOT NULL UNIQUE REFERENCES company_knowledge_versions(id) ON DELETE CASCADE,
          publication_version INTEGER NOT NULL CHECK(publication_version > 0),
          published_by_actor_id TEXT NOT NULL, published_at TEXT NOT NULL
        );
      `);

      const rows = database.prepare(`
        SELECT k.company_id,k.services_json,k.hours,k.locations_json,k.faq_json,k.updated_at,
               c.name,c.website,c.phone,c.email
        FROM company_knowledge k INNER JOIN companies c ON c.id=k.company_id ORDER BY k.company_id
      `).all() as Array<Record<string, string | number>>;
      for (const row of rows) {
        const companyId = Number(row.company_id), sourceId = `ksrc_${createHash("sha256").update(`legacy-source:${companyId}`).digest("hex").slice(0,32)}`;
        const revisionId = `ksrv_${createHash("sha256").update(`legacy-revision:${companyId}`).digest("hex").slice(0,32)}`;
        const versionId = `kver_${createHash("sha256").update(`legacy-version:${companyId}`).digest("hex").slice(0,32)}`;
        const extracted = JSON.stringify({ services: JSON.parse(String(row.services_json)), hours: String(row.hours), locations: JSON.parse(String(row.locations_json)), faq: JSON.parse(String(row.faq_json)) });
        const knowledge = JSON.stringify({ company: { name: String(row.name), website: String(row.website), phone: String(row.phone), email: String(row.email) }, business: { services: JSON.parse(String(row.services_json)), hours: String(row.hours), locations: JSON.parse(String(row.locations_json)) }, faq: JSON.parse(String(row.faq_json)) });
        const digest = createHash("sha256").update(`company-knowledge-compiler-v1\n${revisionId}\n${knowledge}`).digest("hex");
        const publishedAt = String(row.updated_at);
        database.prepare("INSERT INTO knowledge_sources VALUES(?,?,'manual_text','legacy_migration','Migrated knowledge','migrated knowledge',NULL,'active',1,?,?,NULL)").run(sourceId,companyId,publishedAt,publishedAt);
        database.prepare("INSERT INTO knowledge_source_revisions VALUES(?,?,1,'ready','text/plain',?,NULL,?,'company-business-knowledge-v1',0,NULL,NULL,NULL,NULL,?,?)").run(revisionId,sourceId,createHash("sha256").update(extracted).digest("hex"),extracted,publishedAt,publishedAt);
        database.prepare("INSERT INTO company_knowledge_versions VALUES(?,?,1,'company-knowledge-compiler-v1',?,?,'system:legacy-migration',?)").run(versionId,companyId,knowledge,digest,publishedAt);
        database.prepare("INSERT INTO company_knowledge_version_sources VALUES(?,?,1)").run(versionId,revisionId);
        database.prepare("INSERT INTO company_knowledge_publications VALUES(?,?,1,'system:legacy-migration',?)").run(companyId,versionId,publishedAt);
      }
      database.exec(`
        ALTER TABLE company_knowledge RENAME TO company_knowledge_legacy;
        CREATE VIEW company_knowledge AS SELECT id,company_id,services_json,hours,locations_json,faq_json,updated_at FROM company_knowledge_legacy;
      `);
    },
  },
  {
    id: 10,
    name: "0010_company_knowledge_runtime_cutover",
    checksumSource: "drop-company-knowledge-view-v1|legacy-only-ready-null-text-insert-update-v1|preserve-knowledge-graph-v1",
    apply(database): void {
      database.exec(`
        DROP VIEW IF EXISTS company_knowledge;
        CREATE TRIGGER knowledge_ready_null_text_legacy_only
        BEFORE INSERT ON knowledge_source_revisions
        WHEN NEW.status='ready' AND NEW.normalized_text IS NULL
             AND NOT EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.source_id AND origin='legacy_migration')
        BEGIN SELECT RAISE(ABORT,'ready null text requires legacy migration origin'); END;
        CREATE TRIGGER knowledge_ready_null_text_legacy_only_update
        BEFORE UPDATE OF status,normalized_text,source_id ON knowledge_source_revisions
        WHEN NEW.status='ready' AND NEW.normalized_text IS NULL
             AND NOT EXISTS(SELECT 1 FROM knowledge_sources WHERE id=NEW.source_id AND origin='legacy_migration')
        BEGIN SELECT RAISE(ABORT,'ready null text requires legacy migration origin'); END;
      `);
    },
  },
];

function migrationChecksum(migration: Migration): string {
  return createHash("sha256")
    .update(`${migration.id}:${migration.name}:${migration.checksumSource}`)
    .digest("hex");
}

function readCount(database: SynchronousDatabase, table: "companies" | "company_knowledge" | "companies_workspace_migration"): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function foreignKeyViolations(database: SynchronousDatabase): unknown[] {
  return database.prepare("PRAGMA foreign_key_check").all();
}

export function runMigrations(database: SynchronousDatabase, maximumMigrationId = Number.POSITIVE_INFINITY): void {
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
    if (migration.id > maximumMigrationId) continue;
    if (appliedIds.has(migration.id)) continue;
    applyMigration(database, migration);
  }

  if (foreignKeyViolations(database).length > 0) {
    throw new Error("Foreign-key integrity check failed after migrations.");
  }
}

function applyMigration(database: SynchronousDatabase, migration: Migration): void {
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
