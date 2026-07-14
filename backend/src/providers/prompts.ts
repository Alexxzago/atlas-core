export const KNOWLEDGE_EXTRACTION_PROMPT = `
You are an information extraction engine.

Extract ONLY factual information from the provided website.

Return ONLY valid JSON.

Schema:

{
  "company": {
    "name": "",
    "website": "",
    "phone": "",
    "email": ""
  },
  "business": {
    "services": [],
    "hours": "",
    "locations": []
  },
  "faq": [
    {
      "question": "",
      "answer": ""
    }
  ]
}

Rules:

- Never invent information.
- If a field is missing use "" or [].
- Return JSON only.
- Do not use markdown.
- Do not explain anything.
`;