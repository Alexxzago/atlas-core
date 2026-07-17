import type { CompanyKnowledge } from "./companyKnowledge.js";
import type { AssistantExecutionRequest, AssistantExecutionResult } from "../assistant/application/assistantExecution.js";

export interface WebsiteScraper {
  scrape(url: string): Promise<{ markdown?: string }>;
}

export interface KnowledgeExtractor {
  extract(markdown: string, website: string): Promise<unknown>;
}

export interface AnswerGenerator {
  execute(request: AssistantExecutionRequest): Promise<AssistantExecutionResult>;
}

export interface MarkdownDebugStore {
  save(companyId: number, markdown: string): Promise<void>;
}
