import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { AnswerGenerator, KnowledgeExtractor } from "../types/ports.js";
import { KNOWLEDGE_EXTRACTION_PROMPT } from "./prompts.js";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

export class GeminiProvider implements AnswerGenerator, KnowledgeExtractor {
  public async generate(message: string, knowledge: CompanyKnowledge): Promise<string> {
  const prompt = `
You are the commercial assistant for this company.

COMPANY INFORMATION:
${JSON.stringify(knowledge, null, 2)}

RULES:
- Answer using only the company information.
- Never invent data.
- If the information is not available, answer:
"I don't have that information yet. I can connect you with a human agent."
- Reply in the customer's language.

CUSTOMER MESSAGE:
${message}
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
    });

    return (
      response.text ??
      "I don't have that information yet. I can connect you with a human agent."
    );
  } catch (error) {
    console.error("Gemini API error:", error);

    return "I'm temporarily unable to check that information. I can connect you with a human agent.";
  }
  }

  public async extract(
  markdown: string,
  website: string
): Promise<unknown> {
  let response;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `${KNOWLEDGE_EXTRACTION_PROMPT}

WEBSITE:
${website}

WEBSITE CONTENT:
${markdown}`,
        config: {
          responseMimeType: "application/json",
        },
      });

      break;
    } catch (error: unknown) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? (error as { status?: unknown }).status
        : undefined;
      const isRetryable = status === 503 || status === 429;

      if (!isRetryable || attempt === 3) {
        throw error;
      }

      const delayMs = 2000 * attempt;

      console.log(
        `Gemini ocupado. Reintento ${attempt}/3 en ${delayMs} ms...`
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (!response?.text) {
    throw new Error("Gemini returned an empty knowledge response.");
  }

  return JSON.parse(response.text) as unknown;
  }
}

export const geminiProvider = new GeminiProvider();
