import type { SqlDatabase } from "../../config/sqlDatabase.js";
import type { CompanyKnowledge } from "../../types/companyKnowledge.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { KnowledgeRepositoryPort } from "../application/ports.js";
import { KnowledgeDomainError, validateExtractedBusinessKnowledge, validateStoredCompanyKnowledgeJson, type CompanyKnowledgeVersion, type ExtractedBusinessKnowledge, type KnowledgeSource, type KnowledgeSourceKind, type KnowledgeSourceRevision } from "../domain/knowledge.js";
import type { KnowledgeRetrievalRepositoryPort } from "../../knowledgeV2/application/ports.js";
import { knowledgeV2Id, type KnowledgeChunkV2, type KnowledgeDocumentV2, type KnowledgeIndexV2 } from "../../knowledgeV2/domain/knowledgeRetrieval.js";

type Row = Record<string, string | number | null>;
type PublicationResult = { status: "created" | "idempotent" | "changed"; version?: CompanyKnowledgeVersion };
type PublicationFault = (point: "version_insert" | "manifest_insert" | "publication_write" | "company_status") => void;

const sourceSelect = "SELECT s.* FROM knowledge_sources s JOIN companies co ON co.id=s.company_id";
const revisionSelect = "SELECT r.* FROM knowledge_source_revisions r JOIN knowledge_sources s ON s.id=r.source_id JOIN companies co ON co.id=s.company_id";

export class AsyncCompanyKnowledgeRepository implements KnowledgeRepositoryPort {
  public constructor(private readonly database: SqlDatabase, private readonly publicationFault?: PublicationFault) {}

  public async listSources(context: WorkspaceContext, companyId: number): Promise<KnowledgeSource[]> {
    return (await this.database.query<Row>(`${sourceSelect} WHERE co.workspace_id=? AND co.id=? ORDER BY s.created_at DESC,s.id DESC`, [context.workspaceId, companyId])).map(source);
  }

  public async findSource(context: WorkspaceContext, companyId: number, sourceId: string): Promise<KnowledgeSource | null> {
    const rows = await this.database.query<Row>(`${sourceSelect} WHERE co.workspace_id=? AND co.id=? AND s.id=?`, [context.workspaceId, companyId, sourceId]);
    return rows[0] ? source(rows[0]) : null;
  }

  public async findRevision(context: WorkspaceContext, companyId: number, sourceId: string, revisionId: string): Promise<KnowledgeSourceRevision | null> {
    const rows = await this.database.query<Row>(`${revisionSelect} WHERE co.workspace_id=? AND co.id=? AND s.id=? AND r.id=?`, [context.workspaceId, companyId, sourceId, revisionId]);
    return rows[0] ? revision(rows[0]) : null;
  }

  public async latestRevision(context: WorkspaceContext, companyId: number, sourceId: string): Promise<KnowledgeSourceRevision | null> {
    const rows = await this.database.query<Row>(`${revisionSelect} WHERE co.workspace_id=? AND co.id=? AND s.id=? ORDER BY r.revision_number DESC LIMIT 1`, [context.workspaceId, companyId, sourceId]);
    return rows[0] ? revision(rows[0]) : null;
  }

  public async findRevisions(context: WorkspaceContext, companyId: number, revisionIds: readonly string[]): Promise<KnowledgeSourceRevision[]> {
    if (!revisionIds.length) return [];
    const placeholders = revisionIds.map(() => "?").join(",");
    return (await this.database.query<Row>(`${revisionSelect} WHERE co.workspace_id=? AND co.id=? AND r.id IN (${placeholders})`, [context.workspaceId, companyId, ...revisionIds])).map(revision);
  }

