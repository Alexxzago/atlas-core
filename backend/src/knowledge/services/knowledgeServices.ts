import { createHash, randomBytes } from "node:crypto";
import type { Clock } from "../../identity/application/ports.js";
import type { CompanyPersistencePort } from "../../application/ports/repositories.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { ActorContext } from "../domain/actorContext.js";
import { compileCompanyKnowledge } from "../domain/compiler.js";
import { KNOWLEDGE_LIMITS, KnowledgeDomainError, codePoints, comparisonKey, normalizeKnowledgeText, utf8Bytes, validateExtractedBusinessKnowledge, type ExtractedBusinessKnowledge, type KnowledgeSourceKind } from "../domain/knowledge.js";
import type { KnowledgeFactExtractor, KnowledgeRepositoryPort, PdfTextExtractor, PublicUrlContentProvider } from "../application/ports.js";
import { validatePublicUrl } from "../infrastructure/publicUrlProvider.js";
import type { KnowledgeIndexingService } from "../../knowledgeV2/services/knowledgeRetrievalService.js";

export class KnowledgeService {
  public constructor(private readonly companies: CompanyPersistencePort, private readonly repository: KnowledgeRepositoryPort, private readonly urls: PublicUrlContentProvider, private readonly pdf: PdfTextExtractor, private readonly extractor: KnowledgeFactExtractor, private readonly clock: Clock, private readonly timing: Readonly<{ extraction: number; ingestion: number }> = { extraction: KNOWLEDGE_LIMITS.extractionTimeoutMilliseconds, ingestion: KNOWLEDGE_LIMITS.ingestionTimeoutMilliseconds }, private readonly indexing?: KnowledgeIndexingService) {}

  public async list(context: WorkspaceContext, companyIdValue: unknown) {
    const companyId = id(companyIdValue);
    await this.company(context, companyId);
    const included = new Set((await this.repository.loadCurrentVersion(context, companyId))?.sourceRevisionIds ?? []);
    return Promise.all((await this.repository.listSources(context, companyId)).map(async source => {
      const latestRevision = await this.repository.latestRevision(context, companyId, source.id);
      return { ...source, latestRevision, includedRevisionId: latestRevision && included.has(latestRevision.id) ? latestRevision.id : null };
    }));
  }

  public async revision(context: WorkspaceContext, companyIdValue: unknown, sourceId: unknown, revisionId: unknown) {
    const companyId = id(companyIdValue);
    await this.company(context, companyId);
    if (typeof sourceId !== "string" || typeof revisionId !== "string") throw new KnowledgeDomainError("resource_not_found");
    const value = await this.repository.findRevision(context, companyId, sourceId, revisionId);
    if (!value) throw new KnowledgeDomainError("resource_not_found");
    return value;
  }

  public async current(context: WorkspaceContext, companyIdValue: unknown) {
    const companyId = id(companyIdValue);
    await this.company(context, companyId);
    const value = await this.repository.loadCurrentVersion(context, companyId);
    if (!value) throw new KnowledgeDomainError("knowledge_unavailable");
    return value;
  }

  public async create(context: WorkspaceContext, actor: ActorContext, companyIdValue: unknown, kind: KnowledgeSourceKind, input: unknown, rawPdf?: Uint8Array) {
    const companyId = id(companyIdValue), parsed = parseCreate(kind, input, rawPdf);
    await this.company(context, companyId);
    if (kind === "manual_text") assertManualText(parsed.text!);
    const now = this.clock.now(), sourceId = opaque("ksrc"), revisionId = opaque("ksrv");
    const reserved = await this.repository.createSourceAndPending(context, companyId, { id: sourceId, revisionId, kind, name: parsed.name, normalizedName: comparisonKey(parsed.name), locator: parsed.url, mediaType: kind === "pdf" ? "application/pdf" : "text/plain", inputBytes: parsed.bytes, createdAt: now });
    try {
      await this.ingest(context, companyId, reserved.source.kind, reserved.source.locator, reserved.revision.id, parsed.text, rawPdf);
    } catch (error) {
      const revision = await this.repository.findRevision(context, companyId, sourceId, revisionId);
      if (kind === "manual_text" && revision?.status === "failed") return { source: (await this.repository.findSource(context, companyId, sourceId))!, revision };
      throw error;
    }
    return { source: (await this.repository.findSource(context, companyId, sourceId))!, revision: (await this.repository.findRevision(context, companyId, sourceId, revisionId))! };
  }

