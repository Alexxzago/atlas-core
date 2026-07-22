import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { AnswerGenerator } from "../types/ports.js";
import { freezeAssistantExecution, type AssistantExecutionRequest, type AssistantExecutionResult } from "../assistant/application/assistantExecution.js";
import type { AssistantExecutionPort } from "../assistant/application/assistantExecutionPort.js";

const LEGACY_FALLBACK = "I don't have that information yet. I can connect you with a human agent.";

export class AtlasAgent implements AssistantExecutionPort {
  public constructor(private readonly answerGenerator: AnswerGenerator) {}

  public async answer(message: string, knowledge: CompanyKnowledge): Promise<string> {
    const normalized = message.trim().toLowerCase();
    const localAnswer = knowledge.faq.find(
      (item) => item.question.trim().toLowerCase() === normalized
    )?.answer;

    if (localAnswer) {
      return localAnswer;
    }

    const result = await this.answerGenerator.execute(freezeAssistantExecution({
      purpose: "legacy_chat",
      behavior: {
        businessRole: "commercial assistant",
        objective: "Answer customer questions using only company information.",
        audience: null,
        tone: "professional",
        assistantLanguage: "en",
        fallbackMessage: LEGACY_FALLBACK,
      },
      knowledge,
      message,
    }));
    return result.answer;
  }

  public execute(request: AssistantExecutionRequest): Promise<AssistantExecutionResult> {
    return this.answerGenerator.execute(request);
  }
}
