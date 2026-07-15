import type { Company, CompanyStatus } from "../types/api";

export function replaceCompany(companies: Company[], updated: Company): Company[] {
  return companies.map((company) => company.id === updated.id ? updated : company);
}

export function setCompanyStatus(
  companies: Company[],
  companyId: number,
  status: CompanyStatus
): Company[] {
  return companies.map((company) => company.id === companyId ? { ...company, status } : company);
}

export function applyOnboardingFailure(
  companies: Company[],
  companyId: number,
  refreshed?: Company
): Company[] {
  return companies.map((company) => {
    if (company.id !== companyId) return company;
    return { ...(refreshed ?? company), status: "failed" };
  });
}
