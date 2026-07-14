import type { CompanyKnowledge } from "../types/companyKnowledge.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateCompanyKnowledge(value: unknown): CompanyKnowledge {
  if (!isRecord(value) || !isRecord(value.company) || !isRecord(value.business)) {
    throw new Error("Extracted knowledge has an invalid structure.");
  }

  const company = value.company;
  const business = value.business;
  const faq = value.faq;
  const validCompany = ["name", "website", "phone", "email"].every(
    (key) => typeof company[key] === "string"
  );
  const validBusiness =
    isStringArray(business.services) &&
    typeof business.hours === "string" &&
    isStringArray(business.locations);
  const validFaq =
    Array.isArray(faq) &&
    faq.every(
      (item) =>
        isRecord(item) &&
        typeof item.question === "string" &&
        typeof item.answer === "string"
    );

  if (!validCompany || !validBusiness || !validFaq) {
    throw new Error("Extracted knowledge has an invalid structure.");
  }

  return value as unknown as CompanyKnowledge;
}
