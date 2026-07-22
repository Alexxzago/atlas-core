import type { CompanyKnowledge } from "../../types/companyKnowledge.js";

export type KnowledgeSourceKind = "manual_text" | "public_url" | "pdf";
export type KnowledgeSourceOrigin = "user" | "legacy_migration";
export type KnowledgeSourceStatus = "active" | "archived";
export type KnowledgeRevisionStatus = "pending" | "ready" | "failed";

export interface ExtractedBusinessKnowledge {
  readonly services: readonly string[];
  readonly hours: string;
  readonly locations: readonly string[];
  readonly faq: readonly Readonly<{ question: string; answer: string }>[];
}

export interface KnowledgeSource {
  readonly id: string; readonly companyId: number; readonly kind: KnowledgeSourceKind;
  readonly origin: KnowledgeSourceOrigin; readonly name: string; readonly normalizedName: string;
  readonly locator: string | null; readonly status: KnowledgeSourceStatus; readonly version: number;
  readonly createdAt: string; readonly updatedAt: string; readonly archivedAt: string | null;
}

export interface KnowledgeSourceRevision {
  readonly id: string; readonly sourceId: string; readonly revisionNumber: number;
  readonly status: KnowledgeRevisionStatus; readonly mediaType: string; readonly contentDigest: string | null;
  readonly normalizedText: string | null; readonly extractedKnowledge: ExtractedBusinessKnowledge | null;
  readonly extractorSchemaVersion: "company-business-knowledge-v1"; readonly inputBytes: number;
  readonly normalizedBytes: number | null; readonly normalizedCharacters: number | null;
  readonly pageCount: number | null; readonly failureCode: string | null;
  readonly createdAt: string; readonly completedAt: string | null;
}

export interface CompanyKnowledgeVersion {
  readonly id: string; readonly companyId: number; readonly versionNumber: number;
  readonly compilerVersion: "company-knowledge-compiler-v1"; readonly knowledge: CompanyKnowledge;
  readonly snapshotDigest: string; readonly publishedByActorId: string; readonly publishedAt: string;
  readonly sourceRevisionIds: readonly string[]; readonly publicationVersion: number;
}

export interface CurrentKnowledgePublication {
  readonly companyId: number; readonly knowledgeVersionId: string; readonly publicationVersion: number;
  readonly publishedByActorId: string; readonly publishedAt: string;
}

export const KNOWLEDGE_LIMITS = Object.freeze({
  sourcesPerCompany: 50, revisionsPerPublication: 25, sourceNameCodePoints: 120,
  manualInputBytes: 100 * 1024, manualCharacters: 80_000, manualNormalizedBytes: 100 * 1024,
  urlResponseBytes: 2 * 1024 * 1024, urlCharacters: 100_000, urlNormalizedBytes: 256 * 1024,
  pdfBytes: 10 * 1024 * 1024, pdfPages: 100, pdfCharacters: 100_000, pdfNormalizedBytes: 256 * 1024,
  services: 100, serviceCodePoints: 200, locations: 50, locationCodePoints: 200,
  hoursCodePoints: 1_000, faq: 100, faqQuestionCodePoints: 300, faqAnswerCodePoints: 2_000,
  publishedBytes: 128 * 1024, abandonedMilliseconds: 10 * 60 * 1000,
  pdfTimeoutMilliseconds: 15_000, urlTimeoutMilliseconds: 30_000,
  extractionTimeoutMilliseconds: 45_000, ingestionTimeoutMilliseconds: 60_000,
} as const);

export function normalizeKnowledgeText(value: string): string {
  return value.normalize("NFKC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

export function comparisonKey(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export function displayValue(value: string): string { return value.normalize("NFKC").trim().replace(/\s+/gu, " "); }
export function codePoints(value: string): number { return Array.from(value).length; }
export function utf8Bytes(value: string): number { return Buffer.byteLength(value, "utf8"); }

function exactRecord(value: unknown, keys: readonly string[], code = "knowledge_integrity_failure"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KnowledgeDomainError(code);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== [...keys].sort()[index])) throw new KnowledgeDomainError(code);
  return record;
}

function stringArray(value: unknown, maximum: number, itemLimit: number): string[] {
  if (!Array.isArray(value) || value.length > maximum || value.some(item => typeof item !== "string" || codePoints(item) > itemLimit)) throw new KnowledgeDomainError("knowledge_integrity_failure");
  return [...value];
}

export function validateExtractedBusinessKnowledge(value: unknown): ExtractedBusinessKnowledge {
  const record = exactRecord(value, ["services", "hours", "locations", "faq"]);
  if (typeof record.hours !== "string" || codePoints(record.hours) > KNOWLEDGE_LIMITS.hoursCodePoints || !Array.isArray(record.faq) || record.faq.length > KNOWLEDGE_LIMITS.faq) throw new KnowledgeDomainError("knowledge_integrity_failure");
  const faq = record.faq.map(item => {
    const entry = exactRecord(item, ["question", "answer"]);
    if (typeof entry.question !== "string" || typeof entry.answer !== "string" || codePoints(entry.question) > KNOWLEDGE_LIMITS.faqQuestionCodePoints || codePoints(entry.answer) > KNOWLEDGE_LIMITS.faqAnswerCodePoints) throw new KnowledgeDomainError("knowledge_integrity_failure");
    return Object.freeze({ question: entry.question, answer: entry.answer });
  });
  return Object.freeze({ services: stringArray(record.services, KNOWLEDGE_LIMITS.services, KNOWLEDGE_LIMITS.serviceCodePoints), hours: record.hours, locations: stringArray(record.locations, KNOWLEDGE_LIMITS.locations, KNOWLEDGE_LIMITS.locationCodePoints), faq: Object.freeze(faq) });
}

export function validateStoredCompanyKnowledgeJson(json: string): CompanyKnowledge {
  if (utf8Bytes(json) > KNOWLEDGE_LIMITS.publishedBytes) throw new KnowledgeDomainError("knowledge_integrity_failure");
  let value: unknown; try { value = JSON.parse(json); } catch { throw new KnowledgeDomainError("knowledge_integrity_failure"); }
  const root = exactRecord(value, ["company", "business", "faq"]), company = exactRecord(root.company, ["name", "website", "phone", "email"]), business = exactRecord(root.business, ["services", "hours", "locations"]);
  if ([company.name, company.website, company.phone, company.email, business.hours].some(item => typeof item !== "string")) throw new KnowledgeDomainError("knowledge_integrity_failure");
  const extracted = validateExtractedBusinessKnowledge({ services: business.services, hours: business.hours, locations: business.locations, faq: root.faq });
  return { company: { name: company.name as string, website: company.website as string, phone: company.phone as string, email: company.email as string }, business: { services: [...extracted.services], hours: extracted.hours, locations: [...extracted.locations] }, faq: extracted.faq.map(item=>({question:item.question,answer:item.answer})) };
}

export class KnowledgeDomainError extends Error {
  public constructor(public readonly code: string, message = code, public readonly details?: unknown) { super(message); }
}
