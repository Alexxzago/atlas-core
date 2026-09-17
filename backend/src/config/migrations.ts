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
  {
    id: 11,
    name: "0011_platform_bootstrap",
    checksumSource: "platform-bootstrap-claim-v1|singleton-default-workspace|no-raw-setup-secret",
    apply(database): void {
      database.exec(`
        CREATE TABLE platform_bootstrap (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          claimed_by_user_id TEXT,
          claimed_at TEXT,
          FOREIGN KEY (claimed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
          CHECK ((claimed_by_user_id IS NULL AND claimed_at IS NULL)
            OR (claimed_by_user_id IS NOT NULL AND claimed_at IS NOT NULL))
        );
        INSERT INTO platform_bootstrap (singleton, claimed_by_user_id, claimed_at)
        VALUES (1, NULL, NULL);
      `);
    },
  },
  {
    id: 12,
    name: "0012_operational_assistant_runtime",
    checksumSource: "assistant-execution-records-v1|profile-runtime-snapshots-v1|published-knowledge-reference-v1|no-input-persistence",
    apply(database): void {
      database.exec(`
        CREATE TABLE assistant_execution_records (
          id TEXT PRIMARY KEY,
          company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          assistant_profile_id TEXT NOT NULL REFERENCES assistant_profiles(id) ON DELETE CASCADE,
          profile_snapshot_json TEXT NOT NULL,
          knowledge_version_id TEXT NOT NULL REFERENCES company_knowledge_versions(id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          purpose TEXT NOT NULL CHECK (purpose IN ('preview', 'operational_execution')),
          state TEXT NOT NULL CHECK (state IN ('started', 'answered', 'safe_fallback', 'failed')),
          fallback_used INTEGER NOT NULL CHECK (fallback_used IN (0, 1)),
          result TEXT,
          input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
          output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
          error_code TEXT,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          duration_milliseconds INTEGER,
          CHECK ((state = 'started' AND completed_at IS NULL AND duration_milliseconds IS NULL AND result IS NULL AND error_code IS NULL)
            OR (state IN ('answered', 'safe_fallback') AND completed_at IS NOT NULL AND duration_milliseconds >= 0 AND result IS NOT NULL AND error_code IS NULL)
            OR (state = 'failed' AND completed_at IS NOT NULL AND duration_milliseconds >= 0 AND result IS NULL AND error_code IS NOT NULL))
        );
        CREATE INDEX idx_assistant_execution_records_company_started
          ON assistant_execution_records(company_id, started_at DESC, id DESC);
        CREATE INDEX idx_assistant_execution_records_profile_started
          ON assistant_execution_records(assistant_profile_id, started_at DESC, id DESC);
      `);
    },
  },
  {
    id: 13,
    name: "0013_conversation_domain_foundation",
    checksumSource: "company-conversations-v1|neutral-participants-v1|neutral-messages-v1|nullable-idempotency-key-v1",
    apply(database): void {
      database.exec(`
        CREATE TABLE conversations (
          id TEXT PRIMARY KEY,
          company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          state TEXT NOT NULL CHECK (state IN ('open','closed')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          closed_at TEXT,
          CHECK ((state='open' AND closed_at IS NULL) OR (state='closed' AND closed_at IS NOT NULL))
        );
        CREATE INDEX idx_conversations_company_created ON conversations(company_id,created_at DESC,id DESC);

        CREATE TABLE conversation_participants (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          participant_type TEXT NOT NULL,
          reference TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_conversation_participants_conversation_created ON conversation_participants(conversation_id,created_at,id);

        CREATE TABLE conversation_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          sender_participant_id TEXT NOT NULL REFERENCES conversation_participants(id) ON DELETE CASCADE,
          direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
          content TEXT NOT NULL,
          idempotency_key TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_conversation_messages_conversation_created ON conversation_messages(conversation_id,created_at,id);
      `);
    },
  },
  {
    id: 14,
    name: "0014_conversation_execution_record_link",
    checksumSource: "conversation-outbound-execution-record-reference-v1",
    apply(database): void {
      database.exec(`
        ALTER TABLE conversation_messages
        ADD COLUMN assistant_execution_record_id TEXT
          REFERENCES assistant_execution_records(id) ON DELETE SET NULL;
        CREATE INDEX idx_conversation_messages_execution_record
          ON conversation_messages(assistant_execution_record_id)
          WHERE assistant_execution_record_id IS NOT NULL;
      `);
    },
  },
  {
    id: 15,
    name: "0015_web_chat_connections",
    checksumSource: "web-chat-connection-binding-v1|opaque-public-id-v1|active-inactive-v1",
    apply(database): void {
      database.exec(`
        CREATE TABLE web_chat_connections (
          id TEXT PRIMARY KEY,
          public_id TEXT NOT NULL UNIQUE,
          workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
          company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          assistant_profile_id TEXT NOT NULL REFERENCES assistant_profiles(id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK (status IN ('active','inactive')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_web_chat_connections_workspace ON web_chat_connections(workspace_id,id);
        CREATE INDEX idx_web_chat_connections_company_created ON web_chat_connections(company_id,created_at DESC,id DESC);
        CREATE INDEX idx_web_chat_connections_profile ON web_chat_connections(assistant_profile_id);
      `);
    },
  },
  {
    id: 16,
    name: "0016_web_chat_sessions",
    checksumSource: "anonymous-web-chat-session-v1|opaque-token-digest-v1|conversation-participant-binding-v1",
    apply(database): void {
      database.exec(`
        CREATE TABLE web_chat_sessions (
          id TEXT PRIMARY KEY,
          web_chat_connection_id TEXT NOT NULL REFERENCES web_chat_connections(id) ON DELETE RESTRICT,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
          visitor_participant_id TEXT NOT NULL REFERENCES conversation_participants(id) ON DELETE RESTRICT,
          responder_participant_id TEXT NOT NULL REFERENCES conversation_participants(id) ON DELETE RESTRICT,
          token_digest TEXT NOT NULL UNIQUE,
          state TEXT NOT NULL CHECK (state IN ('active','expired','closed')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL
        );
        CREATE INDEX idx_web_chat_sessions_connection ON web_chat_sessions(web_chat_connection_id);
        CREATE INDEX idx_web_chat_sessions_conversation ON web_chat_sessions(conversation_id);
        CREATE INDEX idx_web_chat_sessions_expires ON web_chat_sessions(expires_at);
        CREATE INDEX idx_web_chat_sessions_state_expires ON web_chat_sessions(state,expires_at);
      `);
    },
  },
  {
    id: 17,
    name: "0017_conversation_channel_metadata",
    checksumSource: "conversation-channel-v1|internal-web-chat-whatsapp|existing-internal-default",
    apply(database): void {
      database.exec(`
        ALTER TABLE conversations
        ADD COLUMN channel TEXT NOT NULL DEFAULT 'internal'
          CHECK (channel IN ('internal','web_chat','whatsapp'));
        CREATE INDEX idx_conversations_company_channel_created
          ON conversations(company_id,channel,created_at DESC,id DESC);
      `);
    },
  },
  {
    id: 18,
    name: "0018_whatsapp_connections_bindings",
    checksumSource: "whatsapp-connection-v1|phone-number-global-unique|connection-wa-id-binding-v1",
    apply(database): void {
      database.exec(`
        CREATE TABLE whatsapp_connections (
          id TEXT PRIMARY KEY,
          workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
          company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          assistant_profile_id TEXT NOT NULL REFERENCES assistant_profiles(id) ON DELETE CASCADE,
          phone_number_id TEXT NOT NULL UNIQUE,
          whatsapp_business_account_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active','inactive')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_whatsapp_connections_workspace ON whatsapp_connections(workspace_id,id);
        CREATE INDEX idx_whatsapp_connections_company_created ON whatsapp_connections(company_id,created_at DESC,id DESC);
        CREATE INDEX idx_whatsapp_connections_profile ON whatsapp_connections(assistant_profile_id);

        CREATE TABLE whatsapp_conversation_bindings (
          id TEXT PRIMARY KEY,
          whatsapp_connection_id TEXT NOT NULL REFERENCES whatsapp_connections(id) ON DELETE CASCADE,
          wa_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          customer_participant_id TEXT NOT NULL REFERENCES conversation_participants(id) ON DELETE CASCADE,
          assistant_participant_id TEXT NOT NULL REFERENCES conversation_participants(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (whatsapp_connection_id,wa_id)
        );
        CREATE INDEX idx_whatsapp_conversation_bindings_conversation ON whatsapp_conversation_bindings(conversation_id);
      `);
    },
  },
  {
    id: 19,
    name: "0019_channel_provider_events_messages",
    checksumSource: "channel-provider-event-v1|provider-message-record-v1|external-idempotency-v1",
    apply(database): void {
      database.exec(`
        CREATE TABLE channel_provider_events (
          id TEXT PRIMARY KEY,
          communication_channel TEXT NOT NULL CHECK (communication_channel IN ('internal','web_chat','whatsapp')),
          transport_provider TEXT NOT NULL,
          transport_connection_id TEXT NOT NULL,
          external_event_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('claimed','processing','completed','failed')),
          conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
          conversation_message_id TEXT REFERENCES conversation_messages(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (transport_provider,external_event_id)
        );
        CREATE INDEX idx_channel_provider_events_connection_state
          ON channel_provider_events(transport_connection_id,state,created_at);

        CREATE TABLE provider_message_records (
          id TEXT PRIMARY KEY,
          communication_channel TEXT NOT NULL CHECK (communication_channel IN ('internal','web_chat','whatsapp')),
          transport_provider TEXT NOT NULL,
          direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
          transport_connection_id TEXT NOT NULL,
          conversation_message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
          external_message_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (transport_provider,external_message_id),
          UNIQUE (transport_provider,transport_connection_id,conversation_message_id)
        );
        CREATE INDEX idx_provider_message_records_message ON provider_message_records(conversation_message_id);
      `);
    },
  },
  {
    id: 20,
    name: "0020_outbound_deliveries",
    checksumSource: "outbound-delivery-v1|provider-message-connection-unique|lease-ready",
    apply(database): void {
      database.exec(`
        CREATE TABLE outbound_deliveries (
          id TEXT PRIMARY KEY,
          provider_message_record_id TEXT NOT NULL REFERENCES provider_message_records(id) ON DELETE CASCADE,
          transport_connection_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('pending','leased','accepted','retryable','permanent_failure','uncertain')),
          attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
          next_attempt_at TEXT NOT NULL,
          lease_owner TEXT,
          lease_expires_at TEXT,
          safe_error_category TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK ((lease_owner IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
          UNIQUE (provider_message_record_id,transport_connection_id)
        );
        CREATE INDEX idx_outbound_deliveries_ready
          ON outbound_deliveries(state,next_attempt_at,id);
        CREATE INDEX idx_outbound_deliveries_lease
          ON outbound_deliveries(state,lease_expires_at,id);
      `);
    },
  },
  {
    id: 21,
    name: "0021_whatsapp_connection_credentials_state",
    checksumSource: "whatsapp-company-credential-ciphertext-v1|whatsapp-redacted-operational-state-v1",
    apply(database): void {
      database.exec(`
        CREATE TABLE whatsapp_connection_credentials (
          whatsapp_connection_id TEXT PRIMARY KEY REFERENCES whatsapp_connections(id) ON DELETE CASCADE,
          encrypted_access_token TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE whatsapp_connection_operational_states (
          whatsapp_connection_id TEXT PRIMARY KEY REFERENCES whatsapp_connections(id) ON DELETE CASCADE,
          validation_state TEXT NOT NULL CHECK (validation_state IN ('not_validated','valid','invalid')),
          validated_at TEXT,
          validation_failure_code TEXT CHECK (validation_failure_code IN ('credentials_invalid','provider_identity_mismatch','provider_unavailable')),
          health_state TEXT NOT NULL CHECK (health_state IN ('inactive','healthy','degraded')),
          last_provider_activity_at TEXT,
          last_webhook_activity_at TEXT,
          health_failure_code TEXT CHECK (health_failure_code IN ('credentials_invalid','provider_identity_mismatch','provider_unavailable')),
          updated_at TEXT NOT NULL,
          CHECK (
            (validation_state = 'not_validated' AND validated_at IS NULL AND validation_failure_code IS NULL)
            OR (validation_state = 'valid' AND validated_at IS NOT NULL AND validation_failure_code IS NULL)
            OR (validation_state = 'invalid' AND validated_at IS NOT NULL AND validation_failure_code IS NOT NULL)
          ),
          CHECK (
            (health_state = 'degraded' AND health_failure_code IS NOT NULL)
            OR (health_state IN ('inactive','healthy') AND health_failure_code IS NULL)
          )
        );

        INSERT INTO whatsapp_connection_operational_states(
          whatsapp_connection_id,validation_state,validated_at,validation_failure_code,health_state,
          last_provider_activity_at,last_webhook_activity_at,health_failure_code,updated_at
        )
        SELECT id,'not_validated',NULL,NULL,'inactive',NULL,NULL,NULL,updated_at
        FROM whatsapp_connections;

        CREATE TRIGGER whatsapp_connections_seed_operational_state
        AFTER INSERT ON whatsapp_connections
        BEGIN
          INSERT INTO whatsapp_connection_operational_states(
            whatsapp_connection_id,validation_state,validated_at,validation_failure_code,health_state,
            last_provider_activity_at,last_webhook_activity_at,health_failure_code,updated_at
          ) VALUES (NEW.id,'not_validated',NULL,NULL,'inactive',NULL,NULL,NULL,NEW.updated_at);
        END;
      `);
    },
  },
  {
    id: 22,
    name: "0022_whatsapp_one_active_connection_per_company",
    checksumSource: "whatsapp-company-single-active-connection-v1",
    apply(database): void {
      database.exec(`
        UPDATE whatsapp_connections SET status='inactive'
        WHERE status='active' AND id NOT IN (
          SELECT MAX(id) FROM whatsapp_connections WHERE status='active' GROUP BY company_id
        );
        CREATE UNIQUE INDEX idx_whatsapp_connections_one_active_per_company ON whatsapp_connections(company_id) WHERE status='active';
      `);
    },
  },
  {
    id: 23,
    name: "0023_conversation_controls",
    checksumSource: "conversation-control-state-v1|lazy-default-control-v1|safe-conversation-projections-v1",
    apply(database): void {
      database.exec(`
        CREATE TABLE conversation_controls (
          conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
          state TEXT NOT NULL CHECK (state IN ('automated','human_required','human_controlled')),
          controlling_actor_id TEXT,
          last_controlling_actor_id TEXT,
          taken_at TEXT,
          released_at TEXT,
          last_operator_activity_at TEXT,
          attention_reason TEXT CHECK (attention_reason IN ('customer_request','automation_failure','policy_escalation','operator_follow_up')),
          resolved_at TEXT,
          resolved_by TEXT,
          version INTEGER NOT NULL CHECK (version >= 1),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK ((state = 'human_controlled' AND controlling_actor_id IS NOT NULL AND taken_at IS NOT NULL) OR (state IN ('automated','human_required') AND controlling_actor_id IS NULL)),
          CHECK (released_at IS NULL OR controlling_actor_id IS NULL),
          CHECK ((resolved_at IS NULL AND resolved_by IS NULL) OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)),
          CHECK (updated_at >= created_at),
          CHECK (taken_at IS NULL OR taken_at >= created_at),
          CHECK (released_at IS NULL OR (taken_at IS NOT NULL AND released_at >= taken_at)),
          CHECK (last_operator_activity_at IS NULL OR last_operator_activity_at >= created_at),
          CHECK (resolved_at IS NULL OR resolved_at >= created_at)
        );
        CREATE INDEX idx_conversation_controls_state_updated
          ON conversation_controls(state,updated_at DESC,conversation_id DESC);
      `);
    },
  },
  {
    id: 24,
    name: "0024_operator_message_idempotency",
    checksumSource: "conversation-message-scoped-idempotency-v1",
    apply(database): void {
      database.exec(`
        CREATE UNIQUE INDEX idx_conversation_messages_idempotency
          ON conversation_messages(conversation_id,idempotency_key)
          WHERE idempotency_key IS NOT NULL;
      `);
    },
  },
  {
    id: 25,
    name: "0025_outbound_delivery_lifecycle",
    checksumSource: "outbound-delivery-delivered-read-v1|preserve-delivery-rows-indexes-fks",
    apply(database): void {
      const count = readCount(database, "outbound_deliveries" as never);
      database.exec(`
        CREATE TABLE outbound_deliveries_lifecycle (
          id TEXT PRIMARY KEY, provider_message_record_id TEXT NOT NULL REFERENCES provider_message_records(id) ON DELETE CASCADE,
          transport_connection_id TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('pending','leased','accepted','delivered','read','retryable','permanent_failure','uncertain')),
          attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0), next_attempt_at TEXT NOT NULL, lease_owner TEXT, lease_expires_at TEXT,
          safe_error_category TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          CHECK ((lease_owner IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)), UNIQUE (provider_message_record_id,transport_connection_id)
        );
        INSERT INTO outbound_deliveries_lifecycle SELECT * FROM outbound_deliveries;
        DROP TABLE outbound_deliveries;
        ALTER TABLE outbound_deliveries_lifecycle RENAME TO outbound_deliveries;
        CREATE INDEX idx_outbound_deliveries_ready ON outbound_deliveries(state,next_attempt_at,id);
        CREATE INDEX idx_outbound_deliveries_lease ON outbound_deliveries(state,lease_expires_at,id);
      `);
      if (readCount(database, "outbound_deliveries" as never) !== count) throw new Error("Outbound delivery row count changed during lifecycle migration.");
    },
  },
  {
    id: 26,
    name: "0026_company_domain_persistence",
    checksumSource: "company-domain-v1|workspace-slug-name-unique|company-events-atomic-audit",
    apply(database): void {
      const legacyRows = database.prepare("SELECT id, workspace_id, name, created_at FROM companies ORDER BY id").all() as Array<{ id: number; workspace_id: number; name: string; created_at: string }>;
      const normalizedNames = new Set<string>();
      const slugs = new Set<string>();
      const prepared = legacyRows.map((row) => {
        const normalizedName = row.name.trim().normalize("NFKC").toLocaleLowerCase("en-US");
        const nameKey = `${row.workspace_id}:${normalizedName}`;
        if (!normalizedName || normalizedNames.has(nameKey)) throw new Error("Company migration found duplicate normalized names in a Workspace.");
        normalizedNames.add(nameKey);
        const base = row.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "company";
        let slug = base, suffix = 0;
        while (slugs.has(`${row.workspace_id}:${slug}`)) { suffix += 1; slug = `${base.slice(0, 70)}-${row.id}-${suffix}`; }
        slugs.add(`${row.workspace_id}:${slug}`);
        const parsed = new Date(row.created_at);
        if (Number.isNaN(parsed.getTime())) throw new Error("Company migration found an invalid creation timestamp.");
        return { ...row, normalizedName, slug, timestamp: parsed.toISOString() };
      });

      database.exec(`
        ALTER TABLE companies ADD COLUMN slug TEXT NOT NULL DEFAULT '';
        ALTER TABLE companies ADD COLUMN name_normalized TEXT NOT NULL DEFAULT '';
        ALTER TABLE companies ADD COLUMN description TEXT;
        ALTER TABLE companies ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle_state IN ('draft','configured','operational','attention_required','suspended','archived'));
        ALTER TABLE companies ADD COLUMN timezone TEXT;
        ALTER TABLE companies ADD COLUMN locale TEXT;
        ALTER TABLE companies ADD COLUMN public_name TEXT;
        ALTER TABLE companies ADD COLUMN logo_asset_ref TEXT;
        ALTER TABLE companies ADD COLUMN brand_colors_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE companies ADD COLUMN country_code TEXT;
        ALTER TABLE companies ADD COLUMN currency_code TEXT;
        ALTER TABLE companies ADD COLUMN date_format TEXT;
        ALTER TABLE companies ADD COLUMN phone_format TEXT;
        ALTER TABLE companies ADD COLUMN business_hours_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE companies ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
        ALTER TABLE companies ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE companies ADD COLUMN lifecycle_changed_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE companies ADD COLUMN suspended_at TEXT;
        ALTER TABLE companies ADD COLUMN archived_at TEXT;
      `);
      const update = database.prepare("UPDATE companies SET slug=?, name_normalized=?, lifecycle_state='draft', version=1, created_at=?, updated_at=?, lifecycle_changed_at=? WHERE id=? AND workspace_id=?");
      for (const row of prepared) update.run(row.slug, row.normalizedName, row.timestamp, row.timestamp, row.timestamp, row.id, row.workspace_id);
      database.exec(`
        CREATE UNIQUE INDEX idx_companies_workspace_slug ON companies(workspace_id, slug);
        CREATE UNIQUE INDEX idx_companies_workspace_name_normalized ON companies(workspace_id, name_normalized);
        CREATE UNIQUE INDEX idx_companies_id_workspace ON companies(id, workspace_id);
        CREATE INDEX idx_companies_workspace_lifecycle_id ON companies(workspace_id, lifecycle_state, id DESC);
        CREATE TABLE company_events (
          id TEXT PRIMARY KEY,
          company_id INTEGER NOT NULL,
          workspace_id INTEGER NOT NULL,
          event_type TEXT NOT NULL CHECK (event_type IN ('CompanyCreated','CompanyIdentityUpdated','CompanyBrandingUpdated','CompanyConfigurationUpdated','CompanyConfigured','CompanyActivated','CompanyAttentionRequired','CompanySuspended','CompanyRestored','CompanyArchived','CompanyUpdated')),
          aggregate_version INTEGER NOT NULL CHECK (aggregate_version >= 1),
          event_sequence INTEGER NOT NULL CHECK (event_sequence >= 1),
          occurred_at TEXT NOT NULL,
          actor_id TEXT,
          payload_json TEXT NOT NULL,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
          FOREIGN KEY (company_id, workspace_id) REFERENCES companies(id, workspace_id) ON DELETE CASCADE,
          UNIQUE(company_id, aggregate_version, event_sequence)
        );
        CREATE INDEX idx_company_events_workspace_occurred ON company_events(workspace_id, occurred_at DESC);
      `);
      if (prepared.length !== readCount(database, "companies")) throw new Error("Company migration row count changed.");
    },
  },
  {
    id: 27,
    name: "0027_company_website_optional",
    checksumSource: "company-website-nullable|preserve-company-core-and-fks",
    disableForeignKeys: true,
    apply(database): void {
      const count = readCount(database, "companies");
      database.exec(`
        CREATE TABLE companies_website_optional (
          id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
          name TEXT NOT NULL, website TEXT, phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'processing', created_at TEXT NOT NULL,
          slug TEXT NOT NULL, name_normalized TEXT NOT NULL, description TEXT,
          lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('draft','configured','operational','attention_required','suspended','archived')),
          timezone TEXT, locale TEXT, public_name TEXT, logo_asset_ref TEXT, brand_colors_json TEXT NOT NULL DEFAULT '{}',
          country_code TEXT, currency_code TEXT, date_format TEXT, phone_format TEXT, business_hours_json TEXT NOT NULL DEFAULT '{}',
          version INTEGER NOT NULL CHECK (version >= 1), updated_at TEXT NOT NULL, lifecycle_changed_at TEXT NOT NULL, suspended_at TEXT, archived_at TEXT,
          UNIQUE (workspace_id, website), UNIQUE (workspace_id, slug), UNIQUE (workspace_id, name_normalized), UNIQUE (id, workspace_id)
        );
        INSERT INTO companies_website_optional SELECT id,workspace_id,name,website,phone,email,status,created_at,slug,name_normalized,description,lifecycle_state,timezone,locale,public_name,logo_asset_ref,brand_colors_json,country_code,currency_code,date_format,phone_format,business_hours_json,version,updated_at,lifecycle_changed_at,suspended_at,archived_at FROM companies;
        DROP TABLE companies;
        ALTER TABLE companies_website_optional RENAME TO companies;
        CREATE INDEX idx_companies_workspace_id_id ON companies(workspace_id,id DESC);
        CREATE INDEX idx_companies_workspace_lifecycle_id ON companies(workspace_id,lifecycle_state,id DESC);
      `);
      if (readCount(database, "companies") !== count) throw new Error("Company row count changed while making website optional.");
    },
  },
  {
    id: 28,
    name: "0028_identity_registration_password_reset",
    checksumSource: "users-full-name-nullable|email-verifications-password-reset-purpose|current-reset-index|no-plaintext-proofs",
    disableForeignKeys: true,
    apply(database): void {
      database.exec(`
        ALTER TABLE users ADD COLUMN full_name TEXT;
        CREATE TABLE email_verifications_v2 (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, authentication_identity_id TEXT NOT NULL,
          purpose TEXT NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
          digest_version TEXT NOT NULL CHECK (digest_version = 'sha256-v1'), token_digest TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'consumed', 'superseded', 'invalidated')),
          delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending', 'accepted', 'temporary_failure', 'permanent_failure', 'uncertain')),
          issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, superseded_at TEXT, invalidated_at TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (authentication_identity_id) REFERENCES authentication_identities(id) ON DELETE CASCADE,
          UNIQUE (purpose, digest_version, token_digest)
        );
        INSERT INTO email_verifications_v2 SELECT * FROM email_verifications;
        DROP TABLE email_verifications;
        ALTER TABLE email_verifications_v2 RENAME TO email_verifications;
        CREATE UNIQUE INDEX idx_email_verifications_current_identity_purpose ON email_verifications(authentication_identity_id, purpose) WHERE status = 'pending';
        CREATE INDEX idx_email_verifications_digest_lookup ON email_verifications(purpose, digest_version, token_digest);
        CREATE INDEX idx_email_verifications_current_reset ON email_verifications(authentication_identity_id, expires_at) WHERE purpose = 'password_reset' AND status = 'pending';
      `);
    },
  },
  {
    id: 29,
    name: "0029_workspace_onboarding_settings",
    checksumSource: "workspaces-timezone-default-locale",
    apply(database): void {
      database.exec(`
        ALTER TABLE workspaces ADD COLUMN timezone TEXT;
        ALTER TABLE workspaces ADD COLUMN default_locale TEXT CHECK (default_locale IS NULL OR default_locale IN ('en', 'es'));
      `);
    },
  },
  {
    id: 30,
    name: "0030_assistant_readiness_assessments",
    checksumSource: "assistant-readiness-v1|default-assistant|append-only-assessments|configuration-digest",
    apply(database): void {
      database.exec(`
        CREATE TABLE assistant_readiness_assessments (
          id TEXT PRIMARY KEY,
          assistant_identifier TEXT NOT NULL CHECK(assistant_identifier = 'default'),
          workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
          company_id INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('ready','blocked')),
          blockers_json TEXT NOT NULL,
          knowledge_version_id TEXT REFERENCES company_knowledge_versions(id) ON DELETE SET NULL,
          assistant_profile_id TEXT REFERENCES assistant_profiles(id) ON DELETE SET NULL,
          whatsapp_connection_id TEXT REFERENCES whatsapp_connections(id) ON DELETE SET NULL,
          policy_version TEXT NOT NULL CHECK(policy_version = 'assistant-readiness-v1'),
          configuration_digest TEXT NOT NULL,
          evaluated_at TEXT NOT NULL,
          FOREIGN KEY(company_id, workspace_id) REFERENCES companies(id, workspace_id) ON DELETE CASCADE
        );
        CREATE INDEX idx_assistant_readiness_company_connection_evaluated
          ON assistant_readiness_assessments(workspace_id, company_id, whatsapp_connection_id, evaluated_at DESC, id DESC);
      `);
    },
  },
  { id:31,name:"0031_company_default_assistants",checksumSource:"one-default-assistant-per-company|profile-ownership|versioned-assignment",apply(database):void{database.exec(`CREATE TABLE company_default_assistants(workspace_id INTEGER NOT NULL,company_id INTEGER PRIMARY KEY,assistant_profile_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),assigned_at TEXT NOT NULL,updated_at TEXT NOT NULL,assigned_by_actor_id TEXT,source TEXT,FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,FOREIGN KEY(company_id,workspace_id) REFERENCES companies(id,workspace_id) ON DELETE CASCADE,FOREIGN KEY(assistant_profile_id) REFERENCES assistant_profiles(id) ON DELETE RESTRICT);CREATE INDEX idx_company_default_assistants_workspace_company ON company_default_assistants(workspace_id,company_id);`);}},
  { id:32,name:"0032_execution_snapshot_json",checksumSource:"execution-snapshot-v1|legacy-null-compatible",apply(database):void{database.exec("ALTER TABLE assistant_execution_records ADD COLUMN execution_snapshot_json TEXT;");}},
  { id:33,name:"0033_channel_execution_requests",checksumSource:"durable-channel-execution-request-v1|event-idempotency|leased-recovery",apply(database):void{database.exec(`CREATE TABLE channel_execution_requests(id TEXT PRIMARY KEY,channel_provider_event_id TEXT NOT NULL UNIQUE REFERENCES channel_provider_events(id) ON DELETE CASCADE,state TEXT NOT NULL CHECK(state IN ('pending','leased','completed','failed','unsupported')),snapshot_json TEXT NOT NULL,lease_owner TEXT,lease_expires_at TEXT,outcome TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,CHECK((lease_owner IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)));CREATE INDEX idx_channel_execution_requests_ready ON channel_execution_requests(state,created_at,id);CREATE INDEX idx_channel_execution_requests_lease ON channel_execution_requests(state,lease_expires_at,id);`);}},
  { id:34,name:"0034_outbound_delivery_attempt_outcomes",checksumSource:"outbound-delivery-append-only-attempt-telemetry|atomic-lease-settlement",apply(database):void{database.exec(`CREATE TABLE outbound_delivery_attempts(id TEXT PRIMARY KEY,outbound_delivery_id TEXT NOT NULL REFERENCES outbound_deliveries(id) ON DELETE CASCADE,attempt_number INTEGER NOT NULL CHECK(attempt_number>0),outcome TEXT NOT NULL CHECK(outcome IN ('accepted','retryable','permanent_failure')),safe_error_category TEXT,occurred_at TEXT NOT NULL,UNIQUE(outbound_delivery_id,attempt_number));CREATE INDEX idx_outbound_delivery_attempts_delivery ON outbound_delivery_attempts(outbound_delivery_id,attempt_number);`);}},
  { id:35,name:"0035_whatsapp_validation_failure_codes",checksumSource:"whatsapp-validation-failure-codes-v2|preserve-operational-state|reseed-trigger",apply(database):void{database.exec(`DROP TRIGGER whatsapp_connections_seed_operational_state;CREATE TABLE whatsapp_connection_operational_states_v2(whatsapp_connection_id TEXT PRIMARY KEY REFERENCES whatsapp_connections(id) ON DELETE CASCADE,validation_state TEXT NOT NULL CHECK(validation_state IN ('not_validated','valid','invalid')),validated_at TEXT,validation_failure_code TEXT CHECK(validation_failure_code IN ('credentials_invalid','provider_identity_mismatch','invalid_credentials','insufficient_permissions','phone_number_not_found','business_account_mismatch','rate_limited','provider_unavailable','provider_timeout','provider_rejected')),health_state TEXT NOT NULL CHECK(health_state IN ('inactive','healthy','degraded')),last_provider_activity_at TEXT,last_webhook_activity_at TEXT,health_failure_code TEXT CHECK(health_failure_code IN ('credentials_invalid','provider_identity_mismatch','invalid_credentials','insufficient_permissions','phone_number_not_found','business_account_mismatch','rate_limited','provider_unavailable','provider_timeout','provider_rejected')),updated_at TEXT NOT NULL,CHECK((validation_state='not_validated' AND validated_at IS NULL AND validation_failure_code IS NULL) OR (validation_state='valid' AND validated_at IS NOT NULL AND validation_failure_code IS NULL) OR (validation_state='invalid' AND validated_at IS NOT NULL AND validation_failure_code IS NOT NULL)),CHECK((health_state='degraded' AND health_failure_code IS NOT NULL) OR (health_state IN ('inactive','healthy') AND health_failure_code IS NULL)));INSERT INTO whatsapp_connection_operational_states_v2 SELECT * FROM whatsapp_connection_operational_states;DROP TABLE whatsapp_connection_operational_states;ALTER TABLE whatsapp_connection_operational_states_v2 RENAME TO whatsapp_connection_operational_states;CREATE TRIGGER whatsapp_connections_seed_operational_state AFTER INSERT ON whatsapp_connections BEGIN INSERT INTO whatsapp_connection_operational_states(whatsapp_connection_id,validation_state,validated_at,validation_failure_code,health_state,last_provider_activity_at,last_webhook_activity_at,health_failure_code,updated_at) VALUES(NEW.id,'not_validated',NULL,NULL,'inactive',NULL,NULL,NULL,NEW.updated_at);END;`);}},
  { id:36,name:"0036_platform_administrators",checksumSource:"platform-administrators-v1|bootstrap-claimant-backfill|active-revoked",apply(database):void{database.exec(`CREATE TABLE platform_administrators(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,status TEXT NOT NULL CHECK(status IN ('active','revoked')),granted_at TEXT NOT NULL,granted_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,revoked_at TEXT,CHECK((status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL)));CREATE INDEX idx_platform_administrators_active ON platform_administrators(status,user_id);INSERT INTO platform_administrators(user_id,status,granted_at,granted_by_user_id,revoked_at) SELECT claimed_by_user_id,'active',claimed_at,NULL,NULL FROM platform_bootstrap WHERE singleton=1 AND claimed_by_user_id IS NOT NULL ON CONFLICT(user_id) DO NOTHING;`);}},
  { id:37,name:"0037_commercial_controls",checksumSource:"nullable-commercial-allowances|versioned-controls|generic-append-only-audit-v1",apply(database):void{database.exec(`
    CREATE TABLE user_commercial_controls(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,max_owned_workspaces INTEGER DEFAULT 1 CHECK(max_owned_workspaces IS NULL OR max_owned_workspaces>0),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO user_commercial_controls(user_id) SELECT id FROM users;
    CREATE TRIGGER user_commercial_controls_seed AFTER INSERT ON users BEGIN INSERT INTO user_commercial_controls(user_id) VALUES(NEW.id); END;
    CREATE TABLE workspace_commercial_controls(workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE RESTRICT,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),max_companies INTEGER CHECK(max_companies IS NULL OR max_companies>0),max_assistant_profiles INTEGER CHECK(max_assistant_profiles IS NULL OR max_assistant_profiles>0),max_active_channels INTEGER CHECK(max_active_channels IS NULL OR max_active_channels>0),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,suspended_at TEXT,CHECK((status='active' AND suspended_at IS NULL) OR (status='suspended' AND suspended_at IS NOT NULL)));
    INSERT INTO workspace_commercial_controls(workspace_id) SELECT id FROM workspaces;
    CREATE TRIGGER workspace_commercial_controls_seed AFTER INSERT ON workspaces BEGIN INSERT INTO workspace_commercial_controls(workspace_id) VALUES(NEW.id); END;
    CREATE TABLE commercial_control_audit_events(id TEXT PRIMARY KEY,actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,subject_type TEXT NOT NULL CHECK(subject_type IN ('user','workspace')),subject_id TEXT NOT NULL,event_type TEXT NOT NULL CHECK(event_type IN ('allowance_updated','limits_updated','suspended','reactivated')),old_value_json TEXT NOT NULL,new_value_json TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),occurred_at TEXT NOT NULL);
    CREATE INDEX idx_commercial_control_audit_subject ON commercial_control_audit_events(subject_type,subject_id,occurred_at DESC,id DESC);
    CREATE TRIGGER commercial_control_audit_no_update BEFORE UPDATE ON commercial_control_audit_events BEGIN SELECT RAISE(ABORT,'commercial audit events are append-only'); END;
    CREATE TRIGGER commercial_control_audit_no_delete BEFORE DELETE ON commercial_control_audit_events BEGIN SELECT RAISE(ABORT,'commercial audit events are append-only'); END;
    CREATE TRIGGER commercial_company_limit BEFORE INSERT ON companies WHEN NOT EXISTS(SELECT 1 FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id AND status='active') OR (SELECT max_companies FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id) IS NOT NULL AND (SELECT COUNT(*) FROM companies WHERE workspace_id=NEW.workspace_id AND lifecycle_state!='archived')>=(SELECT max_companies FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'workspace company creation is unavailable'); END;
    CREATE TRIGGER commercial_company_restore_limit BEFORE UPDATE OF lifecycle_state ON companies WHEN OLD.lifecycle_state='archived' AND NEW.lifecycle_state!='archived' AND (NOT EXISTS(SELECT 1 FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id AND status='active') OR (SELECT max_companies FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id) IS NOT NULL AND (SELECT COUNT(*) FROM companies WHERE workspace_id=NEW.workspace_id AND lifecycle_state!='archived')>=(SELECT max_companies FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id)) BEGIN SELECT RAISE(ABORT,'workspace company restore is unavailable'); END;
    CREATE TRIGGER commercial_profile_limit BEFORE INSERT ON assistant_profiles WHEN NOT EXISTS(SELECT 1 FROM workspace_commercial_controls cc JOIN companies c ON c.workspace_id=cc.workspace_id WHERE c.id=NEW.company_id AND cc.status='active') OR (SELECT max_assistant_profiles FROM workspace_commercial_controls WHERE workspace_id=(SELECT workspace_id FROM companies WHERE id=NEW.company_id)) IS NOT NULL AND (SELECT COUNT(*) FROM assistant_profiles p JOIN companies c ON c.id=p.company_id WHERE c.workspace_id=(SELECT workspace_id FROM companies WHERE id=NEW.company_id) AND p.status!='archived')>=(SELECT max_assistant_profiles FROM workspace_commercial_controls WHERE workspace_id=(SELECT workspace_id FROM companies WHERE id=NEW.company_id)) BEGIN SELECT RAISE(ABORT,'workspace assistant profile creation is unavailable'); END;
    CREATE TRIGGER commercial_profile_restore_limit BEFORE UPDATE OF status ON assistant_profiles WHEN OLD.status='archived' AND NEW.status!='archived' AND (NOT EXISTS(SELECT 1 FROM workspace_commercial_controls cc JOIN companies c ON c.workspace_id=cc.workspace_id WHERE c.id=NEW.company_id AND cc.status='active') OR (SELECT max_assistant_profiles FROM workspace_commercial_controls WHERE workspace_id=(SELECT workspace_id FROM companies WHERE id=NEW.company_id)) IS NOT NULL AND (SELECT COUNT(*) FROM assistant_profiles p JOIN companies c ON c.id=p.company_id WHERE c.workspace_id=(SELECT workspace_id FROM companies WHERE id=NEW.company_id) AND p.status!='archived')>=(SELECT max_assistant_profiles FROM workspace_commercial_controls WHERE workspace_id=(SELECT workspace_id FROM companies WHERE id=NEW.company_id))) BEGIN SELECT RAISE(ABORT,'workspace assistant profile restore is unavailable'); END;
    CREATE TRIGGER commercial_web_chat_active_limit_insert BEFORE INSERT ON web_chat_connections WHEN NEW.status='active' AND (NOT EXISTS(SELECT 1 FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id AND status='active') OR (SELECT max_active_channels FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id) IS NOT NULL AND ((SELECT COUNT(*) FROM web_chat_connections WHERE workspace_id=NEW.workspace_id AND status='active')+(SELECT COUNT(*) FROM whatsapp_connections WHERE workspace_id=NEW.workspace_id AND status='active'))>=(SELECT max_active_channels FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id)) BEGIN SELECT RAISE(ABORT,'workspace active channel creation is unavailable'); END;
    CREATE TRIGGER commercial_web_chat_active_limit_update BEFORE UPDATE OF status ON web_chat_connections WHEN NEW.status='active' AND OLD.status!='active' AND (NOT EXISTS(SELECT 1 FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id AND status='active') OR (SELECT max_active_channels FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id) IS NOT NULL AND ((SELECT COUNT(*) FROM web_chat_connections WHERE workspace_id=NEW.workspace_id AND status='active')+(SELECT COUNT(*) FROM whatsapp_connections WHERE workspace_id=NEW.workspace_id AND status='active'))>=(SELECT max_active_channels FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id)) BEGIN SELECT RAISE(ABORT,'workspace active channel creation is unavailable'); END;
    CREATE TRIGGER commercial_whatsapp_active_limit_insert BEFORE INSERT ON whatsapp_connections WHEN NEW.status='active' AND (NOT EXISTS(SELECT 1 FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id AND status='active') OR (SELECT max_active_channels FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id) IS NOT NULL AND ((SELECT COUNT(*) FROM web_chat_connections WHERE workspace_id=NEW.workspace_id AND status='active')+(SELECT COUNT(*) FROM whatsapp_connections WHERE workspace_id=NEW.workspace_id AND status='active'))>=(SELECT max_active_channels FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id)) BEGIN SELECT RAISE(ABORT,'workspace active channel creation is unavailable'); END;
    CREATE TRIGGER commercial_whatsapp_active_limit_update BEFORE UPDATE OF status ON whatsapp_connections WHEN NEW.status='active' AND OLD.status!='active' AND (NOT EXISTS(SELECT 1 FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id AND status='active') OR (SELECT max_active_channels FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id) IS NOT NULL AND ((SELECT COUNT(*) FROM web_chat_connections WHERE workspace_id=NEW.workspace_id AND status='active')+(SELECT COUNT(*) FROM whatsapp_connections WHERE workspace_id=NEW.workspace_id AND status='active'))>=(SELECT max_active_channels FROM workspace_commercial_controls WHERE workspace_id=NEW.workspace_id)) BEGIN SELECT RAISE(ABORT,'workspace active channel creation is unavailable'); END;
  `);}},
  { id:38,name:"0038_assistant_capability_foundation",checksumSource:"code-owned-capabilities|tenant-scoped-assignments|append-only-audit|sanitized-tool-traces",apply(database):void{database.exec(`
    CREATE UNIQUE INDEX ux_companies_workspace_id ON companies(workspace_id,id);
    CREATE UNIQUE INDEX ux_assistant_profiles_company_id ON assistant_profiles(company_id,id);
    CREATE UNIQUE INDEX ux_assistant_execution_records_scope ON assistant_execution_records(id,company_id,assistant_profile_id);
    CREATE TABLE assistant_profile_capabilities(
      workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,assistant_profile_id TEXT NOT NULL,capability_key TEXT NOT NULL,
      assigned_by_actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,assigned_at TEXT NOT NULL,
      PRIMARY KEY(assistant_profile_id,capability_key),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      FOREIGN KEY(company_id,assistant_profile_id) REFERENCES assistant_profiles(company_id,id) ON DELETE CASCADE
    );
    CREATE INDEX idx_assistant_profile_capabilities_scope ON assistant_profile_capabilities(workspace_id,company_id,assistant_profile_id,capability_key);
    CREATE TABLE assistant_capability_audit_events(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,assistant_profile_id TEXT NOT NULL,capability_key TEXT NOT NULL,
      actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,event_type TEXT NOT NULL CHECK(event_type IN ('assigned','removed')),occurred_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      FOREIGN KEY(company_id,assistant_profile_id) REFERENCES assistant_profiles(company_id,id) ON DELETE CASCADE
    );
    CREATE INDEX idx_assistant_capability_audit_profile ON assistant_capability_audit_events(workspace_id,company_id,assistant_profile_id,occurred_at DESC,id DESC);
    CREATE TRIGGER assistant_capability_audit_no_update BEFORE UPDATE ON assistant_capability_audit_events BEGIN SELECT RAISE(ABORT,'assistant capability audit events are append-only'); END;
    CREATE TRIGGER assistant_capability_audit_no_delete BEFORE DELETE ON assistant_capability_audit_events BEGIN SELECT RAISE(ABORT,'assistant capability audit events are append-only'); END;
    CREATE TABLE tool_execution_traces(
      id TEXT PRIMARY KEY,assistant_execution_record_id TEXT NOT NULL,
      workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,assistant_profile_id TEXT NOT NULL,model_tool_call_id TEXT NOT NULL,tool_name TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('requested','completed','failed')),audit_input_json TEXT,audit_output_json TEXT,output_reference TEXT,error_code TEXT,
      requested_at TEXT NOT NULL,completed_at TEXT,duration_milliseconds INTEGER,
      UNIQUE(assistant_execution_record_id,model_tool_call_id),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      FOREIGN KEY(company_id,assistant_profile_id) REFERENCES assistant_profiles(company_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(assistant_execution_record_id,company_id,assistant_profile_id) REFERENCES assistant_execution_records(id,company_id,assistant_profile_id) ON DELETE CASCADE,
      CHECK((state='requested' AND completed_at IS NULL AND duration_milliseconds IS NULL AND audit_output_json IS NULL AND output_reference IS NULL AND error_code IS NULL)
        OR (state='completed' AND completed_at IS NOT NULL AND duration_milliseconds>=0 AND error_code IS NULL)
        OR (state='failed' AND completed_at IS NOT NULL AND duration_milliseconds>=0 AND error_code IS NOT NULL))
    );
    CREATE INDEX idx_tool_execution_traces_profile_requested ON tool_execution_traces(workspace_id,company_id,assistant_profile_id,requested_at DESC,id DESC);
  `);}},
  { id:39,name:"0039_conversation_intelligence",checksumSource:"conversation-intelligence-state-v1|unbounded-applied-message-ledger|cas-memory-references-pruning",apply(database):void{database.exec(`
    CREATE TABLE conversation_intelligence_states(
      conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
      company_id INTEGER NOT NULL,
      active_intent_json TEXT,version INTEGER NOT NULL CHECK(version>=1),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE
    );
    CREATE INDEX idx_conversation_intelligence_states_scope ON conversation_intelligence_states(workspace_id,company_id,updated_at DESC,conversation_id);
    CREATE TABLE conversation_intelligence_applied_messages(
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      conversation_message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
      state_version INTEGER NOT NULL CHECK(state_version>=1),applied_at TEXT NOT NULL,
      PRIMARY KEY(conversation_id,conversation_message_id)
    );
    CREATE INDEX idx_conversation_intelligence_applied_messages_message ON conversation_intelligence_applied_messages(conversation_message_id);
    CREATE TABLE conversation_intelligence_applied_tool_traces(
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      tool_trace_id TEXT NOT NULL REFERENCES tool_execution_traces(id) ON DELETE CASCADE,
      applied_at TEXT NOT NULL,
      PRIMARY KEY(conversation_id,tool_trace_id)
    );
    CREATE TABLE conversation_intelligence_facts(
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      fact_key TEXT NOT NULL, value_json TEXT NOT NULL, authority TEXT NOT NULL CHECK(authority IN ('human_asserted','tool_observed','assistant_inference')),
      source_kind TEXT NOT NULL CHECK(source_kind IN ('user','operator','tool','assistant_inference')), source_message_id TEXT REFERENCES conversation_messages(id) ON DELETE SET NULL,
      source_tool_trace_id TEXT REFERENCES tool_execution_traces(id) ON DELETE SET NULL, source_order TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(conversation_id,fact_key)
    );
    CREATE TABLE conversation_intelligence_pending_items(
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, pending_key TEXT NOT NULL, asked_at TEXT, created_at TEXT NOT NULL,
      PRIMARY KEY(conversation_id,pending_key)
    );
    CREATE TABLE conversation_intelligence_reference_groups(
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, group_kind TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','stale')), source_message_id TEXT REFERENCES conversation_messages(id) ON DELETE SET NULL,
      source_tool_trace_id TEXT REFERENCES tool_execution_traces(id) ON DELETE SET NULL, created_at TEXT NOT NULL, stale_at TEXT, expires_at TEXT
    );
    CREATE INDEX idx_conversation_intelligence_reference_groups_scope ON conversation_intelligence_reference_groups(conversation_id,status,group_kind,created_at DESC);
    CREATE TABLE conversation_intelligence_reference_options(
      group_id TEXT NOT NULL REFERENCES conversation_intelligence_reference_groups(id) ON DELETE CASCADE, reference_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 10), label TEXT NOT NULL, safe_payload_json TEXT NOT NULL,
      PRIMARY KEY(group_id,reference_id), UNIQUE(group_id,ordinal)
    );
    CREATE TABLE conversation_intelligence_tool_memory(
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      tool_trace_id TEXT NOT NULL REFERENCES tool_execution_traces(id) ON DELETE CASCADE, category TEXT NOT NULL, value_json TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(conversation_id,tool_trace_id,category)
    );
    CREATE INDEX idx_conversation_intelligence_tool_memory_scope ON conversation_intelligence_tool_memory(conversation_id,created_at DESC);
    CREATE TRIGGER conversation_intelligence_states_scope_insert
    BEFORE INSERT ON conversation_intelligence_states
    WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id)
    BEGIN SELECT RAISE(ABORT,'Conversation intelligence state scope is invalid'); END;
    CREATE TRIGGER conversation_intelligence_states_scope_update
    BEFORE UPDATE OF conversation_id,workspace_id,company_id ON conversation_intelligence_states
    WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id)
    BEGIN SELECT RAISE(ABORT,'Conversation intelligence state scope is invalid'); END;
    CREATE TRIGGER conversation_intelligence_applied_message_scope_insert
    BEFORE INSERT ON conversation_intelligence_applied_messages
    WHEN NOT EXISTS(SELECT 1 FROM conversation_messages m WHERE m.id=NEW.conversation_message_id AND m.conversation_id=NEW.conversation_id)
    BEGIN SELECT RAISE(ABORT,'Conversation intelligence applied message scope is invalid'); END;
    CREATE TRIGGER conversation_intelligence_fact_message_scope_insert
    BEFORE INSERT ON conversation_intelligence_facts WHEN NEW.source_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_messages m WHERE m.id=NEW.source_message_id AND m.conversation_id=NEW.conversation_id)
    BEGIN SELECT RAISE(ABORT,'Conversation intelligence fact message scope is invalid'); END;
    CREATE TRIGGER conversation_intelligence_group_message_scope_insert
    BEFORE INSERT ON conversation_intelligence_reference_groups WHEN NEW.source_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_messages m WHERE m.id=NEW.source_message_id AND m.conversation_id=NEW.conversation_id)
    BEGIN SELECT RAISE(ABORT,'Conversation intelligence group message scope is invalid'); END;
   `);}},
  { id:40,name:"0040_integration_connections_core",checksumSource:"generic-integration-connections-secrets-operational-state-audit-cas-v1",apply(database):void{database.exec(`
    CREATE TABLE integration_connections(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,provider TEXT NOT NULL,kind TEXT NOT NULL,
      configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),status TEXT NOT NULL CHECK(status IN ('inactive','active')),version INTEGER NOT NULL CHECK(version>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      UNIQUE(workspace_id,company_id,provider,kind),
      UNIQUE(workspace_id,company_id,id)
    );
    CREATE INDEX idx_integration_connections_scope ON integration_connections(workspace_id,company_id,provider,kind,status,updated_at DESC,id DESC);
    CREATE TABLE integration_connection_secrets(
      integration_connection_id TEXT PRIMARY KEY REFERENCES integration_connections(id) ON DELETE CASCADE,
      encrypted_secret TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE TABLE integration_connection_operational_states(
      integration_connection_id TEXT PRIMARY KEY REFERENCES integration_connections(id) ON DELETE CASCADE,
      validation_state TEXT NOT NULL CHECK(validation_state IN ('not_validated','valid','invalid')),validated_at TEXT,
      validation_failure_code TEXT CHECK(validation_failure_code IN ('credentials_invalid','provider_identity_mismatch','provider_unavailable','provider_timeout','provider_rejected')),
      health_state TEXT NOT NULL CHECK(health_state IN ('inactive','healthy','degraded')),
      health_failure_code TEXT CHECK(health_failure_code IN ('credentials_invalid','provider_identity_mismatch','provider_unavailable','provider_timeout','provider_rejected')),
      last_provider_activity_at TEXT,updated_at TEXT NOT NULL,
      CHECK((validation_state='not_validated' AND validated_at IS NULL AND validation_failure_code IS NULL) OR (validation_state='valid' AND validated_at IS NOT NULL AND validation_failure_code IS NULL) OR (validation_state='invalid' AND validated_at IS NOT NULL AND validation_failure_code IS NOT NULL)),
      CHECK((health_state='degraded' AND health_failure_code IS NOT NULL) OR (health_state IN ('inactive','healthy') AND health_failure_code IS NULL))
    );
    CREATE TABLE integration_connection_audit_events(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,integration_connection_id TEXT NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK(event_type IN ('created','configured','secret_configured','validated','validation_failed','activated','deactivated')),payload_json TEXT NOT NULL CHECK(json_valid(payload_json)) CHECK(length(payload_json)<=1024),version INTEGER NOT NULL CHECK(version>0),occurred_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      FOREIGN KEY(workspace_id,company_id,integration_connection_id) REFERENCES integration_connections(workspace_id,company_id,id) ON DELETE CASCADE
    );
    CREATE INDEX idx_integration_connection_audit_scope ON integration_connection_audit_events(workspace_id,company_id,integration_connection_id,occurred_at DESC,id DESC);
    CREATE TRIGGER integration_connection_audit_no_update BEFORE UPDATE ON integration_connection_audit_events BEGIN SELECT RAISE(ABORT,'integration audit events are append-only'); END;
    CREATE TRIGGER integration_connection_audit_no_delete BEFORE DELETE ON integration_connection_audit_events BEGIN SELECT RAISE(ABORT,'integration audit events are append-only'); END;
  `);}},
  { id:41,name:"0041_live_data_observations",checksumSource:"live-data-observations-v1|workspace-company-scoped|bounded-append-only",apply(database):void{database.exec(`
    CREATE TABLE live_data_observations(
      id TEXT PRIMARY KEY,tool_trace_id TEXT NOT NULL UNIQUE REFERENCES tool_execution_traces(id) ON DELETE CASCADE,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,
      resource_type TEXT NOT NULL CHECK(length(resource_type) BETWEEN 1 AND 100),provider TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 100),
      outcome TEXT NOT NULL CHECK(outcome IN ('confirmed','empty','not_found','unavailable')),observed_at TEXT NOT NULL,fetched_at TEXT NOT NULL,expires_at TEXT NOT NULL,
      freshness TEXT NOT NULL CHECK(freshness IN ('fresh','stale','expired')),safe_payload_json TEXT NOT NULL CHECK(json_valid(safe_payload_json)) CHECK(length(safe_payload_json)<=8512),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      CHECK(fetched_at>=observed_at)
    );
    CREATE INDEX idx_live_data_observations_scope_resource_observed ON live_data_observations(workspace_id,company_id,resource_type,observed_at DESC,id DESC);
    CREATE TRIGGER live_data_observations_no_update BEFORE UPDATE ON live_data_observations BEGIN SELECT RAISE(ABORT,'live data observations are append-only'); END;
    CREATE TRIGGER live_data_observations_no_delete BEFORE DELETE ON live_data_observations BEGIN SELECT RAISE(ABORT,'live data observations are append-only'); END;
  `);}},
  { id:42,name:"0042_live_data_observation_trace_link",checksumSource:"live-data-observation-one-tool-trace-forward-compatibility",apply(_database):void{}},
  { id:43,name:"0043_scheduling_domain_core",checksumSource:"scheduling-resources-services-availability-holds-bookings-single-resource-v1",apply(database):void{database.exec(`
    CREATE TABLE scheduling_locations(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,name TEXT NOT NULL,address TEXT,timezone TEXT NOT NULL,
      active INTEGER NOT NULL CHECK(active IN (0,1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      UNIQUE(workspace_id,company_id,id)
    );
    CREATE INDEX idx_scheduling_locations_scope ON scheduling_locations(workspace_id,company_id,active,id);
    CREATE TABLE scheduling_resources(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,location_id TEXT,name TEXT NOT NULL,
      timezone TEXT NOT NULL,capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 10000),active INTEGER NOT NULL CHECK(active IN (0,1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      FOREIGN KEY(workspace_id,company_id,location_id) REFERENCES scheduling_locations(workspace_id,company_id,id) ON DELETE RESTRICT,
      UNIQUE(workspace_id,company_id,id)
    );
    CREATE INDEX idx_scheduling_resources_scope ON scheduling_resources(workspace_id,company_id,active,id);
    CREATE TABLE scheduling_services(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,resource_id TEXT NOT NULL,
      name TEXT NOT NULL,duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 1 AND 1440),buffer_before_minutes INTEGER NOT NULL CHECK(buffer_before_minutes BETWEEN 0 AND 1440),buffer_after_minutes INTEGER NOT NULL CHECK(buffer_after_minutes BETWEEN 0 AND 1440),slot_granularity_minutes INTEGER NOT NULL CHECK(slot_granularity_minutes BETWEEN 1 AND 1440),minimum_lead_minutes INTEGER NOT NULL CHECK(minimum_lead_minutes BETWEEN 0 AND 525600),maximum_horizon_days INTEGER NOT NULL CHECK(maximum_horizon_days BETWEEN 1 AND 730),active INTEGER NOT NULL CHECK(active IN (0,1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      FOREIGN KEY(workspace_id,company_id,resource_id) REFERENCES scheduling_resources(workspace_id,company_id,id) ON DELETE RESTRICT,
      UNIQUE(workspace_id,company_id,id)
    );
    CREATE INDEX idx_scheduling_services_scope ON scheduling_services(workspace_id,company_id,resource_id,active,id);
    CREATE TABLE scheduling_working_windows(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,resource_id TEXT NOT NULL,
      weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),start_time TEXT NOT NULL,end_time TEXT NOT NULL,created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id,company_id,resource_id) REFERENCES scheduling_resources(workspace_id,company_id,id) ON DELETE CASCADE,
      UNIQUE(resource_id,weekday,start_time,end_time),CHECK(length(start_time)=5 AND length(end_time)=5 AND start_time<end_time)
    );
    CREATE INDEX idx_scheduling_working_windows_scope ON scheduling_working_windows(workspace_id,company_id,resource_id,weekday,start_time);
    CREATE TABLE scheduling_availability_exceptions(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,resource_id TEXT NOT NULL,local_date TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('closed','open')),start_time TEXT,end_time TEXT,
      FOREIGN KEY(workspace_id,company_id,resource_id) REFERENCES scheduling_resources(workspace_id,company_id,id) ON DELETE CASCADE,
      CHECK((start_time IS NULL AND end_time IS NULL) OR (length(start_time)=5 AND length(end_time)=5 AND start_time<end_time)),
      UNIQUE(workspace_id,company_id,resource_id,local_date,kind,start_time,end_time)
    );
    CREATE INDEX idx_scheduling_exceptions_scope ON scheduling_availability_exceptions(workspace_id,company_id,resource_id,local_date);
    CREATE TABLE scheduling_busy_intervals(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,resource_id TEXT NOT NULL,start_at TEXT NOT NULL,end_at TEXT NOT NULL,
      units INTEGER NOT NULL CHECK(units BETWEEN 1 AND 10000),source TEXT NOT NULL,external_reference TEXT,created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id,company_id,resource_id) REFERENCES scheduling_resources(workspace_id,company_id,id) ON DELETE CASCADE,
      CHECK(start_at<end_at),UNIQUE(workspace_id,company_id,resource_id,source,external_reference)
    );
    CREATE INDEX idx_scheduling_busy_occupancy ON scheduling_busy_intervals(workspace_id,company_id,resource_id,start_at,end_at);
    CREATE TABLE scheduling_holds(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,service_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,start_at TEXT NOT NULL,end_at TEXT NOT NULL,occupied_start_at TEXT NOT NULL,occupied_end_at TEXT NOT NULL,expires_at TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','released','expired')),
      created_at TEXT NOT NULL,released_at TEXT,
      FOREIGN KEY(workspace_id,company_id,service_id) REFERENCES scheduling_services(workspace_id,company_id,id) ON DELETE CASCADE,
      CHECK(start_at<end_at),CHECK(occupied_start_at<occupied_end_at),CHECK(expires_at>=created_at),CHECK((state='active' AND released_at IS NULL) OR (state IN ('released','expired') AND released_at IS NOT NULL)),
      UNIQUE(workspace_id,company_id,idempotency_key)
    );
    CREATE INDEX idx_scheduling_holds_conflicts ON scheduling_holds(workspace_id,company_id,service_id,state,start_at,end_at,expires_at);
    CREATE TABLE scheduling_bookings(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,service_id TEXT NOT NULL,hold_id TEXT UNIQUE,reference TEXT NOT NULL,
      start_at TEXT NOT NULL,end_at TEXT NOT NULL,occupied_start_at TEXT NOT NULL,occupied_end_at TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('confirmed','cancelled')),created_at TEXT NOT NULL,cancelled_at TEXT,
      FOREIGN KEY(workspace_id,company_id,service_id) REFERENCES scheduling_services(workspace_id,company_id,id) ON DELETE CASCADE,
      FOREIGN KEY(hold_id) REFERENCES scheduling_holds(id) ON DELETE SET NULL,
      CHECK(start_at<end_at),CHECK(occupied_start_at<occupied_end_at),CHECK((state='confirmed' AND cancelled_at IS NULL) OR (state='cancelled' AND cancelled_at IS NOT NULL)),
      UNIQUE(workspace_id,company_id,reference)
    );
    CREATE INDEX idx_scheduling_bookings_conflicts ON scheduling_bookings(workspace_id,company_id,service_id,state,start_at,end_at);
    CREATE TRIGGER scheduling_booking_hold_scope BEFORE INSERT ON scheduling_bookings WHEN NEW.hold_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM scheduling_holds h WHERE h.id=NEW.hold_id AND h.workspace_id=NEW.workspace_id AND h.company_id=NEW.company_id AND h.service_id=NEW.service_id
    ) BEGIN SELECT RAISE(ABORT,'Scheduling booking hold scope is invalid'); END;
  `);}},
  { id:44,name:"0044_scheduling_normalized_names",checksumSource:"scheduling-location-resource-service-normalized-name-backfill-unique-v1",apply(database):void{const tables=["scheduling_locations","scheduling_resources","scheduling_services"];if(!tables.every((table)=>database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)))return;for(const table of tables){const columns=database.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>;if(!columns.some((column)=>column.name==="normalized_name")){database.exec(`ALTER TABLE ${table} ADD COLUMN normalized_name TEXT NOT NULL DEFAULT '';UPDATE ${table} SET normalized_name=lower(trim(name));`);}}database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduling_locations_normalized_name ON scheduling_locations(workspace_id,company_id,normalized_name);CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduling_resources_normalized_name ON scheduling_resources(workspace_id,company_id,normalized_name);CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduling_services_normalized_name ON scheduling_services(workspace_id,company_id,normalized_name);`);}},
  { id:45,name:"0045_scheduling_busy_interval_validation",checksumSource:"scheduling-busy-interval-source-reference-trigger-validation-v1",apply(database):void{if(!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scheduling_busy_intervals'").get())return;database.exec(`
    CREATE TRIGGER scheduling_busy_intervals_validate_insert BEFORE INSERT ON scheduling_busy_intervals
    WHEN NEW.source NOT IN ('internal_block','external_observed') OR NOT (
      (NEW.source='internal_block' AND NEW.external_reference IS NULL) OR
      (NEW.source='external_observed' AND NEW.external_reference IS NOT NULL AND length(NEW.external_reference) BETWEEN 1 AND 200)
    ) BEGIN SELECT RAISE(ABORT,'Scheduling busy interval source or reference is invalid'); END;
    CREATE TRIGGER scheduling_busy_intervals_validate_update BEFORE UPDATE ON scheduling_busy_intervals
    WHEN NEW.source NOT IN ('internal_block','external_observed') OR NOT (
      (NEW.source='internal_block' AND NEW.external_reference IS NULL) OR
      (NEW.source='external_observed' AND NEW.external_reference IS NOT NULL AND length(NEW.external_reference) BETWEEN 1 AND 200)
    ) BEGIN SELECT RAISE(ABORT,'Scheduling busy interval source or reference is invalid'); END;
  `);}},
  { id:46,name:"0046_scheduling_booking_mutations_audit_lineage",checksumSource:"scheduling-booking-command-idempotency-append-only-audit-reschedule-lineage-v1",apply(database):void{if(!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scheduling_bookings'").get())return;const columns=database.prepare("PRAGMA table_info(scheduling_bookings)").all() as Array<{name:string}>;if(!columns.some(column=>column.name==="rescheduled_from_booking_id"))database.exec("ALTER TABLE scheduling_bookings ADD COLUMN rescheduled_from_booking_id TEXT REFERENCES scheduling_bookings(id) ON DELETE RESTRICT;");database.exec(`
    CREATE INDEX IF NOT EXISTS idx_scheduling_bookings_lineage ON scheduling_bookings(workspace_id,company_id,rescheduled_from_booking_id);
    CREATE TABLE scheduling_booking_mutations(id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,idempotency_key TEXT NOT NULL,operation TEXT NOT NULL CHECK(operation IN ('create','reschedule','cancel')),request_fingerprint TEXT NOT NULL,booking_id TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,FOREIGN KEY(booking_id) REFERENCES scheduling_bookings(id) ON DELETE RESTRICT,UNIQUE(workspace_id,company_id,idempotency_key));
    CREATE TABLE scheduling_booking_audit_events(id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,booking_id TEXT NOT NULL,mutation_id TEXT NOT NULL,event_type TEXT NOT NULL CHECK(event_type IN ('created','rescheduled','cancelled')),occurred_at TEXT NOT NULL,FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,FOREIGN KEY(booking_id) REFERENCES scheduling_bookings(id) ON DELETE RESTRICT,FOREIGN KEY(mutation_id) REFERENCES scheduling_booking_mutations(id) ON DELETE RESTRICT);
    CREATE INDEX idx_scheduling_booking_audit_events_booking ON scheduling_booking_audit_events(workspace_id,company_id,booking_id,occurred_at,id);
    CREATE TRIGGER scheduling_booking_audit_events_no_update BEFORE UPDATE ON scheduling_booking_audit_events BEGIN SELECT RAISE(ABORT,'Scheduling booking audit events are append-only'); END;
    CREATE TRIGGER scheduling_booking_audit_events_no_delete BEFORE DELETE ON scheduling_booking_audit_events BEGIN SELECT RAISE(ABORT,'Scheduling booking audit events are append-only'); END;
  `);}},
  { id:47,name:"0047_scheduling_booking_mutation_operation_scope",checksumSource:"scheduling-booking-mutation-operation-scoped-idempotency|preserve-historical-mutations|already-cancelled-outcome-v1",disableForeignKeys:true,apply(database):void{if(!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='scheduling_booking_mutations'").get())return;database.exec(`
    CREATE TABLE scheduling_booking_mutations_v47(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,idempotency_key TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('create','reschedule','cancel')),request_fingerprint TEXT NOT NULL,
      booking_id TEXT NOT NULL,outcome TEXT NOT NULL CHECK(outcome IN ('created','already_cancelled')) DEFAULT 'created',created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      FOREIGN KEY(booking_id) REFERENCES scheduling_bookings(id) ON DELETE RESTRICT,
      UNIQUE(workspace_id,company_id,operation,idempotency_key)
    );
    INSERT INTO scheduling_booking_mutations_v47(id,workspace_id,company_id,idempotency_key,operation,request_fingerprint,booking_id,outcome,created_at)
    SELECT id,workspace_id,company_id,idempotency_key,operation,request_fingerprint,booking_id,'created',created_at FROM scheduling_booking_mutations;
    DROP TABLE scheduling_booking_mutations;
    ALTER TABLE scheduling_booking_mutations_v47 RENAME TO scheduling_booking_mutations;
    CREATE INDEX idx_scheduling_booking_mutations_lookup ON scheduling_booking_mutations(workspace_id,company_id,operation,idempotency_key);
  `);}},
  { id:48,name:"0048_knowledge_retrieval_v2",checksumSource:"knowledge-v2-document-chunk-index-provenance-lexical-retrieval-v1",apply(database):void{database.exec(`
    CREATE TABLE knowledge_v2_documents(id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,source_id TEXT NOT NULL,source_revision_id TEXT NOT NULL UNIQUE,content_digest TEXT NOT NULL,normalized_text TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,FOREIGN KEY(source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE,FOREIGN KEY(source_revision_id) REFERENCES knowledge_source_revisions(id) ON DELETE CASCADE);
    CREATE INDEX idx_knowledge_v2_documents_scope ON knowledge_v2_documents(workspace_id,company_id,source_revision_id);
    CREATE TABLE knowledge_v2_chunks(id TEXT PRIMARY KEY,document_id TEXT NOT NULL,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,ordinal INTEGER NOT NULL,text TEXT NOT NULL,normalized_text TEXT NOT NULL,byte_length INTEGER NOT NULL,FOREIGN KEY(document_id) REFERENCES knowledge_v2_documents(id) ON DELETE CASCADE,FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,UNIQUE(document_id,ordinal),CHECK(ordinal>=0),CHECK(byte_length>0));
    CREATE INDEX idx_knowledge_v2_chunks_scope ON knowledge_v2_chunks(workspace_id,company_id,document_id,ordinal);
    CREATE TABLE knowledge_v2_chunk_provenance(chunk_id TEXT PRIMARY KEY,source_revision_id TEXT NOT NULL,content_digest TEXT NOT NULL,character_start INTEGER NOT NULL,character_end INTEGER NOT NULL,FOREIGN KEY(chunk_id) REFERENCES knowledge_v2_chunks(id) ON DELETE CASCADE,FOREIGN KEY(source_revision_id) REFERENCES knowledge_source_revisions(id) ON DELETE CASCADE,CHECK(character_start>=0),CHECK(character_end>character_start));
    CREATE TABLE knowledge_v2_indexes(id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,source_revision_id TEXT NOT NULL UNIQUE,document_id TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind='lexical'),status TEXT NOT NULL CHECK(status IN ('building','ready','failed')),chunk_count INTEGER NOT NULL,created_at TEXT NOT NULL,completed_at TEXT,FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,FOREIGN KEY(source_revision_id) REFERENCES knowledge_source_revisions(id) ON DELETE CASCADE,FOREIGN KEY(document_id) REFERENCES knowledge_v2_documents(id) ON DELETE CASCADE,CHECK(chunk_count>=0),CHECK((status='ready' AND completed_at IS NOT NULL) OR (status!='ready')));
    CREATE INDEX idx_knowledge_v2_indexes_ready ON knowledge_v2_indexes(workspace_id,company_id,status,source_revision_id);
  `);}},
  { id:49,name:"0049_media_asset_core",checksumSource:"media-asset-blob-streaming-idempotency-tenant-safety-audit-v2",apply(database):void{database.exec(`
    CREATE TABLE media_blobs(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,sha256_digest TEXT NOT NULL CHECK(length(sha256_digest)=64),size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 26214400),media_type TEXT NOT NULL CHECK(media_type IN ('application/pdf','image/jpeg','image/png','image/gif','image/webp')),storage_reference TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','reclaim_pending','reclaimed')),created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,UNIQUE(workspace_id,company_id,id),UNIQUE(storage_reference)
    );
    CREATE UNIQUE INDEX idx_media_blobs_active_identity ON media_blobs(workspace_id,company_id,sha256_digest,size_bytes,media_type) WHERE state='active';
    CREATE TABLE media_assets(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,blob_id TEXT,kind TEXT NOT NULL CHECK(kind IN ('document','image')),media_type TEXT NOT NULL CHECK(media_type IN ('application/pdf','image/jpeg','image/png','image/gif','image/webp')),size_bytes INTEGER CHECK(size_bytes BETWEEN 1 AND 26214400),safe_filename TEXT CHECK(safe_filename IS NULL OR length(safe_filename) BETWEEN 1 AND 180),metadata_json TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','ready','failed','archived','deleted')),created_at TEXT NOT NULL,archived_at TEXT,deleted_at TEXT,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,FOREIGN KEY(workspace_id,company_id,blob_id) REFERENCES media_blobs(workspace_id,company_id,id) ON DELETE RESTRICT,UNIQUE(workspace_id,company_id,id),
      CHECK((status='pending' AND blob_id IS NULL AND size_bytes IS NULL) OR (status='failed' AND blob_id IS NULL) OR (status='ready' AND blob_id IS NOT NULL AND size_bytes IS NOT NULL AND archived_at IS NULL AND deleted_at IS NULL) OR (status='archived' AND blob_id IS NOT NULL AND archived_at IS NOT NULL AND deleted_at IS NULL) OR (status='deleted' AND deleted_at IS NOT NULL))
    );
    CREATE INDEX idx_media_assets_scope_status ON media_assets(workspace_id,company_id,status,created_at DESC,id DESC);
    CREATE TABLE media_idempotency(workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,operation TEXT NOT NULL CHECK(operation='ingest'),idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64),asset_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(workspace_id,company_id,operation,idempotency_key),FOREIGN KEY(workspace_id,company_id,asset_id) REFERENCES media_assets(workspace_id,company_id,id) ON DELETE RESTRICT);
    CREATE TABLE media_asset_associations(id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,asset_id TEXT NOT NULL,owner_type TEXT NOT NULL CHECK(owner_type IN ('conversation_message','knowledge_source','tool_result','outbound_message')),owner_id TEXT NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 200),created_at TEXT NOT NULL,FOREIGN KEY(workspace_id,company_id,asset_id) REFERENCES media_assets(workspace_id,company_id,id) ON DELETE RESTRICT,UNIQUE(workspace_id,company_id,asset_id,owner_type,owner_id));
    CREATE TABLE media_asset_events(id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,asset_id TEXT NOT NULL,event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 100),occurred_at TEXT NOT NULL,FOREIGN KEY(workspace_id,company_id,asset_id) REFERENCES media_assets(workspace_id,company_id,id) ON DELETE RESTRICT);
    CREATE INDEX idx_media_asset_events_scope ON media_asset_events(workspace_id,company_id,asset_id,occurred_at,id);
    CREATE TRIGGER media_asset_events_no_update BEFORE UPDATE ON media_asset_events BEGIN SELECT RAISE(ABORT,'Media events are append-only'); END;
    CREATE TRIGGER media_asset_events_no_delete BEFORE DELETE ON media_asset_events BEGIN SELECT RAISE(ABORT,'Media events are append-only'); END;
    CREATE TRIGGER media_asset_associations_no_update BEFORE UPDATE ON media_asset_associations BEGIN SELECT RAISE(ABORT,'Media associations are immutable'); END;
    CREATE TRIGGER media_asset_associations_no_delete BEFORE DELETE ON media_asset_associations BEGIN SELECT RAISE(ABORT,'Media associations are immutable'); END;
  `);}},
  { id:50,name:"0050_whatsapp_inbound_media",checksumSource:"whatsapp-inbound-media-ledger-provider-neutral-recovery-v1",apply(database):void{database.exec(`
    CREATE TABLE whatsapp_inbound_media(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,whatsapp_connection_id TEXT NOT NULL,
      channel_provider_event_id TEXT NOT NULL,conversation_message_id TEXT NOT NULL,provider_media_id TEXT NOT NULL,
      provider_kind TEXT NOT NULL CHECK(provider_kind IN ('image','document','audio')),declared_mime TEXT NOT NULL,
      safe_filename TEXT,ordinal INTEGER NOT NULL CHECK(ordinal>=0),caption_present INTEGER NOT NULL CHECK(caption_present IN (0,1)),
      state TEXT NOT NULL CHECK(state IN ('pending_download','ingesting','associated','failed','unsupported')),
      media_asset_id TEXT,failure_code TEXT,attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),next_attempt_at TEXT,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      FOREIGN KEY(whatsapp_connection_id) REFERENCES whatsapp_connections(id) ON DELETE CASCADE,
      FOREIGN KEY(channel_provider_event_id) REFERENCES channel_provider_events(id) ON DELETE CASCADE,
      FOREIGN KEY(conversation_message_id) REFERENCES conversation_messages(id) ON DELETE CASCADE,
      FOREIGN KEY(media_asset_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
      UNIQUE(whatsapp_connection_id,channel_provider_event_id,provider_media_id,ordinal),
      CHECK((state='associated' AND media_asset_id IS NOT NULL AND failure_code IS NULL AND completed_at IS NOT NULL)
        OR (state='failed' AND failure_code IS NOT NULL AND completed_at IS NOT NULL)
        OR (state='unsupported' AND failure_code IS NOT NULL AND completed_at IS NOT NULL)
        OR (state IN ('pending_download','ingesting') AND media_asset_id IS NULL AND failure_code IS NULL AND completed_at IS NULL))
    );
    CREATE INDEX idx_whatsapp_inbound_media_recovery ON whatsapp_inbound_media(workspace_id,company_id,state,next_attempt_at,created_at,id);
    CREATE INDEX idx_whatsapp_inbound_media_message ON whatsapp_inbound_media(workspace_id,company_id,conversation_message_id,ordinal);
    ALTER TABLE channel_execution_requests ADD COLUMN media_gate_state TEXT NOT NULL DEFAULT 'open' CHECK(media_gate_state IN ('open','blocked_by_media'));
  `);}},
  { id:51,name:"0051_media_audio_support",checksumSource:"media-core-audio-check-widening-fk-family-rebuild-v1",disableForeignKeys:true,apply(database):void{database.exec(`
    CREATE TABLE media_blobs_v2(id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,sha256_digest TEXT NOT NULL CHECK(length(sha256_digest)=64),size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 26214400),media_type TEXT NOT NULL CHECK(media_type IN ('application/pdf','image/jpeg','image/png','image/gif','image/webp','audio/mpeg','audio/ogg','audio/wav')),storage_reference TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','reclaim_pending','reclaimed')),created_at TEXT NOT NULL,FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,UNIQUE(workspace_id,company_id,id),UNIQUE(storage_reference));
    CREATE TABLE media_assets_v2(id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,blob_id TEXT,kind TEXT NOT NULL CHECK(kind IN ('document','image','audio')),media_type TEXT NOT NULL CHECK(media_type IN ('application/pdf','image/jpeg','image/png','image/gif','image/webp','audio/mpeg','audio/ogg','audio/wav')),size_bytes INTEGER CHECK(size_bytes BETWEEN 1 AND 26214400),safe_filename TEXT CHECK(safe_filename IS NULL OR length(safe_filename) BETWEEN 1 AND 180),metadata_json TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','ready','failed','archived','deleted')),created_at TEXT NOT NULL,archived_at TEXT,deleted_at TEXT,FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,FOREIGN KEY(workspace_id,company_id,blob_id) REFERENCES media_blobs(workspace_id,company_id,id) ON DELETE RESTRICT,UNIQUE(workspace_id,company_id,id),CHECK((status='pending' AND blob_id IS NULL AND size_bytes IS NULL) OR (status='failed' AND blob_id IS NULL) OR (status='ready' AND blob_id IS NOT NULL AND size_bytes IS NOT NULL AND archived_at IS NULL AND deleted_at IS NULL) OR (status='archived' AND blob_id IS NOT NULL AND archived_at IS NOT NULL AND deleted_at IS NULL) OR (status='deleted' AND deleted_at IS NOT NULL)));
    CREATE TABLE media_idempotency_v2(workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,operation TEXT NOT NULL CHECK(operation='ingest'),idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64),asset_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(workspace_id,company_id,operation,idempotency_key),FOREIGN KEY(workspace_id,company_id,asset_id) REFERENCES media_assets(workspace_id,company_id,id) ON DELETE RESTRICT);
    CREATE TABLE media_asset_associations_v2(id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,asset_id TEXT NOT NULL,owner_type TEXT NOT NULL CHECK(owner_type IN ('conversation_message','knowledge_source','tool_result','outbound_message')),owner_id TEXT NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 200),created_at TEXT NOT NULL,FOREIGN KEY(workspace_id,company_id,asset_id) REFERENCES media_assets(workspace_id,company_id,id) ON DELETE RESTRICT,UNIQUE(workspace_id,company_id,asset_id,owner_type,owner_id));
    CREATE TABLE media_asset_events_v2(id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,asset_id TEXT NOT NULL,event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 100),occurred_at TEXT NOT NULL,FOREIGN KEY(workspace_id,company_id,asset_id) REFERENCES media_assets(workspace_id,company_id,id) ON DELETE RESTRICT);
    INSERT INTO media_blobs_v2 SELECT * FROM media_blobs; INSERT INTO media_assets_v2 SELECT * FROM media_assets; INSERT INTO media_idempotency_v2 SELECT * FROM media_idempotency; INSERT INTO media_asset_associations_v2 SELECT * FROM media_asset_associations; INSERT INTO media_asset_events_v2 SELECT * FROM media_asset_events;
    DROP TABLE media_asset_events; DROP TABLE media_asset_associations; DROP TABLE media_idempotency; DROP TABLE media_assets; DROP TABLE media_blobs;
    ALTER TABLE media_blobs_v2 RENAME TO media_blobs; ALTER TABLE media_assets_v2 RENAME TO media_assets; ALTER TABLE media_idempotency_v2 RENAME TO media_idempotency; ALTER TABLE media_asset_associations_v2 RENAME TO media_asset_associations; ALTER TABLE media_asset_events_v2 RENAME TO media_asset_events;
    CREATE UNIQUE INDEX idx_media_blobs_active_identity ON media_blobs(workspace_id,company_id,sha256_digest,size_bytes,media_type) WHERE state='active'; CREATE INDEX idx_media_assets_scope_status ON media_assets(workspace_id,company_id,status,created_at DESC,id DESC); CREATE INDEX idx_media_asset_events_scope ON media_asset_events(workspace_id,company_id,asset_id,occurred_at,id); CREATE TRIGGER media_asset_events_no_update BEFORE UPDATE ON media_asset_events BEGIN SELECT RAISE(ABORT,'Media events are append-only'); END; CREATE TRIGGER media_asset_events_no_delete BEFORE DELETE ON media_asset_events BEGIN SELECT RAISE(ABORT,'Media events are append-only'); END; CREATE TRIGGER media_asset_associations_no_update BEFORE UPDATE ON media_asset_associations BEGIN SELECT RAISE(ABORT,'Media associations are immutable'); END; CREATE TRIGGER media_asset_associations_no_delete BEFORE DELETE ON media_asset_associations BEGIN SELECT RAISE(ABORT,'Media associations are immutable'); END;
  `);}},
  { id:52,name:"0052_whatsapp_inbound_media_recovery_lease",checksumSource:"whatsapp-inbound-media-durable-recovery-lease-v1",apply(database):void{database.exec(`
    ALTER TABLE whatsapp_inbound_media ADD COLUMN lease_token TEXT;
    ALTER TABLE whatsapp_inbound_media ADD COLUMN lease_owner TEXT;
    ALTER TABLE whatsapp_inbound_media ADD COLUMN lease_acquired_at TEXT;
    ALTER TABLE whatsapp_inbound_media ADD COLUMN lease_expires_at TEXT;
    CREATE INDEX idx_whatsapp_inbound_media_lease_recovery ON whatsapp_inbound_media(workspace_id,company_id,whatsapp_connection_id,state,next_attempt_at,lease_expires_at,id);
  `);}},
  { id:53,name:"0053_whatsapp_inbound_media_retry_diagnostics",checksumSource:"whatsapp-inbound-media-retry-diagnostics-v1",apply(database):void{database.exec(`
    ALTER TABLE whatsapp_inbound_media ADD COLUMN last_retry_failure_code TEXT;
    ALTER TABLE whatsapp_inbound_media ADD COLUMN last_retry_failure_at TEXT;
  `);}},
  { id:54,name:"0054_scheduling_external_calendar_operations",checksumSource:"external-calendar-bindings-events-write-operations-leases-v1",apply(database):void{database.exec(`
    CREATE TABLE scheduling_external_resource_bindings(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,resource_id TEXT NOT NULL,integration_connection_id TEXT NOT NULL,external_calendar_id TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      FOREIGN KEY(resource_id) REFERENCES scheduling_resources(id) ON DELETE CASCADE,
      FOREIGN KEY(integration_connection_id) REFERENCES integration_connections(id) ON DELETE CASCADE,
      UNIQUE(workspace_id,company_id,resource_id),UNIQUE(integration_connection_id,external_calendar_id),CHECK(length(external_calendar_id) BETWEEN 1 AND 200)
    );
    CREATE TABLE scheduling_external_booking_events(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,booking_id TEXT NOT NULL,binding_id TEXT NOT NULL,external_event_id TEXT NOT NULL,remote_version TEXT,remote_state TEXT NOT NULL CHECK(remote_state IN ('active','cancelled')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      FOREIGN KEY(booking_id) REFERENCES scheduling_bookings(id) ON DELETE CASCADE,
      FOREIGN KEY(binding_id) REFERENCES scheduling_external_resource_bindings(id) ON DELETE CASCADE,
      UNIQUE(workspace_id,company_id,booking_id,binding_id),UNIQUE(binding_id,external_event_id),CHECK(length(external_event_id) BETWEEN 1 AND 200),CHECK(remote_version IS NULL OR length(remote_version) BETWEEN 1 AND 200)
    );
    CREATE TABLE scheduling_external_write_operations(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,binding_id TEXT NOT NULL,operation TEXT NOT NULL CHECK(operation IN ('create','reschedule','cancel')),idempotency_key TEXT NOT NULL,request_fingerprint TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('pending','in_flight','reconciling','succeeded','uncertain','conflict','failed')),provider_request_correlation_id TEXT NOT NULL,booking_id TEXT,source_booking_id TEXT,hold_id TEXT,reservation_expires_at TEXT,external_event_id TEXT NOT NULL,expected_remote_version TEXT,lease_token TEXT,lease_owner TEXT,lease_acquired_at TEXT,lease_expires_at TEXT,attempt_count INTEGER NOT NULL CHECK(attempt_count>=0),last_attempt_at TEXT,safe_failure_code TEXT CHECK(safe_failure_code IS NULL OR safe_failure_code IN ('unauthorized','forbidden','conflict','rate_limited','unavailable','timeout','invalid_response','validation_error','recovery_expired')),completed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      FOREIGN KEY(binding_id) REFERENCES scheduling_external_resource_bindings(id) ON DELETE CASCADE,
      FOREIGN KEY(booking_id) REFERENCES scheduling_bookings(id) ON DELETE RESTRICT,
      FOREIGN KEY(source_booking_id) REFERENCES scheduling_bookings(id) ON DELETE RESTRICT,
      FOREIGN KEY(hold_id) REFERENCES scheduling_holds(id) ON DELETE RESTRICT,
      UNIQUE(workspace_id,company_id,binding_id,operation,idempotency_key),
      CHECK(length(idempotency_key) BETWEEN 1 AND 200),CHECK(length(request_fingerprint)=64),CHECK(length(provider_request_correlation_id) BETWEEN 1 AND 200),CHECK(length(external_event_id) BETWEEN 1 AND 200),CHECK(expected_remote_version IS NULL OR length(expected_remote_version) BETWEEN 1 AND 200),
      CHECK((lease_token IS NULL AND lease_owner IS NULL AND lease_acquired_at IS NULL AND lease_expires_at IS NULL) OR (lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_acquired_at IS NOT NULL AND lease_expires_at IS NOT NULL)),
      CHECK((hold_id IS NULL AND reservation_expires_at IS NULL) OR (hold_id IS NOT NULL AND reservation_expires_at IS NOT NULL)),
      CHECK((operation='create' AND source_booking_id IS NULL AND hold_id IS NOT NULL) OR (operation='reschedule' AND source_booking_id IS NOT NULL AND hold_id IS NOT NULL) OR (operation='cancel' AND source_booking_id IS NOT NULL AND hold_id IS NULL)),
      CHECK((state IN ('pending','in_flight','reconciling','uncertain') AND completed_at IS NULL) OR (state IN ('succeeded','conflict','failed') AND completed_at IS NOT NULL))
    );
    CREATE INDEX idx_scheduling_external_write_operations_recovery ON scheduling_external_write_operations(workspace_id,company_id,state,lease_expires_at,reservation_expires_at,created_at,id);
    CREATE TRIGGER scheduling_external_resource_bindings_scope_insert BEFORE INSERT ON scheduling_external_resource_bindings
    WHEN NOT EXISTS(SELECT 1 FROM scheduling_resources r WHERE r.id=NEW.resource_id AND r.workspace_id=NEW.workspace_id AND r.company_id=NEW.company_id)
      OR NOT EXISTS(SELECT 1 FROM integration_connections i WHERE i.id=NEW.integration_connection_id AND i.workspace_id=NEW.workspace_id AND i.company_id=NEW.company_id)
    BEGIN SELECT RAISE(ABORT,'Scheduling external resource binding scope is invalid'); END;
    CREATE TRIGGER scheduling_external_resource_bindings_scope_update BEFORE UPDATE OF workspace_id,company_id,resource_id,integration_connection_id ON scheduling_external_resource_bindings
    WHEN NOT EXISTS(SELECT 1 FROM scheduling_resources r WHERE r.id=NEW.resource_id AND r.workspace_id=NEW.workspace_id AND r.company_id=NEW.company_id)
      OR NOT EXISTS(SELECT 1 FROM integration_connections i WHERE i.id=NEW.integration_connection_id AND i.workspace_id=NEW.workspace_id AND i.company_id=NEW.company_id)
    BEGIN SELECT RAISE(ABORT,'Scheduling external resource binding scope is invalid'); END;
    CREATE TRIGGER scheduling_external_booking_events_scope_insert BEFORE INSERT ON scheduling_external_booking_events
    WHEN NOT EXISTS(SELECT 1 FROM scheduling_bookings b WHERE b.id=NEW.booking_id AND b.workspace_id=NEW.workspace_id AND b.company_id=NEW.company_id)
      OR NOT EXISTS(SELECT 1 FROM scheduling_external_resource_bindings r WHERE r.id=NEW.binding_id AND r.workspace_id=NEW.workspace_id AND r.company_id=NEW.company_id)
    BEGIN SELECT RAISE(ABORT,'Scheduling external booking event scope is invalid'); END;
    CREATE TRIGGER scheduling_external_booking_events_scope_update BEFORE UPDATE OF workspace_id,company_id,booking_id,binding_id ON scheduling_external_booking_events
    WHEN NOT EXISTS(SELECT 1 FROM scheduling_bookings b WHERE b.id=NEW.booking_id AND b.workspace_id=NEW.workspace_id AND b.company_id=NEW.company_id)
      OR NOT EXISTS(SELECT 1 FROM scheduling_external_resource_bindings r WHERE r.id=NEW.binding_id AND r.workspace_id=NEW.workspace_id AND r.company_id=NEW.company_id)
    BEGIN SELECT RAISE(ABORT,'Scheduling external booking event scope is invalid'); END;
    CREATE TRIGGER scheduling_external_write_operations_scope_insert BEFORE INSERT ON scheduling_external_write_operations
    WHEN NOT EXISTS(SELECT 1 FROM scheduling_external_resource_bindings r WHERE r.id=NEW.binding_id AND r.workspace_id=NEW.workspace_id AND r.company_id=NEW.company_id)
      OR (NEW.booking_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scheduling_bookings b WHERE b.id=NEW.booking_id AND b.workspace_id=NEW.workspace_id AND b.company_id=NEW.company_id))
      OR (NEW.source_booking_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scheduling_bookings b WHERE b.id=NEW.source_booking_id AND b.workspace_id=NEW.workspace_id AND b.company_id=NEW.company_id))
      OR (NEW.hold_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scheduling_holds h WHERE h.id=NEW.hold_id AND h.workspace_id=NEW.workspace_id AND h.company_id=NEW.company_id))
    BEGIN SELECT RAISE(ABORT,'Scheduling external write operation scope is invalid'); END;
    CREATE TRIGGER scheduling_external_write_operations_scope_update BEFORE UPDATE OF workspace_id,company_id,binding_id,booking_id,source_booking_id,hold_id ON scheduling_external_write_operations
    WHEN NOT EXISTS(SELECT 1 FROM scheduling_external_resource_bindings r WHERE r.id=NEW.binding_id AND r.workspace_id=NEW.workspace_id AND r.company_id=NEW.company_id)
      OR (NEW.booking_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scheduling_bookings b WHERE b.id=NEW.booking_id AND b.workspace_id=NEW.workspace_id AND b.company_id=NEW.company_id))
      OR (NEW.source_booking_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scheduling_bookings b WHERE b.id=NEW.source_booking_id AND b.workspace_id=NEW.workspace_id AND b.company_id=NEW.company_id))
      OR (NEW.hold_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scheduling_holds h WHERE h.id=NEW.hold_id AND h.workspace_id=NEW.workspace_id AND h.company_id=NEW.company_id))
    BEGIN SELECT RAISE(ABORT,'Scheduling external write operation scope is invalid'); END;
  `);}},
  { id:55,name:"0055_external_write_operation_booking_reference",checksumSource:"external-write-operation-booking-reference-v1",apply(database):void{database.exec(`
    ALTER TABLE scheduling_external_write_operations ADD COLUMN requested_booking_reference TEXT;
  `);}},
  { id:56,name:"0056_meta_embedded_signup_attempts",checksumSource:"meta-embedded-signup-attempts-v2|assistant-pk-fk|tenant-scope-triggers|hmac-digests|cas-lifecycle",apply(database):void{database.exec(`
    CREATE TABLE meta_embedded_signup_attempts(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,initiating_user_id TEXT NOT NULL,assistant_profile_id TEXT NOT NULL,
      target_whatsapp_connection_id TEXT,target_integration_connection_id TEXT,
      provider TEXT NOT NULL CHECK(provider='meta_whatsapp'),kind TEXT NOT NULL CHECK(kind='cloud_api'),
      status TEXT NOT NULL CHECK(status IN ('started','completing','completed','failed','expired')),
      state_digest TEXT NOT NULL CHECK(length(state_digest)=64),completion_code_digest TEXT CHECK(completion_code_digest IS NULL OR length(completion_code_digest)=64),
      created_at TEXT NOT NULL,expires_at TEXT NOT NULL,claimed_at TEXT,completed_at TEXT,failed_at TEXT,expired_at TEXT,
      safe_failure_code TEXT CHECK(safe_failure_code IS NULL OR safe_failure_code IN ('cancelled','expired','verification_failed','provider_rejected','provider_unavailable')),
      version INTEGER NOT NULL CHECK(version>0),updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      FOREIGN KEY(initiating_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY(assistant_profile_id) REFERENCES assistant_profiles(id) ON DELETE RESTRICT,
      CHECK(expires_at>created_at),
      CHECK((claimed_at IS NULL)=(completion_code_digest IS NULL)),
      CHECK((status='started' AND claimed_at IS NULL AND completed_at IS NULL AND failed_at IS NULL AND expired_at IS NULL AND safe_failure_code IS NULL)
        OR (status='completing' AND claimed_at IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL AND expired_at IS NULL AND safe_failure_code IS NULL)
        OR (status='completed' AND claimed_at IS NOT NULL AND completed_at IS NOT NULL AND failed_at IS NULL AND expired_at IS NULL AND safe_failure_code IS NULL)
        OR (status='failed' AND completed_at IS NULL AND failed_at IS NOT NULL AND expired_at IS NULL AND safe_failure_code IS NOT NULL)
        OR (status='expired' AND completed_at IS NULL AND failed_at IS NULL AND expired_at IS NOT NULL AND safe_failure_code='expired'))
    );
    CREATE INDEX idx_meta_embedded_signup_attempts_scope ON meta_embedded_signup_attempts(workspace_id,company_id,initiating_user_id,created_at DESC,id DESC);
    CREATE INDEX idx_meta_embedded_signup_attempts_expiry ON meta_embedded_signup_attempts(status,expires_at,id);

    CREATE TRIGGER meta_embedded_signup_attempts_assistant_scope_insert
    BEFORE INSERT ON meta_embedded_signup_attempts
    WHEN NOT EXISTS(
      SELECT 1 FROM assistant_profiles a
      WHERE a.id=NEW.assistant_profile_id AND a.company_id=NEW.company_id
    )
    BEGIN
      SELECT RAISE(ABORT,'Meta Embedded Signup assistant profile scope is invalid');
    END;

    CREATE TRIGGER meta_embedded_signup_attempts_assistant_scope_update
    BEFORE UPDATE OF assistant_profile_id,company_id ON meta_embedded_signup_attempts
    WHEN NOT EXISTS(
      SELECT 1 FROM assistant_profiles a
      WHERE a.id=NEW.assistant_profile_id AND a.company_id=NEW.company_id
    )
    BEGIN
      SELECT RAISE(ABORT,'Meta Embedded Signup assistant profile scope is invalid');
    END;
  `);}},
  { id:57,name:"0057_whatsapp_integration_connection_link",checksumSource:"whatsapp-integration-connection-link-v1|nullable-legacy|tenant-scoped-unique",apply(database):void{database.exec(`
    ALTER TABLE whatsapp_connections ADD COLUMN integration_connection_id TEXT;
    CREATE UNIQUE INDEX uq_whatsapp_connections_integration_connection_id ON whatsapp_connections(integration_connection_id) WHERE integration_connection_id IS NOT NULL;
    CREATE TRIGGER whatsapp_connections_integration_connection_scope_insert BEFORE INSERT ON whatsapp_connections
    WHEN NEW.integration_connection_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM integration_connections i WHERE i.id=NEW.integration_connection_id AND i.workspace_id=NEW.workspace_id AND i.company_id=NEW.company_id
    ) BEGIN SELECT RAISE(ABORT,'WhatsApp Integration Connection scope is invalid'); END;
    CREATE TRIGGER whatsapp_connections_integration_connection_scope_update BEFORE UPDATE OF integration_connection_id,workspace_id,company_id ON whatsapp_connections
    WHEN NEW.integration_connection_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM integration_connections i WHERE i.id=NEW.integration_connection_id AND i.workspace_id=NEW.workspace_id AND i.company_id=NEW.company_id
    ) BEGIN SELECT RAISE(ABORT,'WhatsApp Integration Connection scope is invalid'); END;
  `);}},
  { id:58,name:"0058_meta_embedded_signup_resolved_connection",checksumSource:"meta-embedded-signup-resolved-connection-v1|durable-crash-recovery-correlation",apply(database):void{database.exec(`
    ALTER TABLE meta_embedded_signup_attempts ADD COLUMN resolved_integration_connection_id TEXT;
    CREATE UNIQUE INDEX uq_meta_embedded_signup_attempts_resolved_connection ON meta_embedded_signup_attempts(resolved_integration_connection_id) WHERE resolved_integration_connection_id IS NOT NULL;
    CREATE TRIGGER meta_embedded_signup_attempts_resolved_connection_scope_insert BEFORE INSERT ON meta_embedded_signup_attempts
    WHEN NEW.resolved_integration_connection_id IS NOT NULL AND (length(NEW.resolved_integration_connection_id)!=36 OR substr(NEW.resolved_integration_connection_id,1,4)!='inc_' OR substr(NEW.resolved_integration_connection_id,5) GLOB '*[^0-9a-f]*' OR EXISTS(SELECT 1 FROM integration_connections i WHERE i.id=NEW.resolved_integration_connection_id AND (i.workspace_id!=NEW.workspace_id OR i.company_id!=NEW.company_id OR i.provider!='meta_whatsapp' OR i.kind!='cloud_api')))
    BEGIN SELECT RAISE(ABORT,'Meta Embedded Signup resolved Integration Connection scope is invalid'); END;
    CREATE TRIGGER meta_embedded_signup_attempts_resolved_connection_immutable BEFORE UPDATE OF resolved_integration_connection_id ON meta_embedded_signup_attempts
    WHEN OLD.resolved_integration_connection_id IS NOT NULL AND NEW.resolved_integration_connection_id IS NOT OLD.resolved_integration_connection_id
    BEGIN SELECT RAISE(ABORT,'Meta Embedded Signup resolved Integration Connection is immutable'); END;
    CREATE TRIGGER meta_embedded_signup_attempts_resolved_connection_scope_update BEFORE UPDATE OF resolved_integration_connection_id,workspace_id,company_id ON meta_embedded_signup_attempts
    WHEN NEW.resolved_integration_connection_id IS NOT NULL AND (length(NEW.resolved_integration_connection_id)!=36 OR substr(NEW.resolved_integration_connection_id,1,4)!='inc_' OR substr(NEW.resolved_integration_connection_id,5) GLOB '*[^0-9a-f]*' OR EXISTS(SELECT 1 FROM integration_connections i WHERE i.id=NEW.resolved_integration_connection_id AND (i.workspace_id!=NEW.workspace_id OR i.company_id!=NEW.company_id OR i.provider!='meta_whatsapp' OR i.kind!='cloud_api')))
    BEGIN SELECT RAISE(ABORT,'Meta Embedded Signup resolved Integration Connection scope is invalid'); END;
  `);}},
  { id:59,name:"0059_conversation_handoff_authority",checksumSource:"conversation-authority-generation-v1|control-operation-idempotency-v1|monotonic-conversation-events-v1|tenant-scoped-append-only-v1",apply(database):void{database.exec(`
    ALTER TABLE conversation_controls
      ADD COLUMN authority_generation INTEGER NOT NULL DEFAULT 1
      CHECK(authority_generation > 0);

    CREATE TABLE conversation_control_operations(
      workspace_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 200),
      actor_user_id TEXT NOT NULL CHECK(length(actor_user_id) BETWEEN 1 AND 128),
      operation TEXT NOT NULL CHECK(operation IN ('takeover','release','resolve')),
      request_fingerprint TEXT NOT NULL CHECK(
        length(request_fingerprint)=64
        AND request_fingerprint NOT GLOB '*[^0-9a-f]*'
      ),
      expected_version INTEGER NOT NULL CHECK(expected_version > 0),
      outcome TEXT NOT NULL CHECK(outcome IN ('applied','stale_version','controlled_by_other','not_controller')),
      result_category TEXT NOT NULL CHECK(result_category IN ('success','conflict','not_found')),
      resulting_control_state TEXT CHECK(
        resulting_control_state IS NULL
        OR resulting_control_state IN ('automated','human_required','human_controlled')
      ),
      resulting_version INTEGER CHECK(resulting_version IS NULL OR resulting_version > 0),
      resulting_authority_generation INTEGER CHECK(
        resulting_authority_generation IS NULL
        OR resulting_authority_generation > 0
      ),
      resulting_controller_relation TEXT CHECK(
        resulting_controller_relation IS NULL
        OR resulting_controller_relation IN ('current_actor','other_actor','none')
      ),
      occurred_at TEXT NOT NULL,
      CHECK(
        (outcome='applied' AND result_category='success')
        OR (outcome='stale_version' AND result_category='conflict')
        OR (
          outcome IN ('controlled_by_other','not_controller')
          AND result_category='not_found'
        )
      ),
      PRIMARY KEY(workspace_id,company_id,conversation_id,operation_id),
      FOREIGN KEY(workspace_id,company_id)
        REFERENCES companies(workspace_id,id) ON DELETE CASCADE
    );

    CREATE INDEX idx_conversation_control_operations_conversation
      ON conversation_control_operations(
        workspace_id,company_id,conversation_id,occurred_at,operation_id
      );

    CREATE TRIGGER conversation_control_operations_scope_insert
    BEFORE INSERT ON conversation_control_operations
    WHEN NOT EXISTS(
      SELECT 1
      FROM conversations c
      JOIN companies co ON co.id=c.company_id
      WHERE c.id=NEW.conversation_id
        AND c.company_id=NEW.company_id
        AND co.workspace_id=NEW.workspace_id
    )
    BEGIN
      SELECT RAISE(ABORT,'Conversation control operation scope is invalid');
    END;

    CREATE TRIGGER conversation_control_operations_no_update
    BEFORE UPDATE ON conversation_control_operations
    BEGIN
      SELECT RAISE(ABORT,'Conversation control operations are append-only');
    END;

    CREATE TRIGGER conversation_control_operations_no_delete
    BEFORE DELETE ON conversation_control_operations
    BEGIN
      SELECT RAISE(ABORT,'Conversation control operations are append-only');
    END;

    CREATE TABLE conversation_events(
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      workspace_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK(event_type IN (
        'handoff_requested',
        'takeover_applied',
        'takeover_rejected',
        'release_applied',
        'release_rejected',
        'automation_resumed',
        'automation_blocked',
        'operator_message_created',
        'assistant_message_created',
        'inbound_message_received',
        'conversation_reopened',
        'conversation_resolved'
      )),
      actor_user_id TEXT CHECK(
        actor_user_id IS NULL OR length(actor_user_id) BETWEEN 1 AND 128
      ),
      control_version INTEGER CHECK(
        control_version IS NULL OR control_version > 0
      ),
      authority_generation INTEGER CHECK(
        authority_generation IS NULL OR authority_generation > 0
      ),
      related_message_id TEXT,
      related_operation_id TEXT CHECK(
        related_operation_id IS NULL OR length(related_operation_id) BETWEEN 1 AND 200
      ),
      occurred_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id,company_id)
        REFERENCES companies(workspace_id,id) ON DELETE CASCADE
    );

    CREATE INDEX idx_conversation_events_company_sequence
      ON conversation_events(workspace_id,company_id,sequence);

    CREATE INDEX idx_conversation_events_conversation_sequence
      ON conversation_events(workspace_id,company_id,conversation_id,sequence);

    CREATE TRIGGER conversation_events_scope_insert
    BEFORE INSERT ON conversation_events
    WHEN NOT EXISTS(
      SELECT 1
      FROM conversations c
      JOIN companies co ON co.id=c.company_id
      WHERE c.id=NEW.conversation_id
        AND c.company_id=NEW.company_id
        AND co.workspace_id=NEW.workspace_id
    )
    OR (
      NEW.related_message_id IS NOT NULL
      AND NOT EXISTS(
        SELECT 1
        FROM conversation_messages m
        WHERE m.id=NEW.related_message_id
          AND m.conversation_id=NEW.conversation_id
      )
    )
    OR (
      NEW.related_operation_id IS NOT NULL
      AND NOT EXISTS(
        SELECT 1
        FROM conversation_control_operations o
        WHERE o.workspace_id=NEW.workspace_id
          AND o.company_id=NEW.company_id
          AND o.conversation_id=NEW.conversation_id
          AND o.operation_id=NEW.related_operation_id
      )
    )
    BEGIN
      SELECT RAISE(ABORT,'Conversation event scope is invalid');
    END;

    CREATE TRIGGER conversation_events_no_update
    BEFORE UPDATE ON conversation_events
    BEGIN
      SELECT RAISE(ABORT,'Conversation events are append-only');
    END;

    CREATE TRIGGER conversation_events_no_delete
    BEFORE DELETE ON conversation_events
    BEGIN
      SELECT RAISE(ABORT,'Conversation events are append-only');
    END;
  `);}},
  { id:60,name:"0060_voice_ai_whatsapp",checksumSource:"voice-policy-transcript-leased-work-foundations|preserve-outbound-rowid-and-event-sequence-high-watermark|immutable-message-evidence|tenant-scoped-voice-persistence-v1",disableForeignKeys:true,apply(database):void{
    const eventHighWatermark=(database.prepare("SELECT seq FROM sqlite_sequence WHERE name='conversation_events'").get() as {seq:number}|undefined)?.seq ?? 0;
    database.exec(`
      CREATE TABLE channel_execution_requests_v60(
        id TEXT PRIMARY KEY,channel_provider_event_id TEXT NOT NULL UNIQUE REFERENCES channel_provider_events(id) ON DELETE CASCADE,
        state TEXT NOT NULL CHECK(state IN ('pending','leased','completed','failed','unsupported')),snapshot_json TEXT NOT NULL,
        lease_owner TEXT,lease_expires_at TEXT,outcome TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        media_gate_state TEXT NOT NULL DEFAULT 'open' CHECK(media_gate_state IN ('open','blocked_by_media','blocked_by_transcript')),
        CHECK((lease_owner IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
      );
      INSERT INTO channel_execution_requests_v60 SELECT * FROM channel_execution_requests;
      DROP TABLE channel_execution_requests;
      ALTER TABLE channel_execution_requests_v60 RENAME TO channel_execution_requests;
      CREATE INDEX idx_channel_execution_requests_ready ON channel_execution_requests(state,created_at,id);
      CREATE INDEX idx_channel_execution_requests_lease ON channel_execution_requests(state,lease_expires_at,id);

      CREATE TABLE outbound_deliveries_v60(
        id TEXT PRIMARY KEY,provider_message_record_id TEXT NOT NULL REFERENCES provider_message_records(id) ON DELETE CASCADE,
        transport_connection_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('pending','leased','accepted','delivered','read','retryable','permanent_failure','uncertain','blocked_by_synthesis','suppressed')),
        attempt_count INTEGER NOT NULL CHECK(attempt_count>=0),next_attempt_at TEXT NOT NULL,lease_owner TEXT,lease_expires_at TEXT,safe_error_category TEXT,
        payload_kind TEXT NOT NULL DEFAULT 'text' CHECK(payload_kind IN ('text','deferred_voice','audio')),
        response_policy TEXT NOT NULL DEFAULT 'standard' CHECK(response_policy IN ('standard','deferred_voice')),
        media_asset_id TEXT REFERENCES media_assets(id) ON DELETE RESTRICT,
        expected_authority_generation INTEGER CHECK(expected_authority_generation IS NULL OR expected_authority_generation>0),
        send_started_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        CHECK((lease_owner IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
        CHECK(payload_kind!='deferred_voice' OR response_policy='deferred_voice'),
        CHECK(payload_kind!='deferred_voice' OR state IN ('blocked_by_synthesis','suppressed')),
        CHECK(response_policy!='deferred_voice' OR expected_authority_generation IS NOT NULL),
        CHECK(state!='blocked_by_synthesis' OR (payload_kind='deferred_voice' AND response_policy='deferred_voice' AND expected_authority_generation IS NOT NULL)),
        CHECK(payload_kind!='audio' OR media_asset_id IS NOT NULL),CHECK(payload_kind!='text' OR media_asset_id IS NULL),
        UNIQUE(provider_message_record_id,transport_connection_id)
      );
      INSERT INTO outbound_deliveries_v60(rowid,id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,lease_owner,lease_expires_at,safe_error_category,payload_kind,response_policy,media_asset_id,expected_authority_generation,send_started_at,created_at,updated_at)
      SELECT rowid,id,provider_message_record_id,transport_connection_id,state,attempt_count,next_attempt_at,lease_owner,lease_expires_at,safe_error_category,'text','standard',NULL,NULL,NULL,created_at,updated_at FROM outbound_deliveries;
      DROP TABLE outbound_deliveries;
      ALTER TABLE outbound_deliveries_v60 RENAME TO outbound_deliveries;
      CREATE INDEX idx_outbound_deliveries_ready ON outbound_deliveries(state,next_attempt_at,id);
      CREATE INDEX idx_outbound_deliveries_lease ON outbound_deliveries(state,lease_expires_at,id);
      CREATE TRIGGER outbound_deliveries_media_scope_insert BEFORE INSERT ON outbound_deliveries
      WHEN NEW.media_asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM media_assets a JOIN provider_message_records p ON p.id=NEW.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id JOIN conversations c ON c.id=m.conversation_id WHERE a.id=NEW.media_asset_id AND a.workspace_id=(SELECT workspace_id FROM companies WHERE id=c.company_id) AND a.company_id=c.company_id)
      BEGIN SELECT RAISE(ABORT,'Outbound delivery media asset scope is invalid'); END;
      CREATE TRIGGER outbound_deliveries_media_scope_update BEFORE UPDATE OF provider_message_record_id,media_asset_id ON outbound_deliveries
      WHEN NEW.media_asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM media_assets a JOIN provider_message_records p ON p.id=NEW.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id JOIN conversations c ON c.id=m.conversation_id WHERE a.id=NEW.media_asset_id AND a.workspace_id=(SELECT workspace_id FROM companies WHERE id=c.company_id) AND a.company_id=c.company_id)
      BEGIN SELECT RAISE(ABORT,'Outbound delivery media asset scope is invalid'); END;
      CREATE TRIGGER outbound_deliveries_suppressed_terminal BEFORE UPDATE OF state ON outbound_deliveries
      WHEN OLD.state='suppressed' AND NEW.state!='suppressed'
      BEGIN SELECT RAISE(ABORT,'Suppressed outbound deliveries are terminal'); END;

      CREATE TABLE conversation_events_v60(
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL CHECK(event_type IN ('handoff_requested','takeover_applied','takeover_rejected','release_applied','release_rejected','automation_resumed','automation_blocked','operator_message_created','assistant_message_created','inbound_message_received','conversation_reopened','conversation_resolved','voice_state_changed')),
        actor_user_id TEXT CHECK(actor_user_id IS NULL OR length(actor_user_id) BETWEEN 1 AND 128),control_version INTEGER CHECK(control_version IS NULL OR control_version>0),authority_generation INTEGER CHECK(authority_generation IS NULL OR authority_generation>0),related_message_id TEXT,related_operation_id TEXT CHECK(related_operation_id IS NULL OR length(related_operation_id) BETWEEN 1 AND 200),occurred_at TEXT NOT NULL,
        FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
        CHECK(event_type!='voice_state_changed' OR related_message_id IS NOT NULL)
      );
      INSERT INTO conversation_events_v60(sequence,id,workspace_id,company_id,conversation_id,event_type,actor_user_id,control_version,authority_generation,related_message_id,related_operation_id,occurred_at)
      SELECT sequence,id,workspace_id,company_id,conversation_id,event_type,actor_user_id,control_version,authority_generation,related_message_id,related_operation_id,occurred_at FROM conversation_events;
      DROP TABLE conversation_events;
      ALTER TABLE conversation_events_v60 RENAME TO conversation_events;
      UPDATE sqlite_sequence SET seq=CASE WHEN seq<${eventHighWatermark} THEN ${eventHighWatermark} ELSE seq END WHERE name='conversation_events';
      CREATE INDEX idx_conversation_events_company_sequence ON conversation_events(workspace_id,company_id,sequence);
      CREATE INDEX idx_conversation_events_conversation_sequence ON conversation_events(workspace_id,company_id,conversation_id,sequence);
      CREATE TRIGGER conversation_events_scope_insert BEFORE INSERT ON conversation_events
      WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id)
        OR (NEW.related_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_messages m WHERE m.id=NEW.related_message_id AND m.conversation_id=NEW.conversation_id))
        OR (NEW.related_operation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_control_operations o WHERE o.workspace_id=NEW.workspace_id AND o.company_id=NEW.company_id AND o.conversation_id=NEW.conversation_id AND o.operation_id=NEW.related_operation_id))
      BEGIN SELECT RAISE(ABORT,'Conversation event scope is invalid'); END;
      CREATE TRIGGER conversation_events_no_update BEFORE UPDATE ON conversation_events BEGIN SELECT RAISE(ABORT,'Conversation events are append-only'); END;
      CREATE TRIGGER conversation_events_no_delete BEFORE DELETE ON conversation_events BEGIN SELECT RAISE(ABORT,'Conversation events are append-only'); END;
      CREATE TRIGGER conversation_messages_no_update BEFORE UPDATE ON conversation_messages BEGIN SELECT RAISE(ABORT,'Conversation messages are immutable'); END;
      CREATE TABLE conversation_message_teardowns(
        conversation_id TEXT PRIMARY KEY,company_id INTEGER NOT NULL
      );
      CREATE TRIGGER companies_authorize_conversation_message_teardown BEFORE DELETE ON companies
      BEGIN
        INSERT INTO conversation_message_teardowns(conversation_id,company_id)
        SELECT id,company_id FROM conversations WHERE company_id=OLD.id;
      END;
      CREATE TRIGGER companies_clear_conversation_message_teardown AFTER DELETE ON companies
      BEGIN
        DELETE FROM conversation_message_teardowns WHERE company_id=OLD.id;
      END;
      CREATE TRIGGER conversation_messages_no_delete BEFORE DELETE ON conversation_messages
      WHEN NOT EXISTS(SELECT 1 FROM conversation_message_teardowns t WHERE t.conversation_id=OLD.conversation_id)
      BEGIN SELECT RAISE(ABORT,'Conversation messages are immutable'); END;

      CREATE TABLE whatsapp_voice_policies(
        workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,whatsapp_connection_id TEXT NOT NULL UNIQUE REFERENCES whatsapp_connections(id) ON DELETE CASCADE,
        voice_ai_enabled INTEGER NOT NULL DEFAULT 0 CHECK(voice_ai_enabled IN (0,1)),audio_response_mode TEXT NOT NULL DEFAULT 'text_only' CHECK(audio_response_mode IN ('text_only','voice_with_text_fallback')),
        version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE
      );
      INSERT INTO whatsapp_voice_policies(workspace_id,company_id,whatsapp_connection_id,created_at,updated_at)
      SELECT workspace_id,company_id,id,created_at,updated_at FROM whatsapp_connections;
      CREATE TRIGGER whatsapp_connections_seed_voice_policy AFTER INSERT ON whatsapp_connections BEGIN
        INSERT INTO whatsapp_voice_policies(workspace_id,company_id,whatsapp_connection_id,created_at,updated_at)
        VALUES(NEW.workspace_id,NEW.company_id,NEW.id,NEW.created_at,NEW.updated_at);
      END;
      CREATE TRIGGER whatsapp_voice_policies_scope_insert BEFORE INSERT ON whatsapp_voice_policies WHEN NOT EXISTS(SELECT 1 FROM whatsapp_connections w WHERE w.id=NEW.whatsapp_connection_id AND w.workspace_id=NEW.workspace_id AND w.company_id=NEW.company_id) BEGIN SELECT RAISE(ABORT,'WhatsApp voice policy scope is invalid'); END;
      CREATE TRIGGER whatsapp_voice_policies_scope_update BEFORE UPDATE OF workspace_id,company_id,whatsapp_connection_id ON whatsapp_voice_policies WHEN NOT EXISTS(SELECT 1 FROM whatsapp_connections w WHERE w.id=NEW.whatsapp_connection_id AND w.workspace_id=NEW.workspace_id AND w.company_id=NEW.company_id) BEGIN SELECT RAISE(ABORT,'WhatsApp voice policy scope is invalid'); END;
      CREATE TABLE whatsapp_voice_policy_operations(
        workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,whatsapp_connection_id TEXT NOT NULL,operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 200),actor_user_id TEXT NOT NULL CHECK(length(actor_user_id) BETWEEN 1 AND 128),request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'),expected_version INTEGER NOT NULL CHECK(expected_version>0),outcome TEXT NOT NULL CHECK(outcome IN ('applied','stale_version')),resulting_voice_ai_enabled INTEGER CHECK(resulting_voice_ai_enabled IN (0,1)),resulting_audio_response_mode TEXT CHECK(resulting_audio_response_mode IN ('text_only','voice_with_text_fallback')),resulting_version INTEGER CHECK(resulting_version IS NULL OR resulting_version>0),occurred_at TEXT NOT NULL,
        PRIMARY KEY(workspace_id,company_id,whatsapp_connection_id,operation_id),FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,FOREIGN KEY(whatsapp_connection_id) REFERENCES whatsapp_connections(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_whatsapp_voice_policy_operations_connection ON whatsapp_voice_policy_operations(workspace_id,company_id,whatsapp_connection_id,occurred_at,operation_id);
      CREATE TRIGGER whatsapp_voice_policy_operations_scope_insert BEFORE INSERT ON whatsapp_voice_policy_operations WHEN NOT EXISTS(SELECT 1 FROM whatsapp_connections w WHERE w.id=NEW.whatsapp_connection_id AND w.workspace_id=NEW.workspace_id AND w.company_id=NEW.company_id) BEGIN SELECT RAISE(ABORT,'WhatsApp voice policy operation scope is invalid'); END;
      CREATE TRIGGER whatsapp_voice_policy_operations_no_update BEFORE UPDATE ON whatsapp_voice_policy_operations BEGIN SELECT RAISE(ABORT,'WhatsApp voice policy operations are append-only'); END;
      CREATE TRIGGER whatsapp_voice_policy_operations_no_delete BEFORE DELETE ON whatsapp_voice_policy_operations BEGIN SELECT RAISE(ABORT,'WhatsApp voice policy operations are append-only'); END;

      CREATE TABLE conversation_audio_transcripts(
        id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,conversation_message_id TEXT NOT NULL UNIQUE REFERENCES conversation_messages(id) ON DELETE CASCADE,media_asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,normalized_transcript TEXT NOT NULL,language_tag TEXT CHECK(language_tag IS NULL OR length(language_tag) BETWEEN 1 AND 35),input_digest TEXT NOT NULL CHECK(length(input_digest)=64 AND input_digest NOT GLOB '*[^0-9a-f]*'),outcome TEXT NOT NULL CHECK(outcome IN ('completed','unsupported','failed','suppressed')),safe_failure_category TEXT CHECK(safe_failure_category IS NULL OR length(safe_failure_category) BETWEEN 1 AND 100),created_at TEXT NOT NULL,
        FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE
      );
      CREATE INDEX idx_conversation_audio_transcripts_conversation ON conversation_audio_transcripts(workspace_id,company_id,conversation_id,created_at,id);
      CREATE TRIGGER conversation_audio_transcripts_scope_insert BEFORE INSERT ON conversation_audio_transcripts WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id JOIN conversation_messages m ON m.id=NEW.conversation_message_id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id AND m.conversation_id=c.id AND m.direction='inbound') OR NOT EXISTS(SELECT 1 FROM media_assets a JOIN whatsapp_inbound_media w ON w.media_asset_id=a.id WHERE a.id=NEW.media_asset_id AND a.workspace_id=NEW.workspace_id AND a.company_id=NEW.company_id AND w.conversation_message_id=NEW.conversation_message_id AND w.provider_kind='audio' AND w.state='associated') BEGIN SELECT RAISE(ABORT,'Conversation audio transcript scope is invalid'); END;
      CREATE TRIGGER conversation_audio_transcripts_no_update BEFORE UPDATE ON conversation_audio_transcripts BEGIN SELECT RAISE(ABORT,'Conversation audio transcripts are immutable'); END;
      CREATE TRIGGER conversation_audio_transcripts_no_delete BEFORE DELETE ON conversation_audio_transcripts BEGIN SELECT RAISE(ABORT,'Conversation audio transcripts are immutable'); END;

      CREATE TABLE audio_transcription_requests(
        id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,conversation_message_id TEXT NOT NULL UNIQUE REFERENCES conversation_messages(id) ON DELETE CASCADE,media_asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,state TEXT NOT NULL CHECK(state IN ('pending','leased','completed','retryable','failed','suppressed')),lease_owner TEXT,lease_expires_at TEXT,attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 20),expected_authority_generation INTEGER NOT NULL CHECK(expected_authority_generation>0),safe_outcome TEXT CHECK(safe_outcome IS NULL OR length(safe_outcome) BETWEEN 1 AND 100),safe_failure_category TEXT CHECK(safe_failure_category IS NULL OR length(safe_failure_category) BETWEEN 1 AND 100),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,
        FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,CHECK((lease_owner IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
      );
      CREATE INDEX idx_audio_transcription_requests_ready ON audio_transcription_requests(workspace_id,company_id,state,lease_expires_at,created_at,id);
      CREATE TRIGGER audio_transcription_requests_scope_insert BEFORE INSERT ON audio_transcription_requests WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id JOIN conversation_messages m ON m.id=NEW.conversation_message_id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id AND m.conversation_id=c.id AND m.direction='inbound') OR NOT EXISTS(SELECT 1 FROM media_assets a JOIN whatsapp_inbound_media w ON w.media_asset_id=a.id WHERE a.id=NEW.media_asset_id AND a.workspace_id=NEW.workspace_id AND a.company_id=NEW.company_id AND w.conversation_message_id=NEW.conversation_message_id AND w.provider_kind='audio' AND w.state='associated') BEGIN SELECT RAISE(ABORT,'Audio transcription request scope is invalid'); END;
      CREATE TRIGGER audio_transcription_requests_scope_update BEFORE UPDATE OF workspace_id,company_id,conversation_id,conversation_message_id,media_asset_id ON audio_transcription_requests WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id JOIN conversation_messages m ON m.id=NEW.conversation_message_id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id AND m.conversation_id=c.id AND m.direction='inbound') OR NOT EXISTS(SELECT 1 FROM media_assets a JOIN whatsapp_inbound_media w ON w.media_asset_id=a.id WHERE a.id=NEW.media_asset_id AND a.workspace_id=NEW.workspace_id AND a.company_id=NEW.company_id AND w.conversation_message_id=NEW.conversation_message_id AND w.provider_kind='audio' AND w.state='associated') BEGIN SELECT RAISE(ABORT,'Audio transcription request scope is invalid'); END;

      CREATE TABLE voice_synthesis_requests(
        id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,conversation_message_id TEXT NOT NULL UNIQUE REFERENCES conversation_messages(id) ON DELETE CASCADE,outbound_delivery_id TEXT NOT NULL UNIQUE REFERENCES outbound_deliveries(id) ON DELETE CASCADE,expected_authority_generation INTEGER NOT NULL CHECK(expected_authority_generation>0),state TEXT NOT NULL CHECK(state IN ('pending','leased','completed','retryable','failed','suppressed')),lease_owner TEXT,lease_expires_at TEXT,attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 20),safe_outcome TEXT CHECK(safe_outcome IS NULL OR length(safe_outcome) BETWEEN 1 AND 100),safe_failure_category TEXT CHECK(safe_failure_category IS NULL OR length(safe_failure_category) BETWEEN 1 AND 100),rendition_settlement_id TEXT UNIQUE CHECK(rendition_settlement_id IS NULL OR length(rendition_settlement_id) BETWEEN 1 AND 200),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,completed_at TEXT,
        FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,CHECK((lease_owner IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
      );
      CREATE INDEX idx_voice_synthesis_requests_ready ON voice_synthesis_requests(workspace_id,company_id,state,lease_expires_at,created_at,id);
      CREATE TRIGGER voice_synthesis_requests_scope_insert BEFORE INSERT ON voice_synthesis_requests WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id JOIN conversation_messages m ON m.id=NEW.conversation_message_id JOIN provider_message_records p ON p.conversation_message_id=m.id JOIN outbound_deliveries d ON d.provider_message_record_id=p.id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id AND m.conversation_id=c.id AND m.direction='outbound' AND d.id=NEW.outbound_delivery_id AND d.response_policy='deferred_voice') BEGIN SELECT RAISE(ABORT,'Voice synthesis request scope is invalid'); END;
      CREATE TRIGGER voice_synthesis_requests_scope_update BEFORE UPDATE OF workspace_id,company_id,conversation_id,conversation_message_id,outbound_delivery_id ON voice_synthesis_requests WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id JOIN conversation_messages m ON m.id=NEW.conversation_message_id JOIN provider_message_records p ON p.conversation_message_id=m.id JOIN outbound_deliveries d ON d.provider_message_record_id=p.id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id AND m.conversation_id=c.id AND m.direction='outbound' AND d.id=NEW.outbound_delivery_id AND d.response_policy='deferred_voice') BEGIN SELECT RAISE(ABORT,'Voice synthesis request scope is invalid'); END;

      CREATE TABLE whatsapp_outbound_media_uploads(
        id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,outbound_delivery_id TEXT NOT NULL UNIQUE REFERENCES outbound_deliveries(id) ON DELETE CASCADE,media_asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,provider_media_id TEXT CHECK(provider_media_id IS NULL OR length(provider_media_id) BETWEEN 1 AND 200),state TEXT NOT NULL CHECK(state IN ('pending_upload','uploading','uploaded','expired','failed')),lease_owner TEXT,lease_expires_at TEXT,attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 20),safe_error_category TEXT CHECK(safe_error_category IS NULL OR length(safe_error_category) BETWEEN 1 AND 100),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,CHECK((lease_owner IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
      );
      CREATE INDEX idx_whatsapp_outbound_media_uploads_recovery ON whatsapp_outbound_media_uploads(workspace_id,company_id,state,lease_expires_at,created_at,id);
      CREATE TRIGGER whatsapp_outbound_media_uploads_scope_insert BEFORE INSERT ON whatsapp_outbound_media_uploads WHEN NOT EXISTS(SELECT 1 FROM media_assets a WHERE a.id=NEW.media_asset_id AND a.workspace_id=NEW.workspace_id AND a.company_id=NEW.company_id AND a.kind='audio') OR NOT EXISTS(SELECT 1 FROM outbound_deliveries d JOIN provider_message_records p ON p.id=d.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id JOIN conversations c ON c.id=m.conversation_id JOIN companies co ON co.id=c.company_id WHERE d.id=NEW.outbound_delivery_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id AND d.media_asset_id=NEW.media_asset_id) BEGIN SELECT RAISE(ABORT,'WhatsApp outbound media upload scope is invalid'); END;
      CREATE TRIGGER whatsapp_outbound_media_uploads_scope_update BEFORE UPDATE OF workspace_id,company_id,outbound_delivery_id,media_asset_id ON whatsapp_outbound_media_uploads WHEN NOT EXISTS(SELECT 1 FROM media_assets a WHERE a.id=NEW.media_asset_id AND a.workspace_id=NEW.workspace_id AND a.company_id=NEW.company_id AND a.kind='audio') OR NOT EXISTS(SELECT 1 FROM outbound_deliveries d JOIN provider_message_records p ON p.id=d.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id JOIN conversations c ON c.id=m.conversation_id JOIN companies co ON co.id=c.company_id WHERE d.id=NEW.outbound_delivery_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id AND d.media_asset_id=NEW.media_asset_id) BEGIN SELECT RAISE(ABORT,'WhatsApp outbound media upload scope is invalid'); END;

      CREATE TABLE voice_response_visibility(
        workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,conversation_message_id TEXT NOT NULL UNIQUE REFERENCES conversation_messages(id) ON DELETE CASCADE,outbound_delivery_id TEXT NOT NULL UNIQUE REFERENCES outbound_deliveries(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind='externally_committed'),committed_at TEXT NOT NULL,created_at TEXT NOT NULL,
        FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE
      );
      CREATE INDEX idx_voice_response_visibility_conversation ON voice_response_visibility(workspace_id,company_id,conversation_id,committed_at,conversation_message_id);
      CREATE TRIGGER voice_response_visibility_scope_insert BEFORE INSERT ON voice_response_visibility WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id JOIN conversation_messages m ON m.id=NEW.conversation_message_id JOIN provider_message_records p ON p.conversation_message_id=m.id JOIN outbound_deliveries d ON d.provider_message_record_id=p.id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id AND m.conversation_id=c.id AND m.direction='outbound' AND d.id=NEW.outbound_delivery_id AND d.response_policy='deferred_voice' AND d.state='accepted' AND p.external_message_id IS NOT NULL) BEGIN SELECT RAISE(ABORT,'Voice response visibility scope is invalid'); END;
      CREATE TRIGGER voice_response_visibility_no_update BEFORE UPDATE ON voice_response_visibility BEGIN SELECT RAISE(ABORT,'Voice response visibility is append-only'); END;
      CREATE TRIGGER voice_response_visibility_no_delete BEFORE DELETE ON voice_response_visibility BEGIN SELECT RAISE(ABORT,'Voice response visibility is append-only'); END;
    `);
  }},
  { id:62,name:"0062_voice_read_events",checksumSource:"voice-read-projection-private-playback-metadata-only-terminal-events",apply(database):void{database.exec(`
    CREATE TRIGGER voice_read_event_transcript AFTER INSERT ON conversation_audio_transcripts
    WHEN NEW.outcome='completed'
    BEGIN INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,related_message_id,occurred_at) VALUES('cev_' || lower(hex(randomblob(16))),NEW.workspace_id,NEW.company_id,NEW.conversation_id,'voice_state_changed',NEW.conversation_message_id,NEW.created_at); END;
    CREATE TRIGGER voice_read_event_transcription_terminal AFTER UPDATE OF state ON audio_transcription_requests
    WHEN OLD.state!=NEW.state AND NEW.state IN ('failed','suppressed')
    BEGIN INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,related_message_id,occurred_at) VALUES('cev_' || lower(hex(randomblob(16))),NEW.workspace_id,NEW.company_id,NEW.conversation_id,'voice_state_changed',NEW.conversation_message_id,NEW.updated_at); END;
    CREATE TRIGGER voice_read_event_synthesis_terminal AFTER UPDATE OF state ON voice_synthesis_requests
    WHEN OLD.state!=NEW.state AND NEW.state IN ('completed','failed','suppressed')
    BEGIN INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,related_message_id,occurred_at) VALUES('cev_' || lower(hex(randomblob(16))),NEW.workspace_id,NEW.company_id,NEW.conversation_id,'voice_state_changed',NEW.conversation_message_id,NEW.updated_at); END;
    CREATE TRIGGER voice_read_event_upload_terminal AFTER UPDATE OF state ON whatsapp_outbound_media_uploads
    WHEN OLD.state!=NEW.state AND NEW.state IN ('uploaded','failed')
    BEGIN INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,related_message_id,occurred_at) SELECT 'cev_' || lower(hex(randomblob(16))),NEW.workspace_id,NEW.company_id,m.conversation_id,'voice_state_changed',m.id,NEW.updated_at FROM outbound_deliveries d JOIN provider_message_records p ON p.id=d.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id WHERE d.id=NEW.outbound_delivery_id; END;
    CREATE TRIGGER voice_read_event_delivery_visible AFTER UPDATE OF state ON outbound_deliveries
    WHEN OLD.state!=NEW.state AND NEW.response_policy='deferred_voice' AND NEW.state IN ('accepted','delivered','read')
    BEGIN INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,related_message_id,occurred_at) SELECT 'cev_' || lower(hex(randomblob(16))),co.workspace_id,co.id,m.conversation_id,'voice_state_changed',m.id,NEW.updated_at FROM provider_message_records p JOIN conversation_messages m ON m.id=p.conversation_message_id JOIN conversations c ON c.id=m.conversation_id JOIN companies co ON co.id=c.company_id WHERE p.id=NEW.provider_message_record_id; END;
    `);}},
  { id:63,name:"0063_proactive_actions",checksumSource:"company-proactive-policy-action-replay-audit-visibility|whatsapp-bound-follow-up|additive-outbound-link-preserves-rowid|teardown-aware-append-only-v1",apply(database):void{database.exec(`
    CREATE TABLE proactive_action_policies(
      company_id INTEGER PRIMARY KEY,workspace_id INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE
    );
    INSERT INTO proactive_action_policies(company_id,workspace_id,created_at,updated_at) SELECT id,workspace_id,created_at,created_at FROM companies;
    CREATE TRIGGER companies_seed_proactive_action_policy AFTER INSERT ON companies BEGIN INSERT INTO proactive_action_policies(company_id,workspace_id,created_at,updated_at) VALUES(NEW.id,NEW.workspace_id,NEW.created_at,NEW.created_at); END;
    CREATE TRIGGER proactive_action_policies_scope_insert BEFORE INSERT ON proactive_action_policies WHEN NOT EXISTS(SELECT 1 FROM companies c WHERE c.id=NEW.company_id AND c.workspace_id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'Proactive action policy scope is invalid'); END;
    CREATE TRIGGER proactive_action_policies_scope_update BEFORE UPDATE OF company_id,workspace_id ON proactive_action_policies WHEN NOT EXISTS(SELECT 1 FROM companies c WHERE c.id=NEW.company_id AND c.workspace_id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'Proactive action policy scope is invalid'); END;

    CREATE TABLE proactive_actions(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,whatsapp_connection_id TEXT NOT NULL REFERENCES whatsapp_connections(id) ON DELETE RESTRICT,assistant_profile_id TEXT NOT NULL REFERENCES assistant_profiles(id) ON DELETE RESTRICT,assistant_participant_id TEXT NOT NULL REFERENCES conversation_participants(id) ON DELETE RESTRICT,
      intent_kind TEXT NOT NULL CHECK(intent_kind='follow_up'),run_at TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('scheduled','ready','leased','retryable','awaiting_outbound','succeeded','cancelled','suppressed','permanent_failure','uncertain')),expected_authority_generation INTEGER NOT NULL CHECK(expected_authority_generation>0),attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),next_attempt_at TEXT NOT NULL,
      lease_owner TEXT,lease_token TEXT,lease_acquired_at TEXT,lease_expires_at TEXT,safe_reason_code TEXT CHECK(safe_reason_code IS NULL OR length(safe_reason_code) BETWEEN 1 AND 100),assistant_execution_record_id TEXT REFERENCES assistant_execution_records(id) ON DELETE RESTRICT,outbound_message_id TEXT UNIQUE REFERENCES conversation_messages(id) ON DELETE RESTRICT,outbound_delivery_id TEXT UNIQUE REFERENCES outbound_deliveries(id) ON DELETE RESTRICT,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),completed_at TEXT,cancelled_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,teardown_authorized INTEGER NOT NULL DEFAULT 0 CHECK(teardown_authorized IN (0,1)),
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      CHECK((lease_owner IS NULL AND lease_token IS NULL AND lease_acquired_at IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_acquired_at IS NOT NULL AND lease_expires_at IS NOT NULL)),
      CHECK((state='leased')=(lease_owner IS NOT NULL)),
      CHECK(state NOT IN ('awaiting_outbound','succeeded','uncertain') OR (assistant_execution_record_id IS NOT NULL AND outbound_message_id IS NOT NULL AND outbound_delivery_id IS NOT NULL)),
      CHECK((state IN ('succeeded','cancelled','suppressed','permanent_failure','uncertain'))=(completed_at IS NOT NULL)),
      CHECK((state='cancelled')=(cancelled_at IS NOT NULL))
    );
    CREATE INDEX idx_proactive_actions_due ON proactive_actions(state,run_at,next_attempt_at,id);
    CREATE INDEX idx_proactive_actions_lease ON proactive_actions(state,lease_expires_at,id);
    CREATE INDEX idx_proactive_actions_conversation ON proactive_actions(workspace_id,company_id,conversation_id,run_at DESC,id DESC);
    CREATE TRIGGER proactive_actions_scope_insert BEFORE INSERT ON proactive_actions WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id JOIN whatsapp_connections wc ON wc.id=NEW.whatsapp_connection_id JOIN assistant_profiles ap ON ap.id=NEW.assistant_profile_id JOIN conversation_participants cp ON cp.id=NEW.assistant_participant_id JOIN whatsapp_conversation_bindings b ON b.whatsapp_connection_id=wc.id AND b.conversation_id=c.id AND b.assistant_participant_id=cp.id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id AND wc.workspace_id=NEW.workspace_id AND wc.company_id=NEW.company_id AND wc.assistant_profile_id=NEW.assistant_profile_id AND ap.company_id=NEW.company_id AND cp.conversation_id=c.id) OR (NEW.assistant_execution_record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assistant_execution_records e WHERE e.id=NEW.assistant_execution_record_id AND e.company_id=NEW.company_id)) OR (NEW.outbound_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_messages m WHERE m.id=NEW.outbound_message_id AND m.conversation_id=NEW.conversation_id AND m.sender_participant_id=NEW.assistant_participant_id AND m.direction='outbound')) OR (NEW.outbound_delivery_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM outbound_deliveries d JOIN provider_message_records p ON p.id=d.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id WHERE d.id=NEW.outbound_delivery_id AND p.transport_connection_id=NEW.whatsapp_connection_id AND d.transport_connection_id=NEW.whatsapp_connection_id AND m.id=NEW.outbound_message_id AND m.conversation_id=NEW.conversation_id AND d.expected_authority_generation=NEW.expected_authority_generation)) BEGIN SELECT RAISE(ABORT,'Proactive action scope is invalid'); END;
    CREATE TRIGGER proactive_actions_scope_update BEFORE UPDATE OF workspace_id,company_id,conversation_id,whatsapp_connection_id,assistant_profile_id,assistant_participant_id,assistant_execution_record_id,outbound_message_id,outbound_delivery_id,expected_authority_generation ON proactive_actions WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id JOIN whatsapp_connections wc ON wc.id=NEW.whatsapp_connection_id JOIN assistant_profiles ap ON ap.id=NEW.assistant_profile_id JOIN conversation_participants cp ON cp.id=NEW.assistant_participant_id JOIN whatsapp_conversation_bindings b ON b.whatsapp_connection_id=wc.id AND b.conversation_id=c.id AND b.assistant_participant_id=cp.id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id AND wc.workspace_id=NEW.workspace_id AND wc.company_id=NEW.company_id AND wc.assistant_profile_id=NEW.assistant_profile_id AND ap.company_id=NEW.company_id AND cp.conversation_id=c.id) OR (NEW.assistant_execution_record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assistant_execution_records e WHERE e.id=NEW.assistant_execution_record_id AND e.company_id=NEW.company_id)) OR (NEW.outbound_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_messages m WHERE m.id=NEW.outbound_message_id AND m.conversation_id=NEW.conversation_id AND m.sender_participant_id=NEW.assistant_participant_id AND m.direction='outbound')) OR (NEW.outbound_delivery_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM outbound_deliveries d JOIN provider_message_records p ON p.id=d.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id WHERE d.id=NEW.outbound_delivery_id AND p.transport_connection_id=NEW.whatsapp_connection_id AND d.transport_connection_id=NEW.whatsapp_connection_id AND m.id=NEW.outbound_message_id AND m.conversation_id=NEW.conversation_id AND d.expected_authority_generation=NEW.expected_authority_generation)) BEGIN SELECT RAISE(ABORT,'Proactive action scope is invalid'); END;
    CREATE TRIGGER proactive_actions_no_delete BEFORE DELETE ON proactive_actions WHEN OLD.teardown_authorized=0 BEGIN SELECT RAISE(ABORT,'Proactive actions require Company teardown'); END;

    CREATE TABLE proactive_action_operations(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,proactive_action_id TEXT REFERENCES proactive_actions(id) ON DELETE CASCADE,operation TEXT NOT NULL CHECK(operation IN ('policy_update','create','cancel')),operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 200),request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'),outcome TEXT NOT NULL CHECK(outcome IN ('applied','stale_version','cancel_after_send_started')),actor_user_id TEXT NOT NULL CHECK(length(actor_user_id) BETWEEN 1 AND 128),resulting_policy_enabled INTEGER CHECK(resulting_policy_enabled IS NULL OR resulting_policy_enabled IN (0,1)),resulting_policy_version INTEGER CHECK(resulting_policy_version IS NULL OR resulting_policy_version>0),resulting_action_state TEXT CHECK(resulting_action_state IS NULL OR resulting_action_state IN ('scheduled','ready','leased','retryable','awaiting_outbound','succeeded','cancelled','suppressed','permanent_failure','uncertain')),resulting_action_version INTEGER CHECK(resulting_action_version IS NULL OR resulting_action_version>0),occurred_at TEXT NOT NULL,teardown_authorized INTEGER NOT NULL DEFAULT 0 CHECK(teardown_authorized IN (0,1)),
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      UNIQUE(workspace_id,company_id,operation,operation_id),
      CHECK((operation='policy_update')=(proactive_action_id IS NULL)),
      CHECK((operation='policy_update')=(resulting_policy_version IS NOT NULL)),
      CHECK((operation!='policy_update')=(resulting_action_version IS NOT NULL))
    );
    CREATE INDEX idx_proactive_action_operations_action ON proactive_action_operations(workspace_id,company_id,proactive_action_id,occurred_at,id);
    CREATE TRIGGER proactive_action_operations_scope_insert BEFORE INSERT ON proactive_action_operations WHEN NOT EXISTS(SELECT 1 FROM companies c WHERE c.id=NEW.company_id AND c.workspace_id=NEW.workspace_id) OR (NEW.proactive_action_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM proactive_actions a WHERE a.id=NEW.proactive_action_id AND a.workspace_id=NEW.workspace_id AND a.company_id=NEW.company_id)) BEGIN SELECT RAISE(ABORT,'Proactive action operation scope is invalid'); END;
    CREATE TRIGGER proactive_action_operations_no_update BEFORE UPDATE OF id,workspace_id,company_id,proactive_action_id,operation,operation_id,request_fingerprint,outcome,actor_user_id,resulting_policy_enabled,resulting_policy_version,resulting_action_state,resulting_action_version,occurred_at ON proactive_action_operations BEGIN SELECT RAISE(ABORT,'Proactive action operations are append-only'); END;
    CREATE TRIGGER proactive_action_operations_no_delete BEFORE DELETE ON proactive_action_operations WHEN OLD.teardown_authorized=0 BEGIN SELECT RAISE(ABORT,'Proactive action operations are append-only'); END;

    CREATE TABLE proactive_action_audit_events(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,proactive_action_id TEXT NOT NULL REFERENCES proactive_actions(id) ON DELETE CASCADE,event_type TEXT NOT NULL CHECK(event_type IN ('created','cancelled','claimed','retry_scheduled','suppressed','runtime_failed','outbound_reserved','outbound_accepted','outbound_uncertain','completed')),safe_reason_code TEXT CHECK(safe_reason_code IS NULL OR length(safe_reason_code) BETWEEN 1 AND 100),actor_user_id TEXT CHECK(actor_user_id IS NULL OR length(actor_user_id) BETWEEN 1 AND 128),correlation_id TEXT CHECK(correlation_id IS NULL OR length(correlation_id) BETWEEN 1 AND 200),occurred_at TEXT NOT NULL,teardown_authorized INTEGER NOT NULL DEFAULT 0 CHECK(teardown_authorized IN (0,1)),
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE
    );
    CREATE INDEX idx_proactive_action_audit_events_action ON proactive_action_audit_events(workspace_id,company_id,proactive_action_id,occurred_at,id);
    CREATE TRIGGER proactive_action_audit_events_scope_insert BEFORE INSERT ON proactive_action_audit_events WHEN NOT EXISTS(SELECT 1 FROM proactive_actions a WHERE a.id=NEW.proactive_action_id AND a.workspace_id=NEW.workspace_id AND a.company_id=NEW.company_id) BEGIN SELECT RAISE(ABORT,'Proactive action audit scope is invalid'); END;
    CREATE TRIGGER proactive_action_audit_events_no_update BEFORE UPDATE OF id,workspace_id,company_id,proactive_action_id,event_type,safe_reason_code,actor_user_id,correlation_id,occurred_at ON proactive_action_audit_events BEGIN SELECT RAISE(ABORT,'Proactive action audit events are append-only'); END;
    CREATE TRIGGER proactive_action_audit_events_no_delete BEFORE DELETE ON proactive_action_audit_events WHEN OLD.teardown_authorized=0 BEGIN SELECT RAISE(ABORT,'Proactive action audit events are append-only'); END;

    ALTER TABLE outbound_deliveries ADD COLUMN proactive_action_id TEXT REFERENCES proactive_actions(id) ON DELETE RESTRICT;
    CREATE UNIQUE INDEX uq_outbound_deliveries_proactive_action ON outbound_deliveries(proactive_action_id) WHERE proactive_action_id IS NOT NULL;
    CREATE TRIGGER outbound_deliveries_proactive_scope_insert BEFORE INSERT ON outbound_deliveries WHEN NEW.proactive_action_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM proactive_actions a JOIN provider_message_records p ON p.id=NEW.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id WHERE a.id=NEW.proactive_action_id AND a.whatsapp_connection_id=NEW.transport_connection_id AND p.transport_connection_id=NEW.transport_connection_id AND m.conversation_id=a.conversation_id AND (a.outbound_message_id IS NULL OR a.outbound_message_id=m.id) AND (a.outbound_delivery_id IS NULL OR a.outbound_delivery_id=NEW.id) AND NEW.expected_authority_generation=a.expected_authority_generation) BEGIN SELECT RAISE(ABORT,'Proactive outbound delivery scope is invalid'); END;
    CREATE TRIGGER outbound_deliveries_proactive_scope_update BEFORE UPDATE OF proactive_action_id,provider_message_record_id,transport_connection_id,expected_authority_generation ON outbound_deliveries WHEN NEW.proactive_action_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM proactive_actions a JOIN provider_message_records p ON p.id=NEW.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id WHERE a.id=NEW.proactive_action_id AND a.whatsapp_connection_id=NEW.transport_connection_id AND p.transport_connection_id=NEW.transport_connection_id AND m.conversation_id=a.conversation_id AND (a.outbound_message_id IS NULL OR a.outbound_message_id=m.id) AND (a.outbound_delivery_id IS NULL OR a.outbound_delivery_id=NEW.id) AND NEW.expected_authority_generation=a.expected_authority_generation) BEGIN SELECT RAISE(ABORT,'Proactive outbound delivery scope is invalid'); END;

    CREATE TABLE proactive_action_visibility(
      proactive_action_id TEXT PRIMARY KEY REFERENCES proactive_actions(id) ON DELETE CASCADE,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,conversation_message_id TEXT NOT NULL UNIQUE REFERENCES conversation_messages(id) ON DELETE RESTRICT,outbound_delivery_id TEXT NOT NULL UNIQUE REFERENCES outbound_deliveries(id) ON DELETE RESTRICT,kind TEXT NOT NULL CHECK(kind='externally_committed'),committed_at TEXT NOT NULL,created_at TEXT NOT NULL,teardown_authorized INTEGER NOT NULL DEFAULT 0 CHECK(teardown_authorized IN (0,1)),
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE
    );
    CREATE INDEX idx_proactive_action_visibility_conversation ON proactive_action_visibility(workspace_id,company_id,conversation_id,committed_at,conversation_message_id);
    CREATE TRIGGER proactive_action_visibility_scope_insert BEFORE INSERT ON proactive_action_visibility WHEN NOT EXISTS(SELECT 1 FROM proactive_actions a JOIN outbound_deliveries d ON d.id=NEW.outbound_delivery_id JOIN provider_message_records p ON p.id=d.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id WHERE a.id=NEW.proactive_action_id AND a.workspace_id=NEW.workspace_id AND a.company_id=NEW.company_id AND a.conversation_id=NEW.conversation_id AND a.outbound_message_id=NEW.conversation_message_id AND a.outbound_delivery_id=NEW.outbound_delivery_id AND d.proactive_action_id=a.id AND d.state='accepted' AND p.external_message_id IS NOT NULL AND m.id=NEW.conversation_message_id AND m.conversation_id=NEW.conversation_id) BEGIN SELECT RAISE(ABORT,'Proactive action visibility scope is invalid'); END;
    CREATE TRIGGER proactive_action_visibility_no_update BEFORE UPDATE OF proactive_action_id,workspace_id,company_id,conversation_id,conversation_message_id,outbound_delivery_id,kind,committed_at,created_at ON proactive_action_visibility BEGIN SELECT RAISE(ABORT,'Proactive action visibility is append-only'); END;
    CREATE TRIGGER proactive_action_visibility_no_delete BEFORE DELETE ON proactive_action_visibility WHEN OLD.teardown_authorized=0 BEGIN SELECT RAISE(ABORT,'Proactive action visibility is append-only'); END;

    CREATE TRIGGER companies_authorize_proactive_action_teardown BEFORE DELETE ON companies BEGIN
      UPDATE proactive_actions SET teardown_authorized=1 WHERE company_id=OLD.id;
      UPDATE proactive_action_operations SET teardown_authorized=1 WHERE company_id=OLD.id;
      UPDATE proactive_action_audit_events SET teardown_authorized=1 WHERE company_id=OLD.id;
      UPDATE proactive_action_visibility SET teardown_authorized=1 WHERE company_id=OLD.id;
    END;
  `);}},
  { id:64,name:"0064_proactive_runtime_boundary",checksumSource:"proactive-execution-purpose|chosen-execution-single-source|runtime-completed-state|preserve-execution-history-v1",disableForeignKeys:true,apply(database):void{database.exec(`
    DROP TRIGGER proactive_actions_scope_insert;
    DROP TRIGGER proactive_actions_scope_update;
    DROP TRIGGER proactive_actions_no_delete;
    DROP TRIGGER proactive_action_operations_scope_insert;
    DROP TRIGGER proactive_action_audit_events_scope_insert;
    DROP TRIGGER proactive_action_visibility_scope_insert;
    DROP TRIGGER companies_authorize_proactive_action_teardown;
    DROP TRIGGER outbound_deliveries_proactive_scope_insert;
    DROP TRIGGER outbound_deliveries_proactive_scope_update;

    CREATE TABLE assistant_execution_records_v64(
      id TEXT PRIMARY KEY,company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,assistant_profile_id TEXT NOT NULL REFERENCES assistant_profiles(id) ON DELETE CASCADE,profile_snapshot_json TEXT NOT NULL,knowledge_version_id TEXT NOT NULL REFERENCES company_knowledge_versions(id) ON DELETE CASCADE,provider TEXT NOT NULL,purpose TEXT NOT NULL CHECK(purpose IN ('preview','operational_execution','proactive_execution')),state TEXT NOT NULL CHECK(state IN ('started','answered','safe_fallback','failed')),fallback_used INTEGER NOT NULL CHECK(fallback_used IN (0,1)),result TEXT,input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens>=0),output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens>=0),error_code TEXT,started_at TEXT NOT NULL,completed_at TEXT,duration_milliseconds INTEGER,execution_snapshot_json TEXT,
      CHECK((state='started' AND completed_at IS NULL AND duration_milliseconds IS NULL AND result IS NULL AND error_code IS NULL) OR (state IN ('answered','safe_fallback') AND completed_at IS NOT NULL AND duration_milliseconds>=0 AND result IS NOT NULL AND error_code IS NULL) OR (state='failed' AND completed_at IS NOT NULL AND duration_milliseconds>=0 AND result IS NULL AND error_code IS NOT NULL))
    );
    INSERT INTO assistant_execution_records_v64(id,company_id,assistant_profile_id,profile_snapshot_json,knowledge_version_id,provider,purpose,state,fallback_used,result,input_tokens,output_tokens,error_code,started_at,completed_at,duration_milliseconds,execution_snapshot_json) SELECT id,company_id,assistant_profile_id,profile_snapshot_json,knowledge_version_id,provider,purpose,state,fallback_used,result,input_tokens,output_tokens,error_code,started_at,completed_at,duration_milliseconds,execution_snapshot_json FROM assistant_execution_records;
    DROP TABLE assistant_execution_records;
    ALTER TABLE assistant_execution_records_v64 RENAME TO assistant_execution_records;
    CREATE INDEX idx_assistant_execution_records_company_started ON assistant_execution_records(company_id,started_at DESC,id DESC);
    CREATE INDEX idx_assistant_execution_records_profile_started ON assistant_execution_records(assistant_profile_id,started_at DESC,id DESC);
    CREATE UNIQUE INDEX ux_assistant_execution_records_scope ON assistant_execution_records(id,company_id,assistant_profile_id);

    CREATE TABLE proactive_actions_v64(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,whatsapp_connection_id TEXT NOT NULL REFERENCES whatsapp_connections(id) ON DELETE RESTRICT,assistant_profile_id TEXT NOT NULL REFERENCES assistant_profiles(id) ON DELETE RESTRICT,assistant_participant_id TEXT NOT NULL REFERENCES conversation_participants(id) ON DELETE RESTRICT,intent_kind TEXT NOT NULL CHECK(intent_kind='follow_up'),run_at TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('scheduled','ready','leased','retryable','runtime_completed','awaiting_outbound','succeeded','cancelled','suppressed','permanent_failure','uncertain')),expected_authority_generation INTEGER NOT NULL CHECK(expected_authority_generation>0),attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),next_attempt_at TEXT NOT NULL,lease_owner TEXT,lease_token TEXT,lease_acquired_at TEXT,lease_expires_at TEXT,safe_reason_code TEXT CHECK(safe_reason_code IS NULL OR length(safe_reason_code) BETWEEN 1 AND 100),assistant_execution_record_id TEXT REFERENCES assistant_execution_records(id) ON DELETE RESTRICT,outbound_message_id TEXT UNIQUE REFERENCES conversation_messages(id) ON DELETE RESTRICT,outbound_delivery_id TEXT UNIQUE REFERENCES outbound_deliveries(id) ON DELETE RESTRICT,version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),completed_at TEXT,cancelled_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,teardown_authorized INTEGER NOT NULL DEFAULT 0 CHECK(teardown_authorized IN (0,1)),
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      CHECK((lease_owner IS NULL AND lease_token IS NULL AND lease_acquired_at IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_acquired_at IS NOT NULL AND lease_expires_at IS NOT NULL)),CHECK((state='leased')=(lease_owner IS NOT NULL)),CHECK(state NOT IN ('awaiting_outbound','succeeded','uncertain') OR (assistant_execution_record_id IS NOT NULL AND outbound_message_id IS NOT NULL AND outbound_delivery_id IS NOT NULL)),CHECK(state!='runtime_completed' OR (assistant_execution_record_id IS NOT NULL AND outbound_message_id IS NULL AND outbound_delivery_id IS NULL)),CHECK((state IN ('succeeded','cancelled','suppressed','permanent_failure','uncertain'))=(completed_at IS NOT NULL)),CHECK((state='cancelled')=(cancelled_at IS NOT NULL))
    );
    INSERT INTO proactive_actions_v64 SELECT * FROM proactive_actions;
    DROP TABLE proactive_actions;
    ALTER TABLE proactive_actions_v64 RENAME TO proactive_actions;
    CREATE INDEX idx_proactive_actions_due ON proactive_actions(state,run_at,next_attempt_at,id);
    CREATE INDEX idx_proactive_actions_lease ON proactive_actions(state,lease_expires_at,id);
    CREATE INDEX idx_proactive_actions_conversation ON proactive_actions(workspace_id,company_id,conversation_id,run_at DESC,id DESC);
    CREATE UNIQUE INDEX uq_proactive_actions_selected_execution ON proactive_actions(assistant_execution_record_id) WHERE assistant_execution_record_id IS NOT NULL;
    CREATE TRIGGER proactive_actions_selected_execution_immutable BEFORE UPDATE OF assistant_execution_record_id ON proactive_actions WHEN OLD.assistant_execution_record_id IS NOT NULL AND NEW.assistant_execution_record_id IS NOT OLD.assistant_execution_record_id BEGIN SELECT RAISE(ABORT,'Proactive selected execution is immutable'); END;
    CREATE TRIGGER proactive_actions_runtime_completed_transition BEFORE UPDATE OF state ON proactive_actions WHEN OLD.state='runtime_completed' AND NEW.state!=OLD.state AND NEW.state NOT IN ('awaiting_outbound','cancelled','suppressed','permanent_failure') BEGIN SELECT RAISE(ABORT,'Proactive runtime-completed action cannot return to inference'); END;
    CREATE TRIGGER proactive_actions_scope_insert BEFORE INSERT ON proactive_actions WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id JOIN whatsapp_connections wc ON wc.id=NEW.whatsapp_connection_id JOIN assistant_profiles ap ON ap.id=NEW.assistant_profile_id JOIN conversation_participants cp ON cp.id=NEW.assistant_participant_id JOIN whatsapp_conversation_bindings b ON b.whatsapp_connection_id=wc.id AND b.conversation_id=c.id AND b.assistant_participant_id=cp.id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id AND wc.workspace_id=NEW.workspace_id AND wc.company_id=NEW.company_id AND wc.assistant_profile_id=NEW.assistant_profile_id AND ap.company_id=NEW.company_id AND cp.conversation_id=c.id) OR (NEW.assistant_execution_record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assistant_execution_records e WHERE e.id=NEW.assistant_execution_record_id AND e.company_id=NEW.company_id AND e.assistant_profile_id=NEW.assistant_profile_id AND e.purpose='proactive_execution' AND e.state IN ('answered','safe_fallback') AND e.result IS NOT NULL AND json_valid(e.execution_snapshot_json) AND json_extract(e.execution_snapshot_json,'$.version')='execution-snapshot-v2' AND json_extract(e.execution_snapshot_json,'$.workspaceId')=NEW.workspace_id AND json_extract(e.execution_snapshot_json,'$.companyId')=NEW.company_id AND json_extract(e.execution_snapshot_json,'$.assistantProfileId')=NEW.assistant_profile_id AND json_extract(e.execution_snapshot_json,'$.conversationId')=NEW.conversation_id AND json_extract(e.execution_snapshot_json,'$.whatsAppConnectionId')=NEW.whatsapp_connection_id AND json_extract(e.execution_snapshot_json,'$.authorityGeneration')=NEW.expected_authority_generation AND json_extract(e.execution_snapshot_json,'$.proactiveActionId')=NEW.id)) OR (NEW.outbound_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_messages m WHERE m.id=NEW.outbound_message_id AND m.conversation_id=NEW.conversation_id AND m.sender_participant_id=NEW.assistant_participant_id AND m.direction='outbound')) OR (NEW.outbound_delivery_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM outbound_deliveries d JOIN provider_message_records p ON p.id=d.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id WHERE d.id=NEW.outbound_delivery_id AND p.transport_connection_id=NEW.whatsapp_connection_id AND d.transport_connection_id=NEW.whatsapp_connection_id AND m.id=NEW.outbound_message_id AND m.conversation_id=NEW.conversation_id AND d.expected_authority_generation=NEW.expected_authority_generation)) BEGIN SELECT RAISE(ABORT,'Proactive action scope is invalid'); END;
    CREATE TRIGGER proactive_actions_scope_update BEFORE UPDATE OF workspace_id,company_id,conversation_id,whatsapp_connection_id,assistant_profile_id,assistant_participant_id,assistant_execution_record_id,outbound_message_id,outbound_delivery_id,expected_authority_generation ON proactive_actions WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id JOIN whatsapp_connections wc ON wc.id=NEW.whatsapp_connection_id JOIN assistant_profiles ap ON ap.id=NEW.assistant_profile_id JOIN conversation_participants cp ON cp.id=NEW.assistant_participant_id JOIN whatsapp_conversation_bindings b ON b.whatsapp_connection_id=wc.id AND b.conversation_id=c.id AND b.assistant_participant_id=cp.id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id AND wc.workspace_id=NEW.workspace_id AND wc.company_id=NEW.company_id AND wc.assistant_profile_id=NEW.assistant_profile_id AND ap.company_id=NEW.company_id AND cp.conversation_id=c.id) OR (NEW.assistant_execution_record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assistant_execution_records e WHERE e.id=NEW.assistant_execution_record_id AND e.company_id=NEW.company_id AND e.assistant_profile_id=NEW.assistant_profile_id AND e.purpose='proactive_execution' AND e.state IN ('answered','safe_fallback') AND e.result IS NOT NULL AND json_valid(e.execution_snapshot_json) AND json_extract(e.execution_snapshot_json,'$.version')='execution-snapshot-v2' AND json_extract(e.execution_snapshot_json,'$.workspaceId')=NEW.workspace_id AND json_extract(e.execution_snapshot_json,'$.companyId')=NEW.company_id AND json_extract(e.execution_snapshot_json,'$.assistantProfileId')=NEW.assistant_profile_id AND json_extract(e.execution_snapshot_json,'$.conversationId')=NEW.conversation_id AND json_extract(e.execution_snapshot_json,'$.whatsAppConnectionId')=NEW.whatsapp_connection_id AND json_extract(e.execution_snapshot_json,'$.authorityGeneration')=NEW.expected_authority_generation AND json_extract(e.execution_snapshot_json,'$.proactiveActionId')=NEW.id)) OR (NEW.outbound_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_messages m WHERE m.id=NEW.outbound_message_id AND m.conversation_id=NEW.conversation_id AND m.sender_participant_id=NEW.assistant_participant_id AND m.direction='outbound')) OR (NEW.outbound_delivery_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM outbound_deliveries d JOIN provider_message_records p ON p.id=d.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id WHERE d.id=NEW.outbound_delivery_id AND p.transport_connection_id=NEW.whatsapp_connection_id AND d.transport_connection_id=NEW.whatsapp_connection_id AND m.id=NEW.outbound_message_id AND m.conversation_id=NEW.conversation_id AND d.expected_authority_generation=NEW.expected_authority_generation)) BEGIN SELECT RAISE(ABORT,'Proactive action scope is invalid'); END;
    CREATE TRIGGER proactive_actions_no_delete BEFORE DELETE ON proactive_actions WHEN OLD.teardown_authorized=0 BEGIN SELECT RAISE(ABORT,'Proactive actions require Company teardown'); END;
    CREATE TRIGGER proactive_action_operations_scope_insert BEFORE INSERT ON proactive_action_operations WHEN NOT EXISTS(SELECT 1 FROM companies c WHERE c.id=NEW.company_id AND c.workspace_id=NEW.workspace_id) OR (NEW.proactive_action_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM proactive_actions a WHERE a.id=NEW.proactive_action_id AND a.workspace_id=NEW.workspace_id AND a.company_id=NEW.company_id)) BEGIN SELECT RAISE(ABORT,'Proactive action operation scope is invalid'); END;
    CREATE TRIGGER proactive_action_audit_events_scope_insert BEFORE INSERT ON proactive_action_audit_events WHEN NOT EXISTS(SELECT 1 FROM proactive_actions a WHERE a.id=NEW.proactive_action_id AND a.workspace_id=NEW.workspace_id AND a.company_id=NEW.company_id) BEGIN SELECT RAISE(ABORT,'Proactive action audit scope is invalid'); END;
    CREATE TRIGGER proactive_action_visibility_scope_insert BEFORE INSERT ON proactive_action_visibility WHEN NOT EXISTS(SELECT 1 FROM proactive_actions a JOIN outbound_deliveries d ON d.id=NEW.outbound_delivery_id JOIN provider_message_records p ON p.id=d.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id WHERE a.id=NEW.proactive_action_id AND a.workspace_id=NEW.workspace_id AND a.company_id=NEW.company_id AND a.conversation_id=NEW.conversation_id AND a.outbound_message_id=NEW.conversation_message_id AND a.outbound_delivery_id=NEW.outbound_delivery_id AND d.proactive_action_id=a.id AND d.state='accepted' AND p.external_message_id IS NOT NULL AND m.id=NEW.conversation_message_id AND m.conversation_id=NEW.conversation_id) BEGIN SELECT RAISE(ABORT,'Proactive action visibility scope is invalid'); END;
    CREATE TRIGGER outbound_deliveries_proactive_scope_insert BEFORE INSERT ON outbound_deliveries WHEN NEW.proactive_action_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM proactive_actions a JOIN provider_message_records p ON p.id=NEW.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id WHERE a.id=NEW.proactive_action_id AND a.whatsapp_connection_id=NEW.transport_connection_id AND p.transport_connection_id=NEW.transport_connection_id AND m.conversation_id=a.conversation_id AND (a.outbound_message_id IS NULL OR a.outbound_message_id=m.id) AND (a.outbound_delivery_id IS NULL OR a.outbound_delivery_id=NEW.id) AND NEW.expected_authority_generation=a.expected_authority_generation) BEGIN SELECT RAISE(ABORT,'Proactive outbound delivery scope is invalid'); END;
    CREATE TRIGGER outbound_deliveries_proactive_scope_update BEFORE UPDATE OF proactive_action_id,provider_message_record_id,transport_connection_id,expected_authority_generation ON outbound_deliveries WHEN NEW.proactive_action_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM proactive_actions a JOIN provider_message_records p ON p.id=NEW.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id WHERE a.id=NEW.proactive_action_id AND a.whatsapp_connection_id=NEW.transport_connection_id AND p.transport_connection_id=NEW.transport_connection_id AND m.conversation_id=a.conversation_id AND (a.outbound_message_id IS NULL OR a.outbound_message_id=m.id) AND (a.outbound_delivery_id IS NULL OR a.outbound_delivery_id=NEW.id) AND NEW.expected_authority_generation=a.expected_authority_generation) BEGIN SELECT RAISE(ABORT,'Proactive outbound delivery scope is invalid'); END;
    CREATE TRIGGER companies_authorize_proactive_action_teardown BEFORE DELETE ON companies BEGIN UPDATE proactive_actions SET teardown_authorized=1 WHERE company_id=OLD.id; UPDATE proactive_action_operations SET teardown_authorized=1 WHERE company_id=OLD.id; UPDATE proactive_action_audit_events SET teardown_authorized=1 WHERE company_id=OLD.id; UPDATE proactive_action_visibility SET teardown_authorized=1 WHERE company_id=OLD.id; END;
  `);}},
  { id:65,name:"0065_proactive_operation_state_compatibility",checksumSource:"proactive-operation-ledger-runtime-completed-state|preserve-append-only-replay-v1",apply(database):void{database.exec(`
    DROP TRIGGER proactive_action_operations_scope_insert;
    DROP TRIGGER proactive_action_operations_no_update;
    DROP TRIGGER proactive_action_operations_no_delete;
    DROP TRIGGER companies_authorize_proactive_action_teardown;
    CREATE TABLE proactive_action_operations_v65(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,proactive_action_id TEXT REFERENCES proactive_actions(id) ON DELETE CASCADE,operation TEXT NOT NULL CHECK(operation IN ('policy_update','create','cancel')),operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 200),request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'),outcome TEXT NOT NULL CHECK(outcome IN ('applied','stale_version','cancel_after_send_started')),actor_user_id TEXT NOT NULL CHECK(length(actor_user_id) BETWEEN 1 AND 128),resulting_policy_enabled INTEGER CHECK(resulting_policy_enabled IS NULL OR resulting_policy_enabled IN (0,1)),resulting_policy_version INTEGER CHECK(resulting_policy_version IS NULL OR resulting_policy_version>0),resulting_action_state TEXT CHECK(resulting_action_state IS NULL OR resulting_action_state IN ('scheduled','ready','leased','retryable','runtime_completed','awaiting_outbound','succeeded','cancelled','suppressed','permanent_failure','uncertain')),resulting_action_version INTEGER CHECK(resulting_action_version IS NULL OR resulting_action_version>0),occurred_at TEXT NOT NULL,teardown_authorized INTEGER NOT NULL DEFAULT 0 CHECK(teardown_authorized IN (0,1)),
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      UNIQUE(workspace_id,company_id,operation,operation_id),
      CHECK((operation='policy_update')=(proactive_action_id IS NULL)),
      CHECK((operation='policy_update')=(resulting_policy_enabled IS NOT NULL)),
      CHECK((operation='policy_update')=(resulting_policy_version IS NOT NULL)),
      CHECK((operation='policy_update')=(resulting_action_state IS NULL)),
      CHECK((operation='policy_update')=(resulting_action_version IS NULL))
    );
    INSERT INTO proactive_action_operations_v65(id,workspace_id,company_id,proactive_action_id,operation,operation_id,request_fingerprint,outcome,actor_user_id,resulting_policy_enabled,resulting_policy_version,resulting_action_state,resulting_action_version,occurred_at,teardown_authorized) SELECT id,workspace_id,company_id,proactive_action_id,operation,operation_id,request_fingerprint,outcome,actor_user_id,resulting_policy_enabled,resulting_policy_version,resulting_action_state,resulting_action_version,occurred_at,teardown_authorized FROM proactive_action_operations;
    DROP TABLE proactive_action_operations;
    ALTER TABLE proactive_action_operations_v65 RENAME TO proactive_action_operations;
    CREATE INDEX idx_proactive_action_operations_action ON proactive_action_operations(workspace_id,company_id,proactive_action_id,occurred_at,id);
    CREATE TRIGGER proactive_action_operations_scope_insert BEFORE INSERT ON proactive_action_operations WHEN NOT EXISTS(SELECT 1 FROM companies c WHERE c.id=NEW.company_id AND c.workspace_id=NEW.workspace_id) OR (NEW.proactive_action_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM proactive_actions a WHERE a.id=NEW.proactive_action_id AND a.workspace_id=NEW.workspace_id AND a.company_id=NEW.company_id)) BEGIN SELECT RAISE(ABORT,'Proactive action operation scope is invalid'); END;
    CREATE TRIGGER proactive_action_operations_no_update BEFORE UPDATE OF id,workspace_id,company_id,proactive_action_id,operation,operation_id,request_fingerprint,outcome,actor_user_id,resulting_policy_enabled,resulting_policy_version,resulting_action_state,resulting_action_version,occurred_at ON proactive_action_operations BEGIN SELECT RAISE(ABORT,'Proactive action operations are append-only'); END;
    CREATE TRIGGER proactive_action_operations_no_delete BEFORE DELETE ON proactive_action_operations WHEN OLD.teardown_authorized=0 BEGIN SELECT RAISE(ABORT,'Proactive action operations are append-only'); END;
    CREATE TRIGGER companies_authorize_proactive_action_teardown BEFORE DELETE ON companies BEGIN UPDATE proactive_actions SET teardown_authorized=1 WHERE company_id=OLD.id; UPDATE proactive_action_operations SET teardown_authorized=1 WHERE company_id=OLD.id; UPDATE proactive_action_audit_events SET teardown_authorized=1 WHERE company_id=OLD.id; UPDATE proactive_action_visibility SET teardown_authorized=1 WHERE company_id=OLD.id; END;
  `);}},
  { id:66,name:"0066_billing_workspace_account_catalog",checksumSource:"billing-workspace-account-v2|versioned-local-catalog-v1|immutable-historical-prices|workspace-default-account",apply(database):void{database.exec(`
    CREATE TABLE billing_accounts(
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 80),
      workspace_id INTEGER NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
      rollout_mode TEXT NOT NULL CHECK(rollout_mode IN ('unmanaged','managed')),
       provider_kind TEXT CHECK(provider_kind IS NULL OR provider_kind IN ('stripe','mercadopago')),
      provider_customer_id TEXT CHECK(provider_customer_id IS NULL OR length(provider_customer_id) BETWEEN 1 AND 200),
      billing_payer_identity_id TEXT REFERENCES authentication_identities(id) ON DELETE SET NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CHECK((rollout_mode='unmanaged' AND provider_kind IS NULL AND provider_customer_id IS NULL) OR (rollout_mode='managed' AND provider_kind IS NOT NULL))
    );
    CREATE UNIQUE INDEX uq_billing_accounts_provider_customer ON billing_accounts(provider_kind,provider_customer_id) WHERE provider_customer_id IS NOT NULL;
    CREATE TABLE billing_catalog_entries(
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 80),
      plan_key TEXT NOT NULL CHECK(length(plan_key) BETWEEN 1 AND 80),
      catalog_version INTEGER NOT NULL CHECK(catalog_version>0),
      display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 160),
      billing_interval TEXT NOT NULL CHECK(billing_interval IN ('month','year')),
      currency TEXT NOT NULL CHECK(currency GLOB '[A-Z][A-Z][A-Z]'),
      amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor>=0),
      lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN ('active','retired')),
      entitlement_max_companies INTEGER CHECK(entitlement_max_companies IS NULL OR entitlement_max_companies>=0),
      entitlement_max_assistant_profiles INTEGER CHECK(entitlement_max_assistant_profiles IS NULL OR entitlement_max_assistant_profiles>=0),
      entitlement_max_active_channels INTEGER CHECK(entitlement_max_active_channels IS NULL OR entitlement_max_active_channels>=0),
      entitlement_mutation_eligible INTEGER NOT NULL CHECK(entitlement_mutation_eligible IN (0,1)),
      entitlement_definition_version INTEGER NOT NULL CHECK(entitlement_definition_version>0),
       provider_kind TEXT CHECK(provider_kind IS NULL OR provider_kind IN ('stripe','mercadopago')),
      provider_price_id TEXT CHECK(provider_price_id IS NULL OR length(provider_price_id) BETWEEN 1 AND 200),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(plan_key,catalog_version),
      CHECK((provider_kind IS NULL)=(provider_price_id IS NULL))
    );
    CREATE UNIQUE INDEX uq_billing_catalog_provider_price ON billing_catalog_entries(provider_kind,provider_price_id) WHERE provider_price_id IS NOT NULL;
    CREATE TRIGGER billing_catalog_entries_immutable BEFORE UPDATE OF plan_key,catalog_version,display_name,billing_interval,currency,amount_minor,entitlement_max_companies,entitlement_max_assistant_profiles,entitlement_max_active_channels,entitlement_mutation_eligible,entitlement_definition_version,provider_kind,provider_price_id,created_at ON billing_catalog_entries BEGIN SELECT RAISE(ABORT,'Billing catalog historical fields are immutable'); END;
    CREATE TRIGGER billing_catalog_entries_no_reactivate BEFORE UPDATE OF lifecycle_state ON billing_catalog_entries WHEN OLD.lifecycle_state='retired' AND NEW.lifecycle_state!='retired' BEGIN SELECT RAISE(ABORT,'Retired billing catalog entries cannot be reactivated'); END;
    INSERT INTO billing_accounts(id,workspace_id,rollout_mode,provider_kind,provider_customer_id,version,created_at,updated_at)
      SELECT 'bac_' || lower(hex(randomblob(16))),id,'unmanaged',NULL,NULL,1,created_at,created_at FROM workspaces;
    CREATE TRIGGER workspaces_seed_billing_account AFTER INSERT ON workspaces BEGIN
      INSERT INTO billing_accounts(id,workspace_id,rollout_mode,provider_kind,provider_customer_id,version,created_at,updated_at)
      VALUES('bac_' || lower(hex(randomblob(16))),NEW.id,'unmanaged',NULL,NULL,1,NEW.created_at,NEW.created_at);
    END;
    CREATE TRIGGER workspaces_prevent_managed_billing_delete BEFORE DELETE ON workspaces
      WHEN EXISTS(SELECT 1 FROM billing_accounts WHERE workspace_id=OLD.id AND (rollout_mode='managed' OR provider_customer_id IS NOT NULL))
      BEGIN SELECT RAISE(ABORT,'Managed Workspace billing requires deprovisioning'); END;
  `);}},
  { id:67,name:"0067_billing_subscription_entitlements",checksumSource:"billing-subscription-v1|versioned-entitlement-snapshot-v1|unmanaged-workspace-rollout|commercial-control-compatible",apply(database):void{database.exec(`
    CREATE TABLE billing_subscriptions(
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 80),
      billing_account_id TEXT NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
      catalog_entry_id TEXT REFERENCES billing_catalog_entries(id) ON DELETE RESTRICT,
       provider_kind TEXT CHECK(provider_kind IS NULL OR provider_kind IN ('stripe','mercadopago')),
      provider_subscription_id TEXT CHECK(provider_subscription_id IS NULL OR length(provider_subscription_id) BETWEEN 1 AND 200),
       provider_evidence_state TEXT CHECK(provider_evidence_state IS NULL OR provider_evidence_state IN ('checkout_pending','trialing','active','past_due','paused','canceled','unpaid','incomplete','incomplete_expired','unknown')),
       effective_state TEXT NOT NULL CHECK(effective_state IN ('unmanaged','trial','active','canceling_at_period_end','grace','paused','payment_required','canceled','reconciliation_required')),
      current_period_start TEXT,
      current_period_end TEXT,
      trial_ends_at TEXT,
      grace_ends_at TEXT,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK(cancel_at_period_end IN (0,1)),
      is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0,1)),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK((provider_kind IS NULL)=(provider_subscription_id IS NULL)),
      CHECK(effective_state!='unmanaged' OR provider_kind IS NULL),
      CHECK(current_period_end IS NULL OR current_period_start IS NULL OR current_period_end>=current_period_start),
      CHECK(trial_ends_at IS NULL OR current_period_start IS NULL OR trial_ends_at>=current_period_start),
      CHECK(grace_ends_at IS NULL OR current_period_end IS NULL OR grace_ends_at>=current_period_end),
      CHECK(cancel_at_period_end=0 OR effective_state='canceling_at_period_end')
    );
    CREATE UNIQUE INDEX uq_billing_subscriptions_current_account ON billing_subscriptions(billing_account_id) WHERE is_current=1;
    CREATE UNIQUE INDEX uq_billing_subscriptions_provider_subscription ON billing_subscriptions(provider_kind,provider_subscription_id) WHERE provider_subscription_id IS NOT NULL;
    CREATE TABLE billing_entitlement_snapshots(
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 80),
      billing_account_id TEXT NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
      billing_subscription_id TEXT NOT NULL REFERENCES billing_subscriptions(id) ON DELETE RESTRICT,
      entitlement_state TEXT NOT NULL CHECK(entitlement_state IN ('enabled','grace_enabled','restricted','suspended','unavailable')),
      max_companies INTEGER CHECK(max_companies IS NULL OR max_companies>=0),
      max_assistant_profiles INTEGER CHECK(max_assistant_profiles IS NULL OR max_assistant_profiles>=0),
      max_active_channels INTEGER CHECK(max_active_channels IS NULL OR max_active_channels>=0),
      mutation_eligible INTEGER NOT NULL CHECK(mutation_eligible IN (0,1)),
      is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0,1)),
      version INTEGER NOT NULL CHECK(version>0),
      evaluated_at TEXT NOT NULL,
      effective_at TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(expires_at IS NULL OR expires_at>=effective_at)
    );
    CREATE UNIQUE INDEX uq_billing_entitlement_snapshots_current_account ON billing_entitlement_snapshots(billing_account_id) WHERE is_current=1;
    CREATE TRIGGER billing_subscriptions_account_scope_insert BEFORE INSERT ON billing_subscriptions
      WHEN NEW.catalog_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM billing_catalog_entries WHERE id=NEW.catalog_entry_id)
      BEGIN SELECT RAISE(ABORT,'Billing catalog entry is invalid'); END;
    INSERT INTO billing_subscriptions(id,billing_account_id,catalog_entry_id,provider_kind,provider_subscription_id,provider_evidence_state,effective_state,current_period_start,current_period_end,trial_ends_at,grace_ends_at,cancel_at_period_end,is_current,version,created_at,updated_at)
      SELECT 'bsub_' || lower(hex(randomblob(16))),a.id,NULL,NULL,NULL,NULL,'unmanaged',NULL,NULL,NULL,NULL,0,1,1,a.created_at,a.updated_at FROM billing_accounts a;
    INSERT INTO billing_entitlement_snapshots(id,billing_account_id,billing_subscription_id,entitlement_state,max_companies,max_assistant_profiles,max_active_channels,mutation_eligible,is_current,version,evaluated_at,effective_at,expires_at,created_at)
      SELECT 'bes_' || lower(hex(randomblob(16))),a.id,s.id,'enabled',NULL,NULL,NULL,1,1,1,a.updated_at,a.updated_at,NULL,a.created_at
      FROM billing_accounts a JOIN billing_subscriptions s ON s.billing_account_id=a.id AND s.is_current=1;
    CREATE TRIGGER billing_accounts_seed_unmanaged_subscription AFTER INSERT ON billing_accounts BEGIN
      INSERT INTO billing_subscriptions(id,billing_account_id,catalog_entry_id,provider_kind,provider_subscription_id,provider_evidence_state,effective_state,current_period_start,current_period_end,trial_ends_at,grace_ends_at,cancel_at_period_end,is_current,version,created_at,updated_at)
      VALUES('bsub_' || lower(hex(randomblob(16))),NEW.id,NULL,NULL,NULL,NULL,'unmanaged',NULL,NULL,NULL,NULL,0,1,1,NEW.created_at,NEW.updated_at);
      INSERT INTO billing_entitlement_snapshots(id,billing_account_id,billing_subscription_id,entitlement_state,max_companies,max_assistant_profiles,max_active_channels,mutation_eligible,is_current,version,evaluated_at,effective_at,expires_at,created_at)
      SELECT 'bes_' || lower(hex(randomblob(16))),NEW.id,id,'enabled',NULL,NULL,NULL,1,1,1,NEW.updated_at,NEW.updated_at,NULL,NEW.created_at FROM billing_subscriptions WHERE billing_account_id=NEW.id AND is_current=1;
    END;
    DROP TRIGGER commercial_company_limit; DROP TRIGGER commercial_company_restore_limit; DROP TRIGGER commercial_profile_limit; DROP TRIGGER commercial_profile_restore_limit; DROP TRIGGER commercial_web_chat_active_limit_insert; DROP TRIGGER commercial_web_chat_active_limit_update; DROP TRIGGER commercial_whatsapp_active_limit_insert; DROP TRIGGER commercial_whatsapp_active_limit_update;
    CREATE TRIGGER billing_company_limit BEFORE INSERT ON companies WHEN NOT EXISTS(SELECT 1 FROM workspace_commercial_controls cc JOIN billing_accounts a ON a.workspace_id=NEW.workspace_id JOIN billing_entitlement_snapshots s ON s.billing_account_id=a.id AND s.is_current=1 WHERE cc.workspace_id=NEW.workspace_id AND cc.status='active' AND s.entitlement_state IN ('enabled','grace_enabled') AND s.mutation_eligible=1 AND ((CASE WHEN s.max_companies IS NULL THEN cc.max_companies WHEN cc.max_companies IS NULL THEN s.max_companies WHEN s.max_companies<cc.max_companies THEN s.max_companies ELSE cc.max_companies END) IS NULL OR (SELECT COUNT(*) FROM companies WHERE workspace_id=NEW.workspace_id AND lifecycle_state!='archived')<(CASE WHEN s.max_companies IS NULL THEN cc.max_companies WHEN cc.max_companies IS NULL THEN s.max_companies WHEN s.max_companies<cc.max_companies THEN s.max_companies ELSE cc.max_companies END))) BEGIN SELECT RAISE(ABORT,'workspace company creation is unavailable'); END;
    CREATE TRIGGER billing_profile_limit BEFORE INSERT ON assistant_profiles WHEN NOT EXISTS(SELECT 1 FROM workspace_commercial_controls cc JOIN companies c ON c.workspace_id=cc.workspace_id JOIN billing_accounts a ON a.workspace_id=cc.workspace_id JOIN billing_entitlement_snapshots s ON s.billing_account_id=a.id AND s.is_current=1 WHERE c.id=NEW.company_id AND cc.status='active' AND s.entitlement_state IN ('enabled','grace_enabled') AND s.mutation_eligible=1 AND ((CASE WHEN s.max_assistant_profiles IS NULL THEN cc.max_assistant_profiles WHEN cc.max_assistant_profiles IS NULL THEN s.max_assistant_profiles WHEN s.max_assistant_profiles<cc.max_assistant_profiles THEN s.max_assistant_profiles ELSE cc.max_assistant_profiles END) IS NULL OR (SELECT COUNT(*) FROM assistant_profiles p JOIN companies co ON co.id=p.company_id WHERE co.workspace_id=c.workspace_id AND p.status!='archived')<(CASE WHEN s.max_assistant_profiles IS NULL THEN cc.max_assistant_profiles WHEN cc.max_assistant_profiles IS NULL THEN s.max_assistant_profiles WHEN s.max_assistant_profiles<cc.max_assistant_profiles THEN s.max_assistant_profiles ELSE cc.max_assistant_profiles END))) BEGIN SELECT RAISE(ABORT,'workspace assistant profile creation is unavailable'); END;
    CREATE TRIGGER billing_web_chat_limit BEFORE INSERT ON web_chat_connections WHEN NEW.status='active' AND NOT EXISTS(SELECT 1 FROM workspace_commercial_controls cc JOIN billing_accounts a ON a.workspace_id=NEW.workspace_id JOIN billing_entitlement_snapshots s ON s.billing_account_id=a.id AND s.is_current=1 WHERE cc.workspace_id=NEW.workspace_id AND cc.status='active' AND s.entitlement_state IN ('enabled','grace_enabled') AND s.mutation_eligible=1 AND ((CASE WHEN s.max_active_channels IS NULL THEN cc.max_active_channels WHEN cc.max_active_channels IS NULL THEN s.max_active_channels WHEN s.max_active_channels<cc.max_active_channels THEN s.max_active_channels ELSE cc.max_active_channels END) IS NULL OR ((SELECT COUNT(*) FROM web_chat_connections WHERE workspace_id=NEW.workspace_id AND status='active')+(SELECT COUNT(*) FROM whatsapp_connections WHERE workspace_id=NEW.workspace_id AND status='active'))<(CASE WHEN s.max_active_channels IS NULL THEN cc.max_active_channels WHEN cc.max_active_channels IS NULL THEN s.max_active_channels WHEN s.max_active_channels<cc.max_active_channels THEN s.max_active_channels ELSE cc.max_active_channels END))) BEGIN SELECT RAISE(ABORT,'workspace active channel creation is unavailable'); END;
    CREATE TRIGGER billing_whatsapp_limit BEFORE INSERT ON whatsapp_connections WHEN NEW.status='active' AND NOT EXISTS(SELECT 1 FROM workspace_commercial_controls cc JOIN billing_accounts a ON a.workspace_id=NEW.workspace_id JOIN billing_entitlement_snapshots s ON s.billing_account_id=a.id AND s.is_current=1 WHERE cc.workspace_id=NEW.workspace_id AND cc.status='active' AND s.entitlement_state IN ('enabled','grace_enabled') AND s.mutation_eligible=1 AND ((CASE WHEN s.max_active_channels IS NULL THEN cc.max_active_channels WHEN cc.max_active_channels IS NULL THEN s.max_active_channels WHEN s.max_active_channels<cc.max_active_channels THEN s.max_active_channels ELSE cc.max_active_channels END) IS NULL OR ((SELECT COUNT(*) FROM web_chat_connections WHERE workspace_id=NEW.workspace_id AND status='active')+(SELECT COUNT(*) FROM whatsapp_connections WHERE workspace_id=NEW.workspace_id AND status='active'))<(CASE WHEN s.max_active_channels IS NULL THEN cc.max_active_channels WHEN cc.max_active_channels IS NULL THEN s.max_active_channels WHEN s.max_active_channels<cc.max_active_channels THEN s.max_active_channels ELSE cc.max_active_channels END))) BEGIN SELECT RAISE(ABORT,'workspace active channel creation is unavailable'); END;
    CREATE TRIGGER billing_company_restore_limit BEFORE UPDATE OF lifecycle_state ON companies WHEN OLD.lifecycle_state='archived' AND NEW.lifecycle_state!='archived' AND NOT EXISTS(SELECT 1 FROM workspace_commercial_controls cc JOIN billing_accounts a ON a.workspace_id=NEW.workspace_id JOIN billing_entitlement_snapshots s ON s.billing_account_id=a.id AND s.is_current=1 WHERE cc.workspace_id=NEW.workspace_id AND cc.status='active' AND s.entitlement_state IN ('enabled','grace_enabled') AND s.mutation_eligible=1 AND ((CASE WHEN s.max_companies IS NULL THEN cc.max_companies WHEN cc.max_companies IS NULL THEN s.max_companies WHEN s.max_companies<cc.max_companies THEN s.max_companies ELSE cc.max_companies END) IS NULL OR (SELECT COUNT(*) FROM companies WHERE workspace_id=NEW.workspace_id AND lifecycle_state!='archived')<(CASE WHEN s.max_companies IS NULL THEN cc.max_companies WHEN cc.max_companies IS NULL THEN s.max_companies WHEN s.max_companies<cc.max_companies THEN s.max_companies ELSE cc.max_companies END))) BEGIN SELECT RAISE(ABORT,'workspace company restore is unavailable'); END;
    CREATE TRIGGER billing_profile_restore_limit BEFORE UPDATE OF status ON assistant_profiles WHEN OLD.status='archived' AND NEW.status!='archived' AND NOT EXISTS(SELECT 1 FROM workspace_commercial_controls cc JOIN companies c ON c.workspace_id=cc.workspace_id JOIN billing_accounts a ON a.workspace_id=cc.workspace_id JOIN billing_entitlement_snapshots s ON s.billing_account_id=a.id AND s.is_current=1 WHERE c.id=NEW.company_id AND cc.status='active' AND s.entitlement_state IN ('enabled','grace_enabled') AND s.mutation_eligible=1 AND ((CASE WHEN s.max_assistant_profiles IS NULL THEN cc.max_assistant_profiles WHEN cc.max_assistant_profiles IS NULL THEN s.max_assistant_profiles WHEN s.max_assistant_profiles<cc.max_assistant_profiles THEN s.max_assistant_profiles ELSE cc.max_assistant_profiles END) IS NULL OR (SELECT COUNT(*) FROM assistant_profiles p JOIN companies co ON co.id=p.company_id WHERE co.workspace_id=c.workspace_id AND p.status!='archived')<(CASE WHEN s.max_assistant_profiles IS NULL THEN cc.max_assistant_profiles WHEN cc.max_assistant_profiles IS NULL THEN s.max_assistant_profiles WHEN s.max_assistant_profiles<cc.max_assistant_profiles THEN s.max_assistant_profiles ELSE cc.max_assistant_profiles END))) BEGIN SELECT RAISE(ABORT,'workspace assistant profile restore is unavailable'); END;
    CREATE TRIGGER billing_web_chat_active_limit_update BEFORE UPDATE OF status ON web_chat_connections WHEN NEW.status='active' AND OLD.status!='active' AND NOT EXISTS(SELECT 1 FROM workspace_commercial_controls cc JOIN billing_accounts a ON a.workspace_id=NEW.workspace_id JOIN billing_entitlement_snapshots s ON s.billing_account_id=a.id AND s.is_current=1 WHERE cc.workspace_id=NEW.workspace_id AND cc.status='active' AND s.entitlement_state IN ('enabled','grace_enabled') AND s.mutation_eligible=1 AND ((CASE WHEN s.max_active_channels IS NULL THEN cc.max_active_channels WHEN cc.max_active_channels IS NULL THEN s.max_active_channels WHEN s.max_active_channels<cc.max_active_channels THEN s.max_active_channels ELSE cc.max_active_channels END) IS NULL OR ((SELECT COUNT(*) FROM web_chat_connections WHERE workspace_id=NEW.workspace_id AND status='active')+(SELECT COUNT(*) FROM whatsapp_connections WHERE workspace_id=NEW.workspace_id AND status='active'))<(CASE WHEN s.max_active_channels IS NULL THEN cc.max_active_channels WHEN cc.max_active_channels IS NULL THEN s.max_active_channels WHEN s.max_active_channels<cc.max_active_channels THEN s.max_active_channels ELSE cc.max_active_channels END))) BEGIN SELECT RAISE(ABORT,'workspace active channel creation is unavailable'); END;
    CREATE TRIGGER billing_whatsapp_active_limit_update BEFORE UPDATE OF status ON whatsapp_connections WHEN NEW.status='active' AND OLD.status!='active' AND NOT EXISTS(SELECT 1 FROM workspace_commercial_controls cc JOIN billing_accounts a ON a.workspace_id=NEW.workspace_id JOIN billing_entitlement_snapshots s ON s.billing_account_id=a.id AND s.is_current=1 WHERE cc.workspace_id=NEW.workspace_id AND cc.status='active' AND s.entitlement_state IN ('enabled','grace_enabled') AND s.mutation_eligible=1 AND ((CASE WHEN s.max_active_channels IS NULL THEN cc.max_active_channels WHEN cc.max_active_channels IS NULL THEN s.max_active_channels WHEN s.max_active_channels<cc.max_active_channels THEN s.max_active_channels ELSE cc.max_active_channels END) IS NULL OR ((SELECT COUNT(*) FROM web_chat_connections WHERE workspace_id=NEW.workspace_id AND status='active')+(SELECT COUNT(*) FROM whatsapp_connections WHERE workspace_id=NEW.workspace_id AND status='active'))<(CASE WHEN s.max_active_channels IS NULL THEN cc.max_active_channels WHEN cc.max_active_channels IS NULL THEN s.max_active_channels WHEN s.max_active_channels<cc.max_active_channels THEN s.max_active_channels ELSE cc.max_active_channels END))) BEGIN SELECT RAISE(ABORT,'workspace active channel creation is unavailable'); END;
  `);}},
  { id:68,name:"0068_billing_operations_provider_events_reconciliation",checksumSource:"billing-durable-operations-v1|provider-event-envelope-v2|reconciliation-work-coalesced-wake-generation-v1|checkout-enrollment-v1",apply(database):void{database.exec(`
    CREATE TABLE billing_operations(
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 80),billing_account_id TEXT NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
      operation_kind TEXT NOT NULL CHECK(operation_kind IN ('checkout_session_create','subscription_cancel_at_period_end','subscription_reactivate')),
      operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 200),request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'),
      provider_kind TEXT NOT NULL CHECK(provider_kind IN ('stripe','mercadopago')),provider_idempotency_key TEXT NOT NULL CHECK(length(provider_idempotency_key) BETWEEN 1 AND 200),
      status TEXT NOT NULL CHECK(status IN ('pending','request_started','succeeded','failed','uncertain')),request_started_at TEXT,provider_object_id TEXT CHECK(provider_object_id IS NULL OR length(provider_object_id) BETWEEN 1 AND 200),safe_result_json TEXT CHECK(safe_result_json IS NULL OR (json_valid(safe_result_json) AND length(safe_result_json)<=4096)),failure_code TEXT CHECK(failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 100),attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),catalog_entry_id TEXT REFERENCES billing_catalog_entries(id) ON DELETE RESTRICT,success_target TEXT CHECK(success_target IS NULL OR length(success_target) BETWEEN 1 AND 2000),cancel_target TEXT CHECK(cancel_target IS NULL OR length(cancel_target) BETWEEN 1 AND 2000),target_subscription_id TEXT REFERENCES billing_subscriptions(id) ON DELETE RESTRICT,recovery_correlation_token TEXT UNIQUE CHECK(recovery_correlation_token IS NULL OR length(recovery_correlation_token) BETWEEN 1 AND 100),recovery_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(recovery_attempt_count>=0),recovery_next_attempt_at TEXT,recovery_lease_token TEXT CHECK(recovery_lease_token IS NULL OR length(recovery_lease_token) BETWEEN 1 AND 200),recovery_lease_expires_at TEXT,recovery_safe_failure_code TEXT CHECK(recovery_safe_failure_code IS NULL OR length(recovery_safe_failure_code) BETWEEN 1 AND 100),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,settled_at TEXT,
      UNIQUE(billing_account_id,operation_kind,operation_id),CHECK((status='pending' AND request_started_at IS NULL AND settled_at IS NULL) OR (status IN ('request_started','uncertain') AND request_started_at IS NOT NULL AND settled_at IS NULL) OR (status IN ('succeeded','failed') AND request_started_at IS NOT NULL AND settled_at IS NOT NULL)),CHECK(status!='succeeded' OR provider_object_id IS NOT NULL)
    );
    CREATE INDEX idx_billing_operations_recovery ON billing_operations(status,recovery_next_attempt_at,request_started_at,id);
    CREATE TABLE billing_provider_events(
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 80),provider_kind TEXT NOT NULL CHECK(provider_kind IN ('stripe','mercadopago')),provider_event_id TEXT NOT NULL CHECK(length(provider_event_id) BETWEEN 1 AND 200),event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 200),provider_object_id TEXT CHECK(provider_object_id IS NULL OR length(provider_object_id) BETWEEN 1 AND 200),provider_customer_id TEXT CHECK(provider_customer_id IS NULL OR length(provider_customer_id) BETWEEN 1 AND 200),provider_subscription_id TEXT CHECK(provider_subscription_id IS NULL OR length(provider_subscription_id) BETWEEN 1 AND 200),payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64 AND payload_digest NOT GLOB '*[^0-9a-f]*'),status TEXT NOT NULL CHECK(status IN ('received','processed','ignored','failed')),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),received_at TEXT NOT NULL,processed_at TEXT,UNIQUE(provider_kind,provider_event_id)
    );
    CREATE TABLE billing_reconciliation_work(
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 80),billing_account_id TEXT NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,provider_kind TEXT CHECK(provider_kind IS NULL OR provider_kind IN ('stripe','mercadopago')),reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 100),provider_object_id TEXT CHECK(provider_object_id IS NULL OR length(provider_object_id) BETWEEN 1 AND 200),coalesce_key TEXT NOT NULL UNIQUE CHECK(length(coalesce_key) BETWEEN 1 AND 200),status TEXT NOT NULL CHECK(status IN ('pending','leased','succeeded','failed')),attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),lease_owner TEXT CHECK(lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 100),lease_token TEXT CHECK(lease_token IS NULL OR length(lease_token) BETWEEN 1 AND 200),lease_expires_at TEXT,next_attempt_at TEXT NOT NULL,safe_failure_code TEXT CHECK(safe_failure_code IS NULL OR length(safe_failure_code) BETWEEN 1 AND 100),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      wake_generation INTEGER NOT NULL DEFAULT 1 CHECK(wake_generation>0),
      CHECK((status='leased')=(lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
    );
    CREATE TABLE billing_checkout_enrollments(
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 80),
      billing_account_id TEXT NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
      catalog_entry_id TEXT NOT NULL REFERENCES billing_catalog_entries(id) ON DELETE RESTRICT,
      checkout_operation_id TEXT NOT NULL UNIQUE REFERENCES billing_operations(id) ON DELETE RESTRICT,
      provider_kind TEXT NOT NULL CHECK(provider_kind IN ('stripe','mercadopago')),
      provider_checkout_object_id TEXT NOT NULL CHECK(length(provider_checkout_object_id) BETWEEN 1 AND 200),
      provider_subscription_id TEXT CHECK(provider_subscription_id IS NULL OR length(provider_subscription_id) BETWEEN 1 AND 200),
      provider_customer_id TEXT CHECK(provider_customer_id IS NULL OR length(provider_customer_id) BETWEEN 1 AND 200),
      status TEXT NOT NULL CHECK(status IN ('pending','ready','consumed','conflict')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      UNIQUE(provider_kind,provider_checkout_object_id),
      UNIQUE(provider_kind,provider_subscription_id),
      CHECK((status='pending' AND provider_subscription_id IS NULL) OR (status IN ('ready','consumed','conflict') AND provider_subscription_id IS NOT NULL))
    );
  `);}},
  { id:69,name:"0069_shared_rate_limit_windows",checksumSource:"shared-fixed-window-abuse-limits-v1|hashed-scope-action-keys|atomic-upsert-bounded-expiry-cleanup",apply(database):void{database.exec(`
    CREATE TABLE shared_rate_limit_windows(
      scope_key TEXT NOT NULL CHECK(length(scope_key)=64 AND scope_key NOT GLOB '*[^0-9a-f]*'),
      action_key TEXT NOT NULL CHECK(length(action_key)=64 AND action_key NOT GLOB '*[^0-9a-f]*'),
      window_start TEXT NOT NULL,
      count INTEGER NOT NULL CHECK(count>0),
      expires_at TEXT NOT NULL,
      PRIMARY KEY(scope_key,action_key,window_start)
    );
    CREATE INDEX idx_shared_rate_limit_windows_expiry ON shared_rate_limit_windows(expires_at);
  `);}},
  { id:70,name:"0070_conversation_actor_reads",checksumSource:"conversation-inbox-actor-read-position-tenant-scoped-v1",apply(database):void{database.exec(`
    CREATE TABLE conversation_actor_reads(
      workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL CHECK(length(actor_user_id) BETWEEN 1 AND 128),read_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id,company_id,conversation_id,actor_user_id),
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE
    );
    CREATE INDEX idx_conversation_actor_reads_actor ON conversation_actor_reads(workspace_id,company_id,actor_user_id,conversation_id);
    CREATE TRIGGER conversation_actor_reads_scope_insert BEFORE INSERT ON conversation_actor_reads
    WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id)
    BEGIN SELECT RAISE(ABORT,'Conversation actor read scope is invalid'); END;
    CREATE TRIGGER conversation_actor_reads_scope_update BEFORE UPDATE OF workspace_id,company_id,conversation_id ON conversation_actor_reads
    WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id)
    BEGIN SELECT RAISE(ABORT,'Conversation actor read scope is invalid'); END;
  `);}},
  { id:71,name:"0071_conversation_resume_operation",checksumSource:"conversation-direct-human-required-resume-operation-v1|preserve-control-operation-ledger-and-events",apply(database):void{database.exec(`
    DROP TRIGGER conversation_events_scope_insert;
    DROP TRIGGER conversation_control_operations_scope_insert;
    DROP TRIGGER conversation_control_operations_no_update;
    DROP TRIGGER conversation_control_operations_no_delete;
    CREATE TABLE conversation_control_operations_v2(
      workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 200),actor_user_id TEXT NOT NULL CHECK(length(actor_user_id) BETWEEN 1 AND 128),
      operation TEXT NOT NULL CHECK(operation IN ('takeover','release','resolve','resume')),
      request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'),expected_version INTEGER NOT NULL CHECK(expected_version > 0),
      outcome TEXT NOT NULL CHECK(outcome IN ('applied','stale_version','controlled_by_other','not_controller')),result_category TEXT NOT NULL CHECK(result_category IN ('success','conflict','not_found')),
      resulting_control_state TEXT CHECK(resulting_control_state IS NULL OR resulting_control_state IN ('automated','human_required','human_controlled')),
      resulting_version INTEGER CHECK(resulting_version IS NULL OR resulting_version > 0),resulting_authority_generation INTEGER CHECK(resulting_authority_generation IS NULL OR resulting_authority_generation > 0),
      resulting_controller_relation TEXT CHECK(resulting_controller_relation IS NULL OR resulting_controller_relation IN ('current_actor','other_actor','none')),occurred_at TEXT NOT NULL,
      CHECK((outcome='applied' AND result_category='success') OR (outcome='stale_version' AND result_category='conflict') OR (outcome IN ('controlled_by_other','not_controller') AND result_category='not_found')),
      PRIMARY KEY(workspace_id,company_id,conversation_id,operation_id),FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE
    );
    INSERT INTO conversation_control_operations_v2 SELECT * FROM conversation_control_operations;
    DROP TABLE conversation_control_operations;
    ALTER TABLE conversation_control_operations_v2 RENAME TO conversation_control_operations;
    CREATE INDEX idx_conversation_control_operations_conversation ON conversation_control_operations(workspace_id,company_id,conversation_id,occurred_at,operation_id);
    CREATE TRIGGER conversation_control_operations_scope_insert BEFORE INSERT ON conversation_control_operations
    WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id)
    BEGIN SELECT RAISE(ABORT,'Conversation control operation scope is invalid'); END;
    CREATE TRIGGER conversation_control_operations_no_update BEFORE UPDATE ON conversation_control_operations
    BEGIN SELECT RAISE(ABORT,'Conversation control operations are append-only'); END;
    CREATE TRIGGER conversation_control_operations_no_delete BEFORE DELETE ON conversation_control_operations
    BEGIN SELECT RAISE(ABORT,'Conversation control operations are append-only'); END;
    CREATE TRIGGER conversation_events_scope_insert BEFORE INSERT ON conversation_events
    WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id)
      OR (NEW.related_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_messages m WHERE m.id=NEW.related_message_id AND m.conversation_id=NEW.conversation_id))
      OR (NEW.related_operation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_control_operations o WHERE o.workspace_id=NEW.workspace_id AND o.company_id=NEW.company_id AND o.conversation_id=NEW.conversation_id AND o.operation_id=NEW.related_operation_id))
    BEGIN SELECT RAISE(ABORT,'Conversation event scope is invalid'); END;
  `);}},
  { id:72,name:"0072_conversation_delivery_feed_events",checksumSource:"standard-outbound-delivery-state-durable-feed-invalidation-v1",disableForeignKeys:true,apply(database):void{database.exec(`
    DROP TRIGGER voice_read_event_transcript;
    DROP TRIGGER voice_read_event_transcription_terminal;
    DROP TRIGGER voice_read_event_synthesis_terminal;
    DROP TRIGGER voice_read_event_upload_terminal;
    DROP TRIGGER voice_read_event_delivery_visible;
    CREATE TABLE conversation_events_v72(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,event_type TEXT NOT NULL CHECK(event_type IN ('handoff_requested','takeover_applied','takeover_rejected','release_applied','release_rejected','automation_resumed','automation_blocked','operator_message_created','assistant_message_created','inbound_message_received','conversation_reopened','conversation_resolved','voice_state_changed','delivery_state_changed')),actor_user_id TEXT CHECK(actor_user_id IS NULL OR length(actor_user_id) BETWEEN 1 AND 128),control_version INTEGER CHECK(control_version IS NULL OR control_version>0),authority_generation INTEGER CHECK(authority_generation IS NULL OR authority_generation>0),related_message_id TEXT,related_operation_id TEXT CHECK(related_operation_id IS NULL OR length(related_operation_id) BETWEEN 1 AND 200),occurred_at TEXT NOT NULL,FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,CHECK(event_type NOT IN ('voice_state_changed','delivery_state_changed') OR related_message_id IS NOT NULL));
    INSERT INTO conversation_events_v72(sequence,id,workspace_id,company_id,conversation_id,event_type,actor_user_id,control_version,authority_generation,related_message_id,related_operation_id,occurred_at) SELECT sequence,id,workspace_id,company_id,conversation_id,event_type,actor_user_id,control_version,authority_generation,related_message_id,related_operation_id,occurred_at FROM conversation_events;
    DROP TABLE conversation_events;
    ALTER TABLE conversation_events_v72 RENAME TO conversation_events;
    CREATE INDEX idx_conversation_events_company_sequence ON conversation_events(workspace_id,company_id,sequence);
    CREATE INDEX idx_conversation_events_conversation_sequence ON conversation_events(workspace_id,company_id,conversation_id,sequence);
    CREATE TRIGGER conversation_events_scope_insert BEFORE INSERT ON conversation_events WHEN NOT EXISTS(SELECT 1 FROM conversations c JOIN companies co ON co.id=c.company_id WHERE c.id=NEW.conversation_id AND c.company_id=NEW.company_id AND co.workspace_id=NEW.workspace_id) OR (NEW.related_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_messages m WHERE m.id=NEW.related_message_id AND m.conversation_id=NEW.conversation_id)) OR (NEW.related_operation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_control_operations o WHERE o.workspace_id=NEW.workspace_id AND o.company_id=NEW.company_id AND o.conversation_id=NEW.conversation_id AND o.operation_id=NEW.related_operation_id)) BEGIN SELECT RAISE(ABORT,'Conversation event scope is invalid'); END;
    CREATE TRIGGER conversation_events_no_update BEFORE UPDATE ON conversation_events BEGIN SELECT RAISE(ABORT,'Conversation events are append-only'); END;
    CREATE TRIGGER conversation_events_no_delete BEFORE DELETE ON conversation_events BEGIN SELECT RAISE(ABORT,'Conversation events are append-only'); END;
    CREATE TRIGGER voice_read_event_transcript AFTER INSERT ON conversation_audio_transcripts WHEN NEW.outcome='completed' BEGIN INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,related_message_id,occurred_at) VALUES('cev_' || lower(hex(randomblob(16))),NEW.workspace_id,NEW.company_id,NEW.conversation_id,'voice_state_changed',NEW.conversation_message_id,NEW.created_at); END;
    CREATE TRIGGER voice_read_event_transcription_terminal AFTER UPDATE OF state ON audio_transcription_requests WHEN OLD.state!=NEW.state AND NEW.state IN ('failed','suppressed') BEGIN INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,related_message_id,occurred_at) VALUES('cev_' || lower(hex(randomblob(16))),NEW.workspace_id,NEW.company_id,NEW.conversation_id,'voice_state_changed',NEW.conversation_message_id,NEW.updated_at); END;
    CREATE TRIGGER voice_read_event_synthesis_terminal AFTER UPDATE OF state ON voice_synthesis_requests WHEN OLD.state!=NEW.state AND NEW.state IN ('completed','failed','suppressed') BEGIN INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,related_message_id,occurred_at) VALUES('cev_' || lower(hex(randomblob(16))),NEW.workspace_id,NEW.company_id,NEW.conversation_id,'voice_state_changed',NEW.conversation_message_id,NEW.updated_at); END;
    CREATE TRIGGER voice_read_event_upload_terminal AFTER UPDATE OF state ON whatsapp_outbound_media_uploads WHEN OLD.state!=NEW.state AND NEW.state IN ('uploaded','failed') BEGIN INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,related_message_id,occurred_at) SELECT 'cev_' || lower(hex(randomblob(16))),NEW.workspace_id,NEW.company_id,m.conversation_id,'voice_state_changed',m.id,NEW.updated_at FROM outbound_deliveries d JOIN provider_message_records p ON p.id=d.provider_message_record_id JOIN conversation_messages m ON m.id=p.conversation_message_id WHERE d.id=NEW.outbound_delivery_id; END;
    CREATE TRIGGER voice_read_event_delivery_visible AFTER UPDATE OF state ON outbound_deliveries WHEN OLD.state!=NEW.state AND NEW.response_policy='deferred_voice' AND NEW.state IN ('accepted','delivered','read') BEGIN INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,related_message_id,occurred_at) SELECT 'cev_' || lower(hex(randomblob(16))),co.workspace_id,co.id,m.conversation_id,'voice_state_changed',m.id,NEW.updated_at FROM provider_message_records p JOIN conversation_messages m ON m.id=p.conversation_message_id JOIN conversations c ON c.id=m.conversation_id JOIN companies co ON co.id=c.company_id WHERE p.id=NEW.provider_message_record_id; END;
    CREATE TRIGGER conversation_delivery_state_event AFTER UPDATE OF state ON outbound_deliveries WHEN OLD.state!=NEW.state AND NEW.response_policy='standard' BEGIN INSERT INTO conversation_events(id,workspace_id,company_id,conversation_id,event_type,related_message_id,occurred_at) SELECT 'cev_' || lower(hex(randomblob(16))),co.workspace_id,co.id,m.conversation_id,'delivery_state_changed',m.id,NEW.updated_at FROM provider_message_records p JOIN conversation_messages m ON m.id=p.conversation_message_id JOIN conversations c ON c.id=m.conversation_id JOIN companies co ON co.id=c.company_id WHERE p.id=NEW.provider_message_record_id; END;
  `);}},
  { id:73,name:"0073_scheduling_configuration_controls",checksumSource:"company-scheduling-configuration-control-operation-replay-audit-v1",apply(database):void{database.exec(`
    CREATE TABLE scheduling_configuration_controls(
      workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id,company_id),FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE
    );
    INSERT INTO scheduling_configuration_controls(workspace_id,company_id,created_at,updated_at)
      SELECT workspace_id,id,created_at,updated_at FROM companies;
    CREATE TRIGGER companies_seed_scheduling_configuration_control AFTER INSERT ON companies BEGIN
      INSERT INTO scheduling_configuration_controls(workspace_id,company_id,created_at,updated_at) VALUES(NEW.workspace_id,NEW.id,NEW.created_at,NEW.updated_at);
    END;
    CREATE TABLE scheduling_configuration_operations(
      workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 200),operation TEXT NOT NULL CHECK(length(operation) BETWEEN 1 AND 100),request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'),expected_version INTEGER NOT NULL CHECK(expected_version>0),resulting_version INTEGER NOT NULL CHECK(resulting_version>0),actor_user_id TEXT NOT NULL CHECK(length(actor_user_id) BETWEEN 1 AND 128),outcome_json TEXT NOT NULL CHECK(json_valid(outcome_json)),occurred_at TEXT NOT NULL,
      PRIMARY KEY(workspace_id,company_id,operation_id),FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE
    );
    CREATE INDEX idx_scheduling_configuration_operations_scope ON scheduling_configuration_operations(workspace_id,company_id,occurred_at,operation_id);
    CREATE TRIGGER scheduling_configuration_operations_no_update BEFORE UPDATE ON scheduling_configuration_operations BEGIN SELECT RAISE(ABORT,'Scheduling configuration operations are append-only'); END;
    CREATE TRIGGER scheduling_configuration_operations_no_delete BEFORE DELETE ON scheduling_configuration_operations BEGIN SELECT RAISE(ABORT,'Scheduling configuration operations are append-only'); END;
    CREATE TABLE scheduling_configuration_audit_events(
      id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,operation_id TEXT NOT NULL,actor_user_id TEXT NOT NULL CHECK(length(actor_user_id) BETWEEN 1 AND 128),affected_entity_type TEXT NOT NULL CHECK(length(affected_entity_type) BETWEEN 1 AND 100),affected_entity_id TEXT NOT NULL CHECK(length(affected_entity_id) BETWEEN 1 AND 200),action TEXT NOT NULL CHECK(length(action) BETWEEN 1 AND 100),resulting_version INTEGER NOT NULL CHECK(resulting_version>0),occurred_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,
      FOREIGN KEY(workspace_id,company_id,operation_id) REFERENCES scheduling_configuration_operations(workspace_id,company_id,operation_id) ON DELETE CASCADE
    );
    CREATE INDEX idx_scheduling_configuration_audit_scope ON scheduling_configuration_audit_events(workspace_id,company_id,occurred_at,id);
    CREATE TRIGGER scheduling_configuration_audit_events_no_update BEFORE UPDATE ON scheduling_configuration_audit_events BEGIN SELECT RAISE(ABORT,'Scheduling configuration audit events are append-only'); END;
    CREATE TRIGGER scheduling_configuration_audit_events_no_delete BEFORE DELETE ON scheduling_configuration_audit_events BEGIN SELECT RAISE(ABORT,'Scheduling configuration audit events are append-only'); END;
  `);}},
  { id:74,name:"0074_billing_versioned_plan_provider_commercial_offers",checksumSource:"billing-provider-independent-plan-versions-v1|immutable-provider-commercial-offers-v1|catalog-operation-audit-v1|legacy-catalog-offer-backfill-v1",apply(database):void{database.exec(`
    ALTER TABLE billing_accounts ADD COLUMN trial_consumed_at TEXT;
    ALTER TABLE billing_catalog_entries ADD COLUMN description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=2000);
    ALTER TABLE billing_catalog_entries ADD COLUMN publication_state TEXT NOT NULL DEFAULT 'draft' CHECK(publication_state IN ('draft','published','retired'));
    ALTER TABLE billing_catalog_entries ADD COLUMN trial_duration_days INTEGER CHECK(trial_duration_days IS NULL OR trial_duration_days>0);
    ALTER TABLE billing_catalog_entries ADD COLUMN grace_duration_days INTEGER CHECK(grace_duration_days IS NULL OR grace_duration_days>0);
    ALTER TABLE billing_catalog_entries ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>0);
    ALTER TABLE billing_catalog_entries ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
    UPDATE billing_catalog_entries SET updated_at=created_at WHERE updated_at='';
    UPDATE billing_catalog_entries SET publication_state=CASE lifecycle_state WHEN 'active' THEN 'published' ELSE 'retired' END;
    DROP TRIGGER billing_catalog_entries_immutable;
    CREATE TRIGGER billing_catalog_entries_immutable BEFORE UPDATE OF plan_key,catalog_version,display_name,billing_interval,currency,amount_minor,entitlement_max_companies,entitlement_max_assistant_profiles,entitlement_max_active_channels,entitlement_mutation_eligible,entitlement_definition_version,provider_kind,provider_price_id,description,trial_duration_days,grace_duration_days,created_at ON billing_catalog_entries WHEN OLD.publication_state!='draft' BEGIN SELECT RAISE(ABORT,'Published billing catalog terms are immutable'); END;
    CREATE TRIGGER billing_catalog_entries_no_unretire BEFORE UPDATE OF publication_state ON billing_catalog_entries WHEN OLD.publication_state='retired' AND NEW.publication_state!='retired' BEGIN SELECT RAISE(ABORT,'Retired billing catalog entries cannot be reactivated'); END;
    CREATE TABLE billing_provider_commercial_offers(
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 80),
      catalog_entry_id TEXT NOT NULL REFERENCES billing_catalog_entries(id) ON DELETE RESTRICT,
      provider_kind TEXT NOT NULL CHECK(provider_kind IN ('stripe','mercadopago')),
      offer_version INTEGER NOT NULL CHECK(offer_version>0),
      currency TEXT NOT NULL CHECK(currency GLOB '[A-Z][A-Z][A-Z]' AND ((provider_kind='stripe' AND currency='USD') OR (provider_kind='mercadopago' AND currency='ARS'))),
      amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor>0),
      billing_interval TEXT NOT NULL CHECK(billing_interval IN ('month','year')),
      provider_plan_reference TEXT NOT NULL CHECK(length(provider_plan_reference) BETWEEN 1 AND 200),
      readiness_state TEXT NOT NULL CHECK(readiness_state IN ('not_configured','invalid','unavailable','ready')),
      lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN ('draft','sellable','retired')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(catalog_entry_id,provider_kind,offer_version),
      UNIQUE(provider_kind,provider_plan_reference)
    );
    CREATE UNIQUE INDEX uq_billing_provider_commercial_offers_sellable ON billing_provider_commercial_offers(catalog_entry_id,provider_kind,billing_interval) WHERE lifecycle_state='sellable';
    CREATE INDEX idx_billing_provider_commercial_offers_catalog ON billing_provider_commercial_offers(catalog_entry_id,provider_kind,lifecycle_state,offer_version DESC);
    CREATE TRIGGER billing_provider_commercial_offers_immutable BEFORE UPDATE OF catalog_entry_id,provider_kind,offer_version,currency,amount_minor,billing_interval,provider_plan_reference,created_at ON billing_provider_commercial_offers WHEN OLD.lifecycle_state!='draft' BEGIN SELECT RAISE(ABORT,'Billing provider commercial offer terms are immutable'); END;
    CREATE TRIGGER billing_provider_commercial_offers_sellable_parent BEFORE INSERT ON billing_provider_commercial_offers WHEN NEW.lifecycle_state='sellable' AND NOT EXISTS(SELECT 1 FROM billing_catalog_entries WHERE id=NEW.catalog_entry_id AND publication_state='published') BEGIN SELECT RAISE(ABORT,'Sellable billing provider offer requires published catalog'); END;
    CREATE TRIGGER billing_provider_commercial_offers_sellable_parent_update BEFORE UPDATE OF lifecycle_state ON billing_provider_commercial_offers WHEN NEW.lifecycle_state='sellable' AND NOT EXISTS(SELECT 1 FROM billing_catalog_entries WHERE id=NEW.catalog_entry_id AND publication_state='published') BEGIN SELECT RAISE(ABORT,'Sellable billing provider offer requires published catalog'); END;
    CREATE TRIGGER billing_provider_commercial_offers_final_sellable BEFORE UPDATE OF lifecycle_state ON billing_provider_commercial_offers WHEN OLD.lifecycle_state='sellable' AND NEW.lifecycle_state='retired' AND EXISTS(SELECT 1 FROM billing_catalog_entries WHERE id=OLD.catalog_entry_id AND publication_state='published') AND NOT EXISTS(SELECT 1 FROM billing_provider_commercial_offers WHERE catalog_entry_id=OLD.catalog_entry_id AND lifecycle_state='sellable' AND id!=OLD.id) BEGIN SELECT RAISE(ABORT,'Published billing catalog requires a sellable provider offer'); END;
    CREATE TRIGGER billing_catalog_entries_publication BEFORE UPDATE OF publication_state ON billing_catalog_entries WHEN OLD.publication_state='draft' AND NEW.publication_state='published' AND NOT EXISTS(SELECT 1 FROM billing_provider_commercial_offers WHERE catalog_entry_id=OLD.id AND readiness_state='ready' AND lifecycle_state='draft') BEGIN SELECT RAISE(ABORT,'Published billing catalog requires a ready draft provider offer'); END;
    INSERT INTO billing_provider_commercial_offers(id,catalog_entry_id,provider_kind,offer_version,currency,amount_minor,billing_interval,provider_plan_reference,readiness_state,lifecycle_state,version,created_at,updated_at)
      SELECT 'bpco_' || lower(hex(randomblob(16))),id,provider_kind,1,currency,amount_minor,billing_interval,provider_price_id,'ready',CASE WHEN publication_state='published' THEN 'sellable' ELSE 'retired' END,1,created_at,created_at
      FROM billing_catalog_entries WHERE provider_kind IS NOT NULL AND provider_price_id IS NOT NULL AND amount_minor>0;
    ALTER TABLE billing_subscriptions ADD COLUMN provider_commercial_offer_id TEXT REFERENCES billing_provider_commercial_offers(id) ON DELETE RESTRICT;
    UPDATE billing_subscriptions SET provider_commercial_offer_id=(SELECT o.id FROM billing_provider_commercial_offers o WHERE o.catalog_entry_id=billing_subscriptions.catalog_entry_id AND o.provider_kind=billing_subscriptions.provider_kind ORDER BY o.offer_version LIMIT 1) WHERE catalog_entry_id IS NOT NULL AND provider_kind IS NOT NULL;
    CREATE TRIGGER billing_subscriptions_provider_offer_scope_insert BEFORE INSERT ON billing_subscriptions WHEN NEW.provider_commercial_offer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM billing_provider_commercial_offers o WHERE o.id=NEW.provider_commercial_offer_id AND o.catalog_entry_id=NEW.catalog_entry_id AND o.provider_kind=NEW.provider_kind) BEGIN SELECT RAISE(ABORT,'Billing subscription provider offer is incompatible'); END;
    CREATE TRIGGER billing_subscriptions_provider_offer_scope_update BEFORE UPDATE OF catalog_entry_id,provider_kind,provider_commercial_offer_id ON billing_subscriptions WHEN NEW.provider_commercial_offer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM billing_provider_commercial_offers o WHERE o.id=NEW.provider_commercial_offer_id AND o.catalog_entry_id=NEW.catalog_entry_id AND o.provider_kind=NEW.provider_kind) BEGIN SELECT RAISE(ABORT,'Billing subscription provider offer is incompatible'); END;
    ALTER TABLE billing_operations ADD COLUMN provider_commercial_offer_id TEXT REFERENCES billing_provider_commercial_offers(id) ON DELETE RESTRICT;
    UPDATE billing_operations SET provider_commercial_offer_id=(SELECT o.id FROM billing_provider_commercial_offers o WHERE o.catalog_entry_id=billing_operations.catalog_entry_id AND o.provider_kind=billing_operations.provider_kind ORDER BY o.offer_version LIMIT 1) WHERE operation_kind='checkout_session_create' AND catalog_entry_id IS NOT NULL;
    ALTER TABLE billing_checkout_enrollments ADD COLUMN provider_commercial_offer_id TEXT REFERENCES billing_provider_commercial_offers(id) ON DELETE RESTRICT;
    UPDATE billing_checkout_enrollments SET provider_commercial_offer_id=(SELECT o.id FROM billing_provider_commercial_offers o WHERE o.catalog_entry_id=billing_checkout_enrollments.catalog_entry_id AND o.provider_kind=billing_checkout_enrollments.provider_kind ORDER BY o.offer_version LIMIT 1);
    CREATE TRIGGER billing_checkout_enrollments_provider_offer_backfill AFTER INSERT ON billing_checkout_enrollments WHEN NEW.provider_commercial_offer_id IS NULL BEGIN UPDATE billing_checkout_enrollments SET provider_commercial_offer_id=(SELECT o.id FROM billing_provider_commercial_offers o WHERE o.catalog_entry_id=NEW.catalog_entry_id AND o.provider_kind=NEW.provider_kind AND o.lifecycle_state='sellable' AND o.readiness_state='ready' ORDER BY o.offer_version DESC LIMIT 1) WHERE id=NEW.id; END;
    CREATE TRIGGER billing_checkout_enrollments_provider_offer_scope_insert BEFORE INSERT ON billing_checkout_enrollments WHEN NEW.provider_commercial_offer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM billing_provider_commercial_offers o WHERE o.id=NEW.provider_commercial_offer_id AND o.catalog_entry_id=NEW.catalog_entry_id AND o.provider_kind=NEW.provider_kind) BEGIN SELECT RAISE(ABORT,'Billing checkout provider offer is incompatible'); END;
    CREATE UNIQUE INDEX uq_billing_open_checkout_enrollment ON billing_checkout_enrollments(billing_account_id) WHERE status IN ('pending','ready');
    CREATE UNIQUE INDEX uq_billing_open_checkout_operation ON billing_operations(billing_account_id) WHERE operation_kind='checkout_session_create' AND status IN ('pending','request_started','uncertain');
    CREATE TABLE billing_catalog_inclusions(
      catalog_entry_id TEXT NOT NULL REFERENCES billing_catalog_entries(id) ON DELETE RESTRICT,
      inclusion_code TEXT NOT NULL CHECK(inclusion_code IN ('knowledge','scheduling','proactive_actions','whatsapp','web_chat','automation','priority_support')),
      display_title TEXT NOT NULL CHECK(length(display_title) BETWEEN 1 AND 160),
      display_description TEXT NOT NULL DEFAULT '' CHECK(length(display_description)<=1000),
      sort_order INTEGER NOT NULL CHECK(sort_order>=0),
      PRIMARY KEY(catalog_entry_id,inclusion_code),
      UNIQUE(catalog_entry_id,sort_order)
    );
    CREATE TRIGGER billing_catalog_inclusions_immutable BEFORE UPDATE ON billing_catalog_inclusions WHEN (SELECT publication_state FROM billing_catalog_entries WHERE id=OLD.catalog_entry_id)!='draft' BEGIN SELECT RAISE(ABORT,'Published billing catalog inclusions are immutable'); END;
    CREATE TRIGGER billing_catalog_inclusions_no_delete BEFORE DELETE ON billing_catalog_inclusions WHEN (SELECT publication_state FROM billing_catalog_entries WHERE id=OLD.catalog_entry_id)!='draft' BEGIN SELECT RAISE(ABORT,'Published billing catalog inclusions are immutable'); END;
    CREATE TABLE billing_catalog_operations(
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 80),catalog_entry_id TEXT NOT NULL REFERENCES billing_catalog_entries(id) ON DELETE RESTRICT,operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 200),request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'),expected_version INTEGER NOT NULL CHECK(expected_version>0),resulting_version INTEGER CHECK(resulting_version IS NULL OR resulting_version>0),actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,outcome TEXT NOT NULL CHECK(outcome IN ('applied','conflict','invalid')),safe_result_json TEXT NOT NULL CHECK(json_valid(safe_result_json) AND length(safe_result_json)<=4096),occurred_at TEXT NOT NULL,UNIQUE(catalog_entry_id,operation_id)
    );
    CREATE INDEX idx_billing_catalog_operations_catalog ON billing_catalog_operations(catalog_entry_id,occurred_at,id);
    CREATE TRIGGER billing_catalog_operations_no_update BEFORE UPDATE ON billing_catalog_operations BEGIN SELECT RAISE(ABORT,'Billing catalog operations are append-only'); END;
    CREATE TRIGGER billing_catalog_operations_no_delete BEFORE DELETE ON billing_catalog_operations BEGIN SELECT RAISE(ABORT,'Billing catalog operations are append-only'); END;
    CREATE TABLE billing_catalog_audit_events(
      id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 80),catalog_entry_id TEXT NOT NULL REFERENCES billing_catalog_entries(id) ON DELETE RESTRICT,operation_id TEXT NOT NULL,actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 100),old_value_json TEXT NOT NULL CHECK(json_valid(old_value_json) AND length(old_value_json)<=4096),new_value_json TEXT NOT NULL CHECK(json_valid(new_value_json) AND length(new_value_json)<=4096),resulting_version INTEGER NOT NULL CHECK(resulting_version>0),occurred_at TEXT NOT NULL,FOREIGN KEY(catalog_entry_id,operation_id) REFERENCES billing_catalog_operations(catalog_entry_id,operation_id) ON DELETE RESTRICT
    );
    CREATE INDEX idx_billing_catalog_audit_catalog ON billing_catalog_audit_events(catalog_entry_id,occurred_at,id);
    CREATE TRIGGER billing_catalog_audit_events_no_update BEFORE UPDATE ON billing_catalog_audit_events BEGIN SELECT RAISE(ABORT,'Billing catalog audit events are append-only'); END;
    CREATE TRIGGER billing_catalog_audit_events_no_delete BEFORE DELETE ON billing_catalog_audit_events BEGIN SELECT RAISE(ABORT,'Billing catalog audit events are append-only'); END;
    ALTER TABLE billing_provider_events ADD COLUMN billing_account_id TEXT REFERENCES billing_accounts(id) ON DELETE SET NULL;
    ALTER TABLE billing_provider_events ADD COLUMN safe_failure_code TEXT CHECK(safe_failure_code IS NULL OR length(safe_failure_code) BETWEEN 1 AND 100);
    CREATE INDEX idx_billing_provider_events_account_received ON billing_provider_events(billing_account_id,received_at DESC,id DESC);
  `);}},
  { id:75,name:"0075_activation_verification_attempts",checksumSource:"activation-projection-web-chat-verification-session-bound-persisted-turn-outcome-v2",apply(database):void{database.exec(`
    CREATE TABLE activation_verification_attempts(
      id TEXT PRIMARY KEY CHECK(length(id)=36 AND substr(id,1,4)='ava_'),workspace_id INTEGER NOT NULL,company_id INTEGER NOT NULL,web_chat_connection_id TEXT NOT NULL,
      token_digest TEXT NOT NULL UNIQUE CHECK(length(token_digest)=64 AND token_digest NOT GLOB '*[^0-9a-f]*'),status TEXT NOT NULL CHECK(status IN ('pending','succeeded','failed','expired')),
      created_at TEXT NOT NULL,expires_at TEXT NOT NULL,claimed_at TEXT,web_chat_session_id TEXT REFERENCES web_chat_sessions(id) ON DELETE RESTRICT,conversation_id TEXT REFERENCES conversations(id) ON DELETE RESTRICT,inbound_message_id TEXT REFERENCES conversation_messages(id) ON DELETE RESTRICT,execution_record_id TEXT REFERENCES assistant_execution_records(id) ON DELETE RESTRICT,outcome_ref TEXT CHECK(outcome_ref IS NULL OR outcome_ref IN ('answered','safe_fallback')),completed_at TEXT,failure_code TEXT CHECK(failure_code IS NULL OR failure_code='runtime_failure'),
      FOREIGN KEY(workspace_id,company_id) REFERENCES companies(workspace_id,id) ON DELETE CASCADE,FOREIGN KEY(web_chat_connection_id) REFERENCES web_chat_connections(id) ON DELETE CASCADE,
      CHECK(expires_at>created_at),CHECK((claimed_at IS NULL AND web_chat_session_id IS NULL AND conversation_id IS NULL) OR (claimed_at IS NOT NULL AND web_chat_session_id IS NOT NULL AND conversation_id IS NOT NULL)),CHECK((status='pending' AND completed_at IS NULL AND inbound_message_id IS NULL AND execution_record_id IS NULL AND outcome_ref IS NULL AND failure_code IS NULL) OR (status='succeeded' AND claimed_at IS NOT NULL AND completed_at IS NOT NULL AND inbound_message_id IS NOT NULL AND execution_record_id IS NOT NULL AND outcome_ref IS NOT NULL AND failure_code IS NULL) OR (status='failed' AND claimed_at IS NOT NULL AND completed_at IS NOT NULL AND inbound_message_id IS NULL AND execution_record_id IS NULL AND outcome_ref IS NULL AND failure_code='runtime_failure') OR (status='expired' AND claimed_at IS NULL AND completed_at IS NOT NULL AND inbound_message_id IS NULL AND execution_record_id IS NULL AND outcome_ref IS NULL AND failure_code IS NULL))
    );
    CREATE INDEX idx_activation_verification_attempts_company_connection ON activation_verification_attempts(workspace_id,company_id,web_chat_connection_id,created_at DESC,id DESC);
    CREATE TRIGGER activation_verification_attempt_scope_insert BEFORE INSERT ON activation_verification_attempts WHEN NOT EXISTS(SELECT 1 FROM web_chat_connections WHERE id=NEW.web_chat_connection_id AND workspace_id=NEW.workspace_id AND company_id=NEW.company_id) BEGIN SELECT RAISE(ABORT,'Activation verification attempt scope is invalid'); END;
    CREATE TRIGGER activation_verification_attempts_no_delete BEFORE DELETE ON activation_verification_attempts BEGIN SELECT RAISE(ABORT,'Activation verification attempts are immutable'); END;
  `);}},
];

function migrationChecksum(migration: Migration): string {
  return createHash("sha256")
    .update(`${migration.id}:${migration.name}:${migration.checksumSource}`)
    .digest("hex");
}

const retiredMigrations = new Map<number, { readonly name: string; readonly checksum: string }>([
  [61, { name: "0061_voice_audio_upload_reservation", checksum: "56ed576cbc89fef1304834bb20dcb38cb49498460154045193421176e0ee6940" }],
]);

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
      const retired = retiredMigrations.get(applied.id);
      if (retired?.name === applied.name && retired.checksum === applied.checksum) continue;
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
