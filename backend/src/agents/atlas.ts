import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { AnswerGenerator } from "../types/ports.js";

export class AtlasAgent {
  public constructor(private readonly answerGenerator: AnswerGenerator) {}

  public async answer(message: string, knowledge: CompanyKnowledge): Promise<string> {
    const normalized = message.trim().toLowerCase();
    const localAnswer = knowledge.faq.find(
      (item) => item.question.trim().toLowerCase() === normalized
    )?.answer;

    if (localAnswer) {
      return localAnswer;
    }

    return this.answerGenerator.generate(message, knowledge);
  }
}