  public async createSourceAndPending(context: WorkspaceContext, companyId: number, input: { id: string; revisionId: string; kind: KnowledgeSourceKind; name: string; normalizedName: string; locator: string | null; mediaType: string; inputBytes: number; createdAt: string }): Promise<{ source: KnowledgeSource; revision: KnowledgeSourceRevision }> {
    await this.transaction(async database => {
      if (!(await database.query<{ id: number }>("SELECT id FROM companies WHERE workspace_id=? AND id=?", [context.workspaceId, companyId])).length) throw new KnowledgeDomainError("resource_not_found");
      const count = await database.query<{ count: number }>("SELECT COUNT(*) count FROM knowledge_sources WHERE company_id=?", [companyId]);
      if (Number(count[0]?.count ?? 0) >= 50) throw new KnowledgeDomainError("knowledge_limit_exceeded");
      await database.execute("INSERT INTO knowledge_sources VALUES(?,?,?,'user',?,?,?,'active',1,?,?,NULL)", [input.id, companyId, input.kind, input.name, input.normalizedName, input.locator, input.createdAt, input.createdAt]);
      await database.execute("INSERT INTO knowledge_source_revisions(id,source_id,revision_number,status,media_type,extractor_schema_version,input_bytes,created_at) VALUES(?,?,1,'pending',?,'company-business-knowledge-v1',?,?)", [input.revisionId, input.id, input.mediaType, input.inputBytes, input.createdAt]);
      await database.execute("UPDATE companies SET status='processing' WHERE id=? AND NOT EXISTS(SELECT 1 FROM company_knowledge_publications WHERE company_id=?)", [companyId, companyId]);
    });
    const createdSource = await this.findSource(context, companyId, input.id);
    const createdRevision = await this.findRevision(context, companyId, input.id, input.revisionId);
    if (!createdSource || !createdRevision) throw new Error("Knowledge source could not be read after creation.");
    return { source: createdSource, revision: createdRevision };
  }

  public async reserveRevision(context: WorkspaceContext, companyId: number, input: { sourceId: string; revisionId: string; locator: string | null; expectedSourceVersion: number; mediaType: string; inputBytes: number; createdAt: string; abandonedBefore: string }): Promise<KnowledgeSourceRevision> {
    await this.transaction(async database => {
      const repository = new AsyncCompanyKnowledgeRepository(database);
      const current = await repository.findSource(context, companyId, input.sourceId);
      if (!current) throw new KnowledgeDomainError("resource_not_found");
      if (current.status !== "active") throw new KnowledgeDomainError("source_archived");
      await database.execute("UPDATE knowledge_source_revisions SET status='failed',failure_code='ingestion_interrupted',completed_at=? WHERE source_id=? AND status='pending' AND created_at<=?", [input.createdAt, input.sourceId, input.abandonedBefore]);
      if ((await database.query<{ id: string }>("SELECT id FROM knowledge_source_revisions WHERE source_id=? AND status='pending'", [input.sourceId])).length) throw new KnowledgeDomainError("knowledge_ingestion_in_progress");
      const next = await database.query<{ number: number }>("SELECT COALESCE(MAX(revision_number),0)+1 number FROM knowledge_source_revisions WHERE source_id=?", [input.sourceId]);
      const changed = await database.execute("UPDATE knowledge_sources SET locator=?,version=version+1,updated_at=? WHERE id=? AND company_id=? AND version=?", [input.locator, input.createdAt, input.sourceId, companyId, input.expectedSourceVersion]);
      if (Number(changed.rowsAffected) !== 1) throw new KnowledgeDomainError("knowledge_source_changed");
      await database.execute("INSERT INTO knowledge_source_revisions(id,source_id,revision_number,status,media_type,extractor_schema_version,input_bytes,created_at) VALUES(?,?,?,'pending',?,'company-business-knowledge-v1',?,?)", [input.revisionId, input.sourceId, Number(next[0]?.number ?? 1), input.mediaType, input.inputBytes, input.createdAt]);
      await database.execute("UPDATE companies SET status='processing' WHERE id=? AND NOT EXISTS(SELECT 1 FROM company_knowledge_publications WHERE company_id=?)", [companyId, companyId]);
    });
    const created = await this.findRevision(context, companyId, input.sourceId, input.revisionId);
    if (!created) throw new Error("Knowledge revision could not be read after creation.");
    return created;
  }