  public async revise(context: WorkspaceContext, actor: ActorContext, companyIdValue: unknown, sourceIdValue: unknown, kind: KnowledgeSourceKind, input: unknown, rawPdf?: Uint8Array) {
    const companyId = id(companyIdValue);
    await this.company(context, companyId);
    if (typeof sourceIdValue !== "string") throw new KnowledgeDomainError("resource_not_found");
    const source = await this.repository.findSource(context, companyId, sourceIdValue);
    if (!source) throw new KnowledgeDomainError("resource_not_found");
    if (source.kind !== kind) throw new KnowledgeDomainError("knowledge_source_kind_mismatch");
    const parsed = parseRevision(kind, input, rawPdf), now = this.clock.now(), abandoned = new Date(new Date(now).getTime() - KNOWLEDGE_LIMITS.abandonedMilliseconds).toISOString(), revisionId = opaque("ksrv");
    const reserved = await this.repository.reserveRevision(context, companyId, { sourceId: source.id, revisionId, locator: parsed.url ?? source.locator, expectedSourceVersion: parsed.expectedSourceVersion, mediaType: kind === "pdf" ? "application/pdf" : "text/plain", inputBytes: parsed.bytes, createdAt: now, abandonedBefore: abandoned });
    await this.ingest(context, companyId, kind, parsed.url ?? source.locator, reserved.id, parsed.text, rawPdf);
    return { source: (await this.repository.findSource(context, companyId, source.id))!, revision: (await this.repository.findRevision(context, companyId, source.id, reserved.id))! };
  }

  public async archive(context: WorkspaceContext, companyIdValue: unknown, sourceId: unknown, input: unknown) {
    const companyId = id(companyIdValue);
    await this.company(context, companyId);
    if (typeof sourceId !== "string") throw new KnowledgeDomainError("resource_not_found");
    const body = exact(input, ["expectedSourceVersion"]), result = await this.repository.archiveSource(context, companyId, sourceId, positive(body.expectedSourceVersion), this.clock.now());
    if (!result) throw new KnowledgeDomainError("knowledge_source_changed");
    return result;
  }

  public async publish(context: WorkspaceContext, actor: ActorContext, companyIdValue: unknown, input: unknown) {
    const companyId = id(companyIdValue), company = await this.company(context, companyId), body = exact(input, ["sourceRevisionIds", "expectedKnowledgeVersionId"]);
    if (!Array.isArray(body.sourceRevisionIds) || body.sourceRevisionIds.some(value => typeof value !== "string") || new Set(body.sourceRevisionIds).size !== body.sourceRevisionIds.length) throw new KnowledgeDomainError("invalid_publication_manifest");
    const ids = body.sourceRevisionIds as string[];
    if (ids.length < 1 || ids.length > KNOWLEDGE_LIMITS.revisionsPerPublication) throw new KnowledgeDomainError("invalid_publication_manifest");
    if (body.expectedKnowledgeVersionId !== null && typeof body.expectedKnowledgeVersionId !== "string") throw new KnowledgeDomainError("invalid_knowledge_request");
    const revisions = await this.repository.findRevisions(context, companyId, ids);
    if (revisions.length !== ids.length) throw new KnowledgeDomainError("resource_not_found");
    if (this.indexing) {
      for (const revision of revisions) {
        if (!revision.normalizedText || !revision.contentDigest) throw new KnowledgeDomainError("knowledge_index_unavailable");
        await this.indexing.indexCompletedRevision(context, companyId, { sourceId: revision.sourceId, sourceRevisionId: revision.id, contentDigest: revision.contentDigest, normalizedText: revision.normalizedText, completedAt: revision.completedAt ?? this.clock.now() });
      }
      if (!await this.indexing.publicationReady(context, companyId, ids)) throw new KnowledgeDomainError("knowledge_index_unavailable");
    }
    const compiled = compileCompanyKnowledge(company, revisions);
    const result = await this.repository.publish(context, companyId, { expectedVersionId: body.expectedKnowledgeVersionId as string | null, versionId: opaque("kver"), snapshotDigest: compiled.snapshotDigest, canonicalJson: compiled.canonicalJson, revisionIds: compiled.revisionIds, actorId: actor.userId, at: this.clock.now() });
    if (result.status === "changed") throw new KnowledgeDomainError("knowledge_publication_changed");
    return result;
  }

