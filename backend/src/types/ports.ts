import type { CompanyKnowledge } from "./companyKnowledge.js";

export interface WebsiteScraper {
  scrape(url: string): Promise<{ markdown?: string }>;
}

export interface KnowledgeExtractor {
  extract(markdown: string, website: string): Promise<unknown>;
}

export interface AnswerGenerator {
  generate(message: string, knowledge: CompanyKnowledge): Promise<string>;
}

export interface MarkdownDebugStore {
  save(companyId: number, markdown: string): Promise<void>;
}