  public async completeRevision(context: WorkspaceContext, companyId: number, revisionId: string, input: { contentDigest: string; normalizedText: string; extracted: ExtractedBusinessKnowledge; normalizedBytes: number; normalizedCharacters: number; pageCount: number | null; completedAt: string }): Promise<boolean> {
    const result = await this.database.execute("UPDATE knowledge_source_revisions SET status='ready',content_digest=?,normalized_text=?,extracted_knowledge_json=?,normalized_bytes=?,normalized_characters=?,page_count=?,completed_at=? WHERE id=? AND status='pending' AND source_id IN(SELECT s.id FROM knowledge_sources s JOIN companies co ON co.id=s.company_id WHERE co.workspace_id=? AND co.id=?)", [input.contentDigest, input.normalizedText, JSON.stringify(input.extracted), input.normalizedBytes, input.normalizedCharacters, input.pageCount, input.completedAt, revisionId, context.workspaceId, companyId]);
    return Number(result.rowsAffected) === 1;
  }

  public async failRevision(context: WorkspaceContext, companyId: number, revisionId: string, failureCode: string, completedAt: string): Promise<boolean> {
    return this.transaction(async database => {
      const result = await database.execute("UPDATE knowledge_source_revisions SET status='failed',failure_code=?,completed_at=? WHERE id=? AND status='pending' AND source_id IN(SELECT s.id FROM knowledge_sources s JOIN companies co ON co.id=s.company_id WHERE co.workspace_id=? AND co.id=?)", [failureCode, completedAt, revisionId, context.workspaceId, companyId]);
      if (Number(result.rowsAffected) === 1) await database.execute("UPDATE companies SET status='failed' WHERE id=? AND NOT EXISTS(SELECT 1 FROM company_knowledge_publications WHERE company_id=?) AND NOT EXISTS(SELECT 1 FROM knowledge_source_revisions r JOIN knowledge_sources s ON s.id=r.source_id WHERE s.company_id=? AND r.status='pending')", [companyId, companyId, companyId]);
      return Number(result.rowsAffected) === 1;
    });
  }

  public async archiveSource(context: WorkspaceContext, companyId: number, sourceId: string, expectedVersion: number, at: string): Promise<KnowledgeSource | null> {
    const result = await this.database.execute("UPDATE knowledge_sources SET status='archived',version=version+1,updated_at=?,archived_at=? WHERE id=? AND company_id IN(SELECT id FROM companies WHERE workspace_id=? AND id=?) AND version=? AND status='active' AND NOT EXISTS(SELECT 1 FROM knowledge_source_revisions WHERE source_id=? AND status='pending')", [at, at, sourceId, context.workspaceId, companyId, expectedVersion, sourceId]);
    return Number(result.rowsAffected) === 1 ? this.findSource(context, companyId, sourceId) : null;
  }

  public async loadPublished(context: WorkspaceContext, companyId: number): Promise<CompanyKnowledge | null> {
    const rows = await this.database.query<{ knowledge_json: string }>("SELECT v.knowledge_json FROM companies co JOIN company_knowledge_publications p ON p.company_id=co.id JOIN company_knowledge_versions v ON v.id=p.knowledge_version_id AND v.company_id=co.id WHERE co.workspace_id=? AND co.id=?", [context.workspaceId, companyId]);
    return rows[0] ? validateStoredCompanyKnowledgeJson(rows[0].knowledge_json) : null;
  }

  public async load(context: WorkspaceContext, companyId: number): Promise<CompanyKnowledge | null> {
    return this.loadPublished(context, companyId);
  }

  public async loadCurrentVersion(context: WorkspaceContext, companyId: number): Promise<CompanyKnowledgeVersion | null> {
    const rows = await this.database.query<Row>("SELECT v.*,p.publication_version FROM companies co JOIN company_knowledge_publications p ON p.company_id=co.id JOIN company_knowledge_versions v ON v.id=p.knowledge_version_id WHERE co.workspace_id=? AND co.id=?", [context.workspaceId, companyId]);
    if (!rows[0]) return null;
    const revisionIds = (await this.database.query<{ source_revision_id: string }>("SELECT source_revision_id FROM company_knowledge_version_sources WHERE knowledge_version_id=? ORDER BY ordinal", [String(rows[0].id)])).map(row => row.source_revision_id);
    return version(rows[0], revisionIds);
  }

