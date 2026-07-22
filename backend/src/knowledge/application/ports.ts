import type { CompanyKnowledge } from "../../types/companyKnowledge.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { CompanyKnowledgeVersion, CurrentKnowledgePublication, ExtractedBusinessKnowledge, KnowledgeSource, KnowledgeSourceKind, KnowledgeSourceRevision } from "../domain/knowledge.js";

export interface AcquiredText { readonly text: string; readonly mediaType: string; readonly inputBytes: number; readonly finalUrl?: string; readonly pageCount?: number; }
export interface PublicUrlContentProvider { acquire(url: string, signal: AbortSignal): Promise<AcquiredText>; }
export interface PdfTextExtractor { extract(bytes: Uint8Array, signal: AbortSignal): Promise<AcquiredText>; }
export interface KnowledgeFactExtractor { extract(kind: KnowledgeSourceKind, normalizedText: string, url: string | null, signal: AbortSignal): Promise<unknown>; }

export interface KnowledgeRepositoryPort {
  listSources(context: WorkspaceContext, companyId: number): KnowledgeSource[];
  findSource(context: WorkspaceContext, companyId: number, sourceId: string): KnowledgeSource | null;
  findRevision(context: WorkspaceContext, companyId: number, sourceId: string, revisionId: string): KnowledgeSourceRevision | null;
  latestRevision(context: WorkspaceContext, companyId: number, sourceId: string): KnowledgeSourceRevision | null;
  findRevisions(context: WorkspaceContext, companyId: number, revisionIds: readonly string[]): KnowledgeSourceRevision[];
  createSourceAndPending(context: WorkspaceContext, companyId: number, input: { id: string; revisionId: string; kind: KnowledgeSourceKind; name: string; normalizedName: string; locator: string | null; mediaType: string; inputBytes: number; createdAt: string }): { source: KnowledgeSource; revision: KnowledgeSourceRevision };
  reserveRevision(context: WorkspaceContext, companyId: number, input: { sourceId: string; revisionId: string; locator: string | null; expectedSourceVersion: number; mediaType: string; inputBytes: number; createdAt: string; abandonedBefore: string }): KnowledgeSourceRevision;
  completeRevision(context: WorkspaceContext, companyId: number, revisionId: string, input: { contentDigest: string; normalizedText: string; extracted: ExtractedBusinessKnowledge; normalizedBytes: number; normalizedCharacters: number; pageCount: number | null; completedAt: string }): boolean;
  failRevision(context: WorkspaceContext, companyId: number, revisionId: string, failureCode: string, completedAt: string): boolean;
  archiveSource(context: WorkspaceContext, companyId: number, sourceId: string, expectedVersion: number, at: string): KnowledgeSource | null;
  loadPublished(context: WorkspaceContext, companyId: number): CompanyKnowledge | null;
  loadCurrentVersion(context: WorkspaceContext, companyId: number): CompanyKnowledgeVersion | null;
  publish(context: WorkspaceContext, companyId: number, input: { expectedVersionId: string | null; versionId: string; snapshotDigest: string; canonicalJson: string; revisionIds: readonly string[]; actorId: string; at: string }): { status: "created" | "idempotent" | "changed"; version?: CompanyKnowledgeVersion };
}
