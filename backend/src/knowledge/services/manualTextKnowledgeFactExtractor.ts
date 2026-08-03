import { createHash } from "node:crypto";
import type { KnowledgeFactExtractor } from "../application/ports.js";
import type { ExtractedBusinessKnowledge, KnowledgeSourceKind } from "../domain/knowledge.js";

export class ManualTextKnowledgeFactExtractor implements KnowledgeFactExtractor {
  public constructor(private readonly delegate: KnowledgeFactExtractor) {}

  public async extract(kind: KnowledgeSourceKind, normalizedText: string, url: string | null, signal: AbortSignal): Promise<unknown> {
    if (kind !== "manual_text") return this.delegate.extract(kind, normalizedText, url, signal);
    const suffix = createHash("sha256").update(normalizedText).digest("hex").slice(0, 12);
    const characters = Array.from(normalizedText);
    const faq = Array.from({ length: Math.ceil(characters.length / 2_000) }, (_, index) => Object.freeze({ question: `Manual information ${suffix} (${index + 1})`, answer: characters.slice(index * 2_000, (index + 1) * 2_000).join("") }));
    const result: ExtractedBusinessKnowledge = Object.freeze({ services: Object.freeze([]), hours: "", locations: Object.freeze([]), faq: Object.freeze(faq) });
    return result;
  }
}