  public async publish(context: WorkspaceContext, companyId: number, input: { expectedVersionId: string | null; versionId: string; snapshotDigest: string; canonicalJson: string; revisionIds: readonly string[]; actorId: string; at: string }): Promise<PublicationResult> {
    return this.transaction(async database => {
      const repository = new AsyncCompanyKnowledgeRepository(database, this.publicationFault);
      if (!(await database.query<{ id: number }>("SELECT id FROM companies WHERE workspace_id=? AND id=?", [context.workspaceId, companyId])).length) throw new KnowledgeDomainError("resource_not_found");
      validateStoredCompanyKnowledgeJson(input.canonicalJson);
      const current = await repository.loadCurrentVersion(context, companyId);
      if (current?.snapshotDigest === input.snapshotDigest) return { status: "idempotent", version: current };
      if ((current?.id ?? null) !== input.expectedVersionId) return { status: "changed" };
      if ((await database.query<{ id: string }>("SELECT id FROM company_knowledge_versions WHERE company_id=? AND snapshot_digest=?", [companyId, input.snapshotDigest])).length) throw new KnowledgeDomainError("knowledge_historical_version_conflict");
      const revisions = await repository.findRevisions(context, companyId, input.revisionIds);
      if (revisions.length !== input.revisionIds.length || revisions.some(item => item.status !== "ready")) throw new KnowledgeDomainError("source_revision_not_ready");
      const placeholders = input.revisionIds.map(() => "?").join(",");
      const archived = await database.query<{ count: number }>(`SELECT COUNT(*) count FROM knowledge_source_revisions r JOIN knowledge_sources s ON s.id=r.source_id WHERE r.id IN (${placeholders}) AND s.status!='active'`, input.revisionIds);
      if (Number(archived[0]?.count ?? 0)) throw new KnowledgeDomainError("source_archived");
      const next = await database.query<{ number: number }>("SELECT COALESCE(MAX(version_number),0)+1 number FROM company_knowledge_versions WHERE company_id=?", [companyId]);
      await database.execute("INSERT INTO company_knowledge_versions VALUES(?,?,?,'company-knowledge-compiler-v1',?,?,?,?)", [input.versionId, companyId, Number(next[0]?.number ?? 1), input.canonicalJson, input.snapshotDigest, input.actorId, input.at]);
      this.publicationFault?.("version_insert");
      for (const [ordinal, revisionId] of input.revisionIds.entries()) {
        await database.execute("INSERT INTO company_knowledge_version_sources VALUES(?,?,?)", [input.versionId, revisionId, ordinal + 1]);
        this.publicationFault?.("manifest_insert");
      }
      await database.execute("INSERT INTO company_knowledge_publications(company_id,knowledge_version_id,publication_version,published_by_actor_id,published_at) VALUES(?,?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET knowledge_version_id=excluded.knowledge_version_id,publication_version=company_knowledge_publications.publication_version+1,published_by_actor_id=excluded.published_by_actor_id,published_at=excluded.published_at", [companyId, input.versionId, 1, input.actorId, input.at]);
      this.publicationFault?.("publication_write");
      await database.execute("UPDATE companies SET status='ready' WHERE id=?", [companyId]);
      this.publicationFault?.("company_status");
      const created = await repository.loadCurrentVersion(context, companyId);
      if (!created) throw new Error("Knowledge publication could not be read after creation.");
      return { status: "created", version: created };
    });
  }

  private async transaction<T>(operation: (database: SqlDatabase) => Promise<T>): Promise<T> {
    try {
      return await this.database.transaction(operation);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "";
      if (/database is locked|SQLITE_BUSY/i.test(message)) throw new KnowledgeDomainError("knowledge_temporarily_unavailable");
      if (/knowledge_sources\.company_id, knowledge_sources\.normalized_name/i.test(message)) throw new KnowledgeDomainError("knowledge_source_name_conflict");
      if (/idx_knowledge_revision_pending/i.test(message)) throw new KnowledgeDomainError("knowledge_ingestion_in_progress");
      throw error;
    }
  }
}

export class AsyncKnowledgeRetrievalRepository implements KnowledgeRetrievalRepositoryPort {
  public constructor(private readonly database: SqlDatabase) {}

