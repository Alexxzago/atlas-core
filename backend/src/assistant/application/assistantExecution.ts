import type { AssistantLanguage, AssistantTone } from "../domain/assistantProfile.js";
import type { AssistantProfile } from "../domain/assistantProfile.js";

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
  readonly purpose: "preview" | "legacy_chat" | "operational_execution";
  readonly behavior: Readonly<AssistantExecutionBehavior>;
  readonly knowledge: Readonly<AssistantExecutionKnowledge>;
  readonly message: string;
}

export type AssistantExecutionResult = Readonly<
  | { outcome: "answered"; answer: string }
  | { outcome: "safe_fallback"; answer: string }
>;

export class AnswerGenerationUnavailableError extends Error {}

export function buildAssistantExecution(
  profile: AssistantProfile,
  value: Omit<AssistantExecutionRequest, "behavior">,
): AssistantExecutionRequest {
  return freezeAssistantExecution({
    ...value,
    behavior: {
      businessRole: profile.businessRole!,
      objective: profile.objective!,
      audience: profile.audience,
      tone: profile.tone,
      assistantLanguage: profile.assistantLanguage,
      fallbackMessage: profile.fallbackMessage,
    },
  });
}

export function freezeAssistantExecution(value: AssistantExecutionRequest): AssistantExecutionRequest {
  const knowledge = Object.freeze({
    company: Object.freeze({ ...value.knowledge.company }),
    business: Object.freeze({
      ...value.knowledge.business,
      services: Object.freeze([...value.knowledge.business.services]),
      locations: Object.freeze([...value.knowledge.business.locations]),
    }),
    faq: Object.freeze(value.knowledge.faq.map((item) => Object.freeze({ ...item }))),
  });
  return Object.freeze({
    purpose: value.purpose,
    behavior: Object.freeze({ ...value.behavior }),
    knowledge,
    message: value.message,
  });
}
