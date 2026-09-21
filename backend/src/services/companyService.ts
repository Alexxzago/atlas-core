import type { CompanyPersistencePort } from "../application/ports/repositories.js";
import type { Company } from "../types/company.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import { assertBillingEntitlement, BillingEntitlementDeniedError, type BillingEntitlementPort } from "../billing/services/billingEntitlementService.js";
import {
  CompanyNotFoundError,
  CompanyValidationError,
  DuplicateWebsiteError,
  CompanyCapacityError,
  normalizeWebsiteUrl,
  parseCompanyId,
} from "./companyValidation.js";

interface CompanyUpdate {
  name?: string;
  website?: string | null;
  phone?: string;
  email?: string;
}

export class CompanyService {
  public constructor(private readonly companies: CompanyPersistencePort, private readonly entitlements?: BillingEntitlementPort) {}
  public async list(context: WorkspaceContext): Promise<Company[]> { return await this.companies.list(context); }

  public async get(context: WorkspaceContext, companyIdValue: unknown): Promise<Company> {
    const companyId = parseCompanyId(companyIdValue);
    const company = await this.companies.findById(context, companyId);
    if (!company) throw new CompanyNotFoundError("Company was not found.");
    return company;
  }

  public async create(context: WorkspaceContext, value: unknown): Promise<Company> {
    const input = this.validateCreate(value);
    if (input.website !== null && await this.companies.findByWebsite(context, input.website)) {
      throw new DuplicateWebsiteError("A company already uses this website.");
    }
    try { await this.assertCompanyCapacity(context); }
    catch (error: unknown) { if (error instanceof BillingEntitlementDeniedError) throw new CompanyCapacityError(error.message); throw error; }
    return await this.companies.create(context, input);
  }

  private async assertCompanyCapacity(context: WorkspaceContext): Promise<void> {
    if (this.entitlements) assertBillingEntitlement(await this.entitlements.mayCreateCompany(context.workspaceId));
  }

  public async update(context: WorkspaceContext, companyIdValue: unknown, value: unknown): Promise<Company> {
    const current = await this.get(context, companyIdValue);
    const changes = this.validateUpdate(value);
    const website = changes.website === undefined ? current.website : changes.website;
    const websiteOwner = website === null ? null : await this.companies.findByWebsite(context, website);
    if (websiteOwner && websiteOwner.id !== current.id) {
      throw new DuplicateWebsiteError("A company already uses this website.");
    }

    const updated = await this.companies.update(context, current.id, {
      name: changes.name ?? current.name,
      website,
      phone: changes.phone ?? current.phone,
      email: changes.email ?? current.email,
      status: current.status,
    });
    if (!updated) throw new CompanyNotFoundError("Company was not found.");
    return updated;
  }

  public async delete(context: WorkspaceContext, companyIdValue: unknown): Promise<void> {
    const companyId = parseCompanyId(companyIdValue);
    if (!await this.companies.delete(context, companyId)) {
      throw new CompanyNotFoundError("Company was not found.");
    }
  }

  private validateCreate(value: unknown): {
    name: string;
    website: string | null;
    phone?: string;
    email?: string;
  } {
    if (!isRecord(value)) throw new CompanyValidationError("Request body must be an object.");
    const allowed = new Set(["name", "website", "phone", "email"]);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
      throw new CompanyValidationError("Request contains unsupported fields.");
    }
    const name = requiredString(value.name, "Name");
    const result: { name: string; website: string | null; phone?: string; email?: string } = {
      name,
      website: value.website === undefined || value.website === null ? null : normalizeWebsiteUrl(value.website),
    };
    if (value.phone !== undefined) result.phone = optionalString(value.phone, "Phone");
    if (value.email !== undefined) result.email = optionalString(value.email, "Email");
    return result;
  }

  private validateUpdate(value: unknown): CompanyUpdate {
    if (!isRecord(value)) throw new CompanyValidationError("Request body must be an object.");
    const allowed = new Set(["name", "website", "phone", "email"]);
    const keys = Object.keys(value);
    if (keys.length === 0) throw new CompanyValidationError("At least one field is required.");
    if (keys.some((key) => !allowed.has(key))) {
      throw new CompanyValidationError("Only name, website, phone and email can be updated.");
    }
    const result: CompanyUpdate = {};
    if (value.name !== undefined) result.name = requiredString(value.name, "Name");
    if (value.website !== undefined) result.website = value.website === null ? null : normalizeWebsiteUrl(value.website);
    if (value.phone !== undefined) result.phone = optionalString(value.phone, "Phone");
    if (value.email !== undefined) result.email = optionalString(value.email, "Email");
    return result;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new CompanyValidationError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new CompanyValidationError(`${field} must be a string.`);
  }
  return value.trim();
}