  public async replaceRevision(context: WorkspaceContext, companyId: number, input: { sourceId: string; sourceRevisionId: string; contentDigest: string; normalizedText: string; createdAt: string; chunks: readonly { text: string; characterStart: number; characterEnd: number }[] }): Promise<KnowledgeIndexV2> {
    const documentId = knowledgeV2Id("kdoc", `${companyId}\n${input.sourceRevisionId}\n${input.contentDigest}`), indexId = knowledgeV2Id("kidx", documentId);
    await this.database.transaction(async database => {
      await database.execute("DELETE FROM knowledge_v2_documents WHERE workspace_id=? AND company_id=? AND source_revision_id=?", [context.workspaceId, companyId, input.sourceRevisionId]);
      await database.execute("INSERT INTO knowledge_v2_documents VALUES(?,?,?,?,?,?,?,?)", [documentId, context.workspaceId, companyId, input.sourceId, input.sourceRevisionId, input.contentDigest, input.normalizedText, input.createdAt]);
      await database.execute("INSERT INTO knowledge_v2_indexes VALUES(?,?,?,?,?,'lexical','building',?,?,NULL)", [indexId, context.workspaceId, companyId, input.sourceRevisionId, documentId, input.chunks.length, input.createdAt]);
      for (const [ordinal, item] of input.chunks.entries()) {
        const chunkId = knowledgeV2Id("kchk", `${documentId}\n${ordinal}\n${item.text}`), bytes = Buffer.byteLength(item.text, "utf8");
        await database.execute("INSERT INTO knowledge_v2_chunks VALUES(?,?,?,?,?,?,?,?)", [chunkId, documentId, context.workspaceId, companyId, ordinal, item.text, item.text.normalize("NFKC").toLocaleLowerCase("en-US"), bytes]);
        await database.execute("INSERT INTO knowledge_v2_chunk_provenance VALUES(?,?,?,?,?)", [chunkId, input.sourceRevisionId, input.contentDigest, item.characterStart, item.characterEnd]);
      }
      await database.execute("UPDATE knowledge_v2_indexes SET status='ready',completed_at=? WHERE id=?", [input.createdAt, indexId]);
    });
    const index = await this.index(context, companyId, input.sourceRevisionId);
    if (!index) throw new Error("Knowledge index could not be read after replacement.");
    return index;
  }

  public async readyForRevisions(context: WorkspaceContext, companyId: number, revisionIds: readonly string[]): Promise<boolean> {
    if (!revisionIds.length) return false;
    const placeholders = revisionIds.map(() => "?").join(","), rows = await this.database.query<{ count: number }>(`SELECT COUNT(*) count FROM knowledge_v2_indexes WHERE workspace_id=? AND company_id=? AND status='ready' AND source_revision_id IN (${placeholders})`, [context.workspaceId, companyId, ...revisionIds]);
    return Number(rows[0]?.count ?? 0) === revisionIds.length;
  }

  public async findReadyChunks(context: WorkspaceContext, companyId: number, revisionIds: readonly string[]): Promise<readonly KnowledgeChunkV2[]> {
    if (!revisionIds.length) return [];
    const placeholders = revisionIds.map(() => "?").join(",");
    return (await this.database.query<Row>(`SELECT ch.*,p.source_revision_id,p.content_digest,p.character_start,p.character_end FROM knowledge_v2_chunks ch JOIN knowledge_v2_chunk_provenance p ON p.chunk_id=ch.id JOIN knowledge_v2_indexes i ON i.document_id=ch.document_id JOIN knowledge_v2_documents d ON d.id=ch.document_id JOIN knowledge_sources s ON s.id=d.source_id WHERE ch.workspace_id=? AND ch.company_id=? AND s.status='active' AND i.status='ready' AND i.source_revision_id IN (${placeholders}) ORDER BY ch.document_id,ch.ordinal`, [context.workspaceId, companyId, ...revisionIds])).map(retrievalChunk);
  }

  public async findDocument(context: WorkspaceContext, companyId: number, sourceRevisionId: string): Promise<KnowledgeDocumentV2 | null> {
    const rows = await this.database.query<Row>("SELECT * FROM knowledge_v2_documents WHERE workspace_id=? AND company_id=? AND source_revision_id=?", [context.workspaceId, companyId, sourceRevisionId]);
    return rows[0] ? retrievalDocument(rows[0]) : null;
  }

