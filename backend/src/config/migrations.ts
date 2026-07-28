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
