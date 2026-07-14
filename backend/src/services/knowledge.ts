import knowledge from "../data/knowledge.json";

export function getKnowledge() {
  return knowledge;
}

export function findAnswer(question: string): string | null {
  const q = question.toLowerCase();

  const match = knowledge.faq.find((item) =>
    item.question.toLowerCase().includes(q)
  );

  return match ? match.answer : null;
}