  private async index(context: WorkspaceContext, companyId: number, sourceRevisionId: string): Promise<KnowledgeIndexV2 | null> {
    const rows = await this.database.query<Row>("SELECT * FROM knowledge_v2_indexes WHERE workspace_id=? AND company_id=? AND source_revision_id=?", [context.workspaceId, companyId, sourceRevisionId]), row = rows[0];
    return row ? { id: String(row.id), workspaceId: Number(row.workspace_id), companyId: Number(row.company_id), sourceRevisionId: String(row.source_revision_id), documentId: String(row.document_id), kind: "lexical", status: String(row.status) as KnowledgeIndexV2["status"], chunkCount: Number(row.chunk_count), createdAt: String(row.created_at), completedAt: row.completed_at === null ? null : String(row.completed_at) } : null;
  }
}

function source(row: Row): KnowledgeSource {
  return { id: String(row.id), companyId: Number(row.company_id), kind: String(row.kind) as KnowledgeSourceKind, origin: String(row.origin) as KnowledgeSource["origin"], name: String(row.name), normalizedName: String(row.normalized_name), locator: row.locator === null ? null : String(row.locator), status: String(row.status) as KnowledgeSource["status"], version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at), archivedAt: row.archived_at === null ? null : String(row.archived_at) };
}

function parseStoredJson(value: string): unknown {
  try { return JSON.parse(value); } catch { throw new KnowledgeDomainError("knowledge_integrity_failure"); }
}

function revision(row: Row): KnowledgeSourceRevision {
  return { id: String(row.id), sourceId: String(row.source_id), revisionNumber: Number(row.revision_number), status: String(row.status) as KnowledgeSourceRevision["status"], mediaType: String(row.media_type), contentDigest: row.content_digest === null ? null : String(row.content_digest), normalizedText: row.normalized_text === null ? null : String(row.normalized_text), extractedKnowledge: row.extracted_knowledge_json === null ? null : validateExtractedBusinessKnowledge(parseStoredJson(String(row.extracted_knowledge_json))), extractorSchemaVersion: "company-business-knowledge-v1", inputBytes: Number(row.input_bytes), normalizedBytes: row.normalized_bytes === null ? null : Number(row.normalized_bytes), normalizedCharacters: row.normalized_characters === null ? null : Number(row.normalized_characters), pageCount: row.page_count === null ? null : Number(row.page_count), failureCode: row.failure_code === null ? null : String(row.failure_code), createdAt: String(row.created_at), completedAt: row.completed_at === null ? null : String(row.completed_at) };
}

function version(row: Row, sourceRevisionIds: readonly string[]): CompanyKnowledgeVersion {
  return { id: String(row.id), companyId: Number(row.company_id), versionNumber: Number(row.version_number), compilerVersion: "company-knowledge-compiler-v1", knowledge: validateStoredCompanyKnowledgeJson(String(row.knowledge_json)), snapshotDigest: String(row.snapshot_digest), publishedByActorId: String(row.published_by_actor_id), publishedAt: String(row.published_at), sourceRevisionIds, publicationVersion: Number(row.publication_version) };
}

function retrievalDocument(row: Row): KnowledgeDocumentV2 { return { id: String(row.id), workspaceId: Number(row.workspace_id), companyId: Number(row.company_id), sourceId: String(row.source_id), sourceRevisionId: String(row.source_revision_id), contentDigest: String(row.content_digest), normalizedText: String(row.normalized_text), createdAt: String(row.created_at) }; }
function retrievalChunk(row: Row): KnowledgeChunkV2 { return { id: String(row.id), documentId: String(row.document_id), workspaceId: Number(row.workspace_id), companyId: Number(row.company_id), ordinal: Number(row.ordinal), text: String(row.text), normalizedText: String(row.normalized_text), byteLength: Number(row.byte_length), sourceRevisionId: String(row.source_revision_id), contentDigest: String(row.content_digest), characterStart: Number(row.character_start), characterEnd: Number(row.character_end) }; }
