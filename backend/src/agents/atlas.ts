import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import {
  findAnswer,
  getKnowledge,
} from "../services/knowledge.js";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

export async function askAtlas(message: string) {
  const localAnswer = findAnswer(message);

  if (localAnswer) {
    return localAnswer;
  }

  const knowledge = getKnowledge();

  const prompt = `
You are the commercial assistant for this real estate company.

COMPANY INFORMATION:
${JSON.stringify(knowledge, null, 2)}

RULES:
- Answer using only the company information provided above.
- Never invent properties, prices, addresses, schedules, policies, or contact information.
- If the information is unavailable, say: "I don't have that information yet. I can connect you with a human agent."
- Reply in the same language as the customer.
- Keep the response concise, helpful, and professional.

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