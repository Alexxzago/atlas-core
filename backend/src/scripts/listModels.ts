import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

async function main() {
  const models = await ai.models.list({
    config: {
      pageSize: 100,
    },
  });

  for await (const model of models) {
    console.log(model.name);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});