  private async ingest(context: WorkspaceContext, companyId: number, kind: KnowledgeSourceKind, url: string | null, revisionId: string, manualText: string | null, pdfBytes?: Uint8Array): Promise<void> {
    const controller = new AbortController();
    try {
      await withDeadline((async () => {
        let acquired;
        if (kind === "manual_text") acquired = { text: manualText!, mediaType: "text/plain", inputBytes: utf8Bytes(manualText!) };
        else if (kind === "public_url") acquired = await this.urls.acquire(url!, controller.signal);
        else acquired = await this.pdf.extract(pdfBytes!, controller.signal);
        const normalized = normalizeKnowledgeText(acquired.text), limits = kind === "manual_text" ? [KNOWLEDGE_LIMITS.manualCharacters, KNOWLEDGE_LIMITS.manualNormalizedBytes] : kind === "public_url" ? [KNOWLEDGE_LIMITS.urlCharacters, KNOWLEDGE_LIMITS.urlNormalizedBytes] : [KNOWLEDGE_LIMITS.pdfCharacters, KNOWLEDGE_LIMITS.pdfNormalizedBytes];
        if (!normalized || codePoints(normalized) > limits[0]! || utf8Bytes(normalized) > limits[1]!) throw new KnowledgeDomainError(normalized ? "knowledge_input_too_large" : kind === "pdf" ? "pdf_text_empty" : kind === "manual_text" ? "manual_content_empty" : "url_content_empty");
        const extractionController = new AbortController(), extractionSignal = AbortSignal.any([controller.signal, extractionController.signal]);
        const extracted = await withDeadline(this.extractor.extract(kind, normalized, url, extractionSignal), this.timing.extraction, extractionController, "knowledge_extraction_timeout");
        let validated: ExtractedBusinessKnowledge;
        try { validated = validateExtractedBusinessKnowledge(extracted); } catch { throw new KnowledgeDomainError("knowledge_extraction_invalid"); }
        const completed = await this.repository.completeRevision(context, companyId, revisionId, { contentDigest: createHash("sha256").update(normalized).digest("hex"), normalizedText: normalized, extracted: validated, normalizedBytes: utf8Bytes(normalized), normalizedCharacters: codePoints(normalized), pageCount: acquired.pageCount ?? null, completedAt: this.clock.now() });
        if (!completed) throw new KnowledgeDomainError("ingestion_interrupted");
      })(), this.timing.ingestion, controller, "knowledge_ingestion_timeout");
    } catch (error: unknown) {
      const code = error instanceof KnowledgeDomainError ? error.code : "knowledge_extraction_unavailable";
      await this.repository.failRevision(context, companyId, revisionId, code, this.clock.now());
      throw error instanceof KnowledgeDomainError ? error : new KnowledgeDomainError(code);
    } finally { controller.abort(); }
  }

