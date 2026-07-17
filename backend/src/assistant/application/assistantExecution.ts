import type { AssistantLanguage, AssistantTone } from "../domain/assistantProfile.js";

export interface AssistantExecutionBehavior {
  readonly businessRole: string;
  readonly objective: string;
  readonly audience: string | null;
  readonly tone: AssistantTone;
  readonly assistantLanguage: AssistantLanguage;
  readonly fallbackMessage: string;
}

export interface AssistantExecutionKnowledge {
  readonly company: Readonly<{ name: string; website: string; phone: string; email: string }>;
  readonly business: Readonly<{
    services: readonly string[];
    hours: string;
    locations: readonly string[];
  }>;
  readonly faq: readonly Readonly<{ question: string; answer: string }>[];
}

export interface AssistantExecutionRequest {
  readonly purpose: "preview" | "legacy_chat";
  readonly behavior: Readonly<AssistantExecutionBehavior>;
  readonly knowledge: Readonly<AssistantExecutionKnowledge>;
  readonly message: string;
}

export type AssistantExecutionResult = Readonly<
  | { outcome: "answered"; answer: string }
  | { outcome: "safe_fallback"; answer: string }
>;

export class AnswerGenerationUnavailableError extends Error {}

