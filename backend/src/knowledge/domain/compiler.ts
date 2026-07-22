import { createHash } from "node:crypto";
import type { Company } from "../../types/company.js";
import type { CompanyKnowledge } from "../../types/companyKnowledge.js";
import { KNOWLEDGE_LIMITS, KnowledgeDomainError, codePoints, comparisonKey, displayValue, utf8Bytes, type KnowledgeSourceRevision } from "./knowledge.js";

export interface CompiledKnowledge { readonly knowledge: CompanyKnowledge; readonly canonicalJson: string; readonly snapshotDigest: string; readonly revisionIds: readonly string[]; }

export function compileCompanyKnowledge(company: Company, revisions: readonly KnowledgeSourceRevision[]): CompiledKnowledge {
  if (revisions.length < 1 || revisions.length > KNOWLEDGE_LIMITS.revisionsPerPublication) throw new KnowledgeDomainError("invalid_publication_manifest");
  const sourceIds = new Set<string>();
  for (const revision of revisions) {
    if (revision.status !== "ready" || !revision.extractedKnowledge) throw new KnowledgeDomainError("source_revision_not_ready");
    if (sourceIds.has(revision.sourceId)) throw new KnowledgeDomainError("invalid_publication_manifest");
    sourceIds.add(revision.sourceId);
  }
  const ordered = [...revisions].sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.id.localeCompare(b.id));
  const services = mergeArray(ordered.flatMap((item) => item.extractedKnowledge!.services), KNOWLEDGE_LIMITS.services, KNOWLEDGE_LIMITS.serviceCodePoints, "business.services");
  const locations = mergeArray(ordered.flatMap((item) => item.extractedKnowledge!.locations), KNOWLEDGE_LIMITS.locations, KNOWLEDGE_LIMITS.locationCodePoints, "business.locations");
  const hoursByKey = new Map<string, { display: string; revisionId: string }>();
  for (const revision of ordered) {
    const display = displayValue(revision.extractedKnowledge!.hours), key = comparisonKey(display);
    if (key && !hoursByKey.has(key)) hoursByKey.set(key, { display, revisionId: revision.id });
  }
  if (hoursByKey.size > 1) throw new KnowledgeDomainError("knowledge_conflict", "Conflicting knowledge.", { field: "business.hours", revisionIds: [...hoursByKey.values()].map(v => v.revisionId) });
  const hours = [...hoursByKey.values()][0]?.display ?? "";
  assertLength(hours, KNOWLEDGE_LIMITS.hoursCodePoints, "business.hours");
  const faqByQuestion = new Map<string, { question: string; answerKey: string; answer: string; revisionIds: string[] }>();
  for (const revision of ordered) for (const item of revision.extractedKnowledge!.faq) {
    const question = displayValue(item.question), answer = displayValue(item.answer);
    const questionKey = comparisonKey(question), answerKey = comparisonKey(answer);
    if (!questionKey || !answerKey) continue;
    assertLength(question, KNOWLEDGE_LIMITS.faqQuestionCodePoints, "faq.question"); assertLength(answer, KNOWLEDGE_LIMITS.faqAnswerCodePoints, "faq.answer");
    const existing = faqByQuestion.get(questionKey);
    if (existing && existing.answerKey !== answerKey) throw new KnowledgeDomainError("knowledge_conflict", "Conflicting knowledge.", { field: `faq[${questionKey}]`, revisionIds: [...existing.revisionIds, revision.id] });
    if (existing) existing.revisionIds.push(revision.id); else faqByQuestion.set(questionKey, { question, answerKey, answer, revisionIds: [revision.id] });
  }
  if (faqByQuestion.size > KNOWLEDGE_LIMITS.faq) throw new KnowledgeDomainError("knowledge_limit_exceeded", "Knowledge exceeds its limit.", { field: "faq" });
  const faq = [...faqByQuestion.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => ({ question: value.question, answer: value.answer }));
  const knowledge: CompanyKnowledge = { company: { name: company.name, website: company.website, phone: company.phone, email: company.email }, business: { services, hours, locations }, faq };
  const canonicalJson = JSON.stringify(knowledge);
  if (utf8Bytes(canonicalJson) > KNOWLEDGE_LIMITS.publishedBytes) throw new KnowledgeDomainError("knowledge_limit_exceeded", "Published Knowledge exceeds its limit.");
  const revisionIds = ordered.map(item => item.id);
  const snapshotDigest = createHash("sha256").update(`company-knowledge-compiler-v1\n${revisionIds.join("\n")}\n${canonicalJson}`).digest("hex");
  return Object.freeze({ knowledge, canonicalJson, snapshotDigest, revisionIds: Object.freeze(revisionIds) });
}

function mergeArray(values: readonly string[], maximum: number, maximumLength: number, field: string): string[] {
  const byKey = new Map<string, string>();
  for (const raw of values) { const display = displayValue(raw), key = comparisonKey(display); if (!key) continue; assertLength(display, maximumLength, field); if (!byKey.has(key)) byKey.set(key, display); }
  if (byKey.size > maximum) throw new KnowledgeDomainError("knowledge_limit_exceeded", "Knowledge exceeds its limit.", { field });
  return [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
}
function assertLength(value: string, limit: number, field: string): void { if (codePoints(value) > limit) throw new KnowledgeDomainError("knowledge_limit_exceeded", "Knowledge field exceeds its limit.", { field }); }