  private async company(context: WorkspaceContext, companyId: number) { const value = await this.companies.findById(context, companyId); if (!value) throw new KnowledgeDomainError("resource_not_found"); return value; }
}

function opaque(prefix: string): string { return `${prefix}_${randomBytes(16).toString("hex")}`; }
function id(value: unknown): number { const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN; if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new KnowledgeDomainError("resource_not_found"); return parsed; }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new KnowledgeDomainError("invalid_knowledge_request"); return value as Record<string, unknown>; }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> { const body = record(value), actual = Object.keys(body).sort(), expected = [...keys].sort(); if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new KnowledgeDomainError("invalid_knowledge_request"); return body; }
function positive(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new KnowledgeDomainError("invalid_knowledge_request"); return Number(value); }
function name(value: unknown): string { if (typeof value !== "string") throw new KnowledgeDomainError("invalid_source_name"); const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " "); if (!normalized || codePoints(normalized) > KNOWLEDGE_LIMITS.sourceNameCodePoints) throw new KnowledgeDomainError("invalid_source_name"); return normalized; }
function parseCreate(kind: KnowledgeSourceKind, input: unknown, pdf?: Uint8Array) { if (kind === "pdf") { const body = exact(input, ["name"]); return { name: name(body.name), url: null, text: null, bytes: pdf?.byteLength ?? 0 }; } const body = exact(input, kind === "manual_text" ? ["name", "text"] : ["name", "url"]), normalizedName = name(body.name); if (kind === "manual_text") { if (typeof body.text !== "string") throw new KnowledgeDomainError("invalid_knowledge_request"); if (utf8Bytes(body.text) > KNOWLEDGE_LIMITS.manualInputBytes) throw new KnowledgeDomainError("knowledge_input_too_large"); return { name: normalizedName, url: null, text: body.text, bytes: utf8Bytes(body.text) }; } if (typeof body.url !== "string") throw new KnowledgeDomainError("invalid_public_url"); const url = validatePublicUrl(body.url).toString(); return { name: normalizedName, url, text: null, bytes: utf8Bytes(url) }; }
function parseRevision(kind: KnowledgeSourceKind, input: unknown, pdf?: Uint8Array) { const body = exact(input, kind === "pdf" ? ["expectedSourceVersion"] : kind === "manual_text" ? ["expectedSourceVersion", "text"] : ["expectedSourceVersion", "url"]), expectedSourceVersion = positive(body.expectedSourceVersion); if (kind === "pdf") return { expectedSourceVersion, url: null, text: null, bytes: pdf?.byteLength ?? 0 }; if (kind === "manual_text") { if (typeof body.text !== "string") throw new KnowledgeDomainError("invalid_knowledge_request"); if (utf8Bytes(body.text) > KNOWLEDGE_LIMITS.manualInputBytes) throw new KnowledgeDomainError("knowledge_input_too_large"); return { expectedSourceVersion, url: null, text: body.text, bytes: utf8Bytes(body.text) }; } if (typeof body.url !== "string") throw new KnowledgeDomainError("invalid_public_url"); const url = validatePublicUrl(body.url).toString(); return { expectedSourceVersion, url, text: null, bytes: utf8Bytes(url) }; }
function assertManualText(value: string): void { const normalized = normalizeKnowledgeText(value); if (!normalized) throw new KnowledgeDomainError("manual_content_empty"); if (codePoints(normalized) > KNOWLEDGE_LIMITS.manualCharacters || utf8Bytes(normalized) > KNOWLEDGE_LIMITS.manualNormalizedBytes) throw new KnowledgeDomainError("knowledge_input_too_large"); }
async function withDeadline<T>(operation: Promise<T>, milliseconds: number, controller: AbortController, code: string): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new KnowledgeDomainError(code)); }, milliseconds); }); try { return await Promise.race([operation, timeout]); } finally { if (timer) clearTimeout(timer); } }
