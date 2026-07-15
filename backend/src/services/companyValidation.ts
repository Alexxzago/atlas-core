export class CompanyValidationError extends Error {}
export class CompanyNotFoundError extends Error {}
export class DuplicateWebsiteError extends Error {}

export function parseCompanyId(value: unknown): number {
  const companyId = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new CompanyValidationError("Company ID must be a positive integer.");
  }
  return companyId;
}

export function normalizeWebsiteUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new CompanyValidationError("Website URL is required.");
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new CompanyValidationError("Website URL is invalid.");
  }

  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
    throw new CompanyValidationError("Website URL must use HTTP or HTTPS.");
  }

  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return url.toString().replace(/\/$/, "");
}
