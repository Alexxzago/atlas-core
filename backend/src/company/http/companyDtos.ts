export class CompanyHttpValidationError extends Error {}

type JsonRecord = Record<string, unknown>;
export type DateFormatDto = "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY";
export type PhoneFormatDto = "international" | "national";

export interface BusinessHoursIntervalDto { readonly opensAt: string; readonly closesAt: string; }
export interface BusinessHoursDto { readonly weekly: Readonly<Record<string, readonly BusinessHoursIntervalDto[]>>; readonly exceptions?: Readonly<Record<string, readonly BusinessHoursIntervalDto[]>>; }
export interface BrandingDto { readonly publicName: string | null; readonly logoAssetReference: string | null; readonly colorTokens: Readonly<Partial<Record<"primary" | "secondary" | "accent", string>>>; }
export interface BrandingRequestDto { readonly publicName?: string | null; readonly logoAssetReference?: string | null; readonly colorTokens?: Readonly<Partial<Record<"primary" | "secondary" | "accent", string>>>; }
export interface ConfigurationDto { readonly timezone: string; readonly locale: string; readonly operatingLocale: { readonly countryCode: string; readonly currencyCode: string; readonly dateFormat: DateFormatDto; readonly phoneFormat: PhoneFormatDto }; readonly businessHours: BusinessHoursDto; }
export interface CompanyIdentityDto { readonly name: string; readonly slug: string; readonly description?: string | null; readonly website: string; }
export interface CreateCompanyRequestDto { readonly identity: CompanyIdentityDto; readonly branding?: BrandingRequestDto; }
export interface UpdateIdentityRequestDto { readonly expectedVersion: number; readonly identity: CompanyIdentityDto; }
export interface UpdateBrandingRequestDto { readonly expectedVersion: number; readonly branding: BrandingRequestDto; }
export interface UpdateConfigurationRequestDto { readonly expectedVersion: number; readonly configuration: ConfigurationDto; }
export interface VersionedRequestDto { readonly expectedVersion: number; }

export interface CompanyResponseDto {
  readonly id: number; readonly name: string; readonly slug: string; readonly description: string | null; readonly website: string;
  readonly branding: BrandingDto; readonly configuration: ConfigurationDto | null; readonly lifecycle: "draft" | "configured" | "operational" | "attention_required" | "suspended" | "archived"; readonly version: number;
  readonly createdAt: string; readonly updatedAt: string; readonly lifecycleChangedAt: string; readonly suspendedAt: string | null; readonly archivedAt: string | null;
}
export interface ReadinessPolicyDto { readonly id: string; readonly version: string; readonly productCapabilities: readonly string[]; readonly dependencyCategories: readonly string[]; }
export interface ReadinessEvidenceDto { readonly source: string; readonly state: string; readonly version: string; readonly asOf: string; }
export interface ReadinessAssessmentDto { readonly companyId: number; readonly aggregateVersion: number; readonly policy: ReadinessPolicyDto; readonly outcome: "eligible" | "ineligible" | "indeterminate"; readonly action: "promote_to_operational" | "mark_attention_required" | "none"; readonly reasonCodes: readonly string[]; readonly evidence: readonly ReadinessEvidenceDto[]; readonly evaluatedAt: string; }

function record(value: unknown, label: string): JsonRecord { if (typeof value !== "object" || value === null || Array.isArray(value)) throw new CompanyHttpValidationError(`${label} must be an object.`); return value as JsonRecord; }
function exact(value: JsonRecord, keys: readonly string[], label: string): void { if (Object.keys(value).some((key) => !keys.includes(key))) throw new CompanyHttpValidationError(`${label} contains unsupported fields.`); }
function text(value: unknown, label: string): string { if (typeof value !== "string") throw new CompanyHttpValidationError(`${label} must be a string.`); return value; }
function nullableText(value: unknown, label: string): string | null { if (value !== null && typeof value !== "string") throw new CompanyHttpValidationError(`${label} must be a string or null.`); return value; }
function positiveInteger(value: unknown, label: string): number { if (!Number.isInteger(value) || (value as number) <= 0) throw new CompanyHttpValidationError(`${label} must be a positive integer.`); return value as number; }

function identity(value: unknown): CompanyIdentityDto {
  const body = record(value, "Identity"); exact(body, ["name", "slug", "description", "website"], "Identity");
  if (!("name" in body) || !("slug" in body) || !("website" in body)) throw new CompanyHttpValidationError("Identity requires name, slug, and website.");
  return { name: text(body.name, "Identity name"), slug: text(body.slug, "Identity slug"), ...(body.description === undefined ? {} : { description: nullableText(body.description, "Identity description") }), website: text(body.website, "Identity website") };
}

function branding(value: unknown): BrandingRequestDto {
  const body = record(value, "Branding"); exact(body, ["publicName", "logoAssetReference", "colorTokens"], "Branding");
  if (body.colorTokens !== undefined) record(body.colorTokens, "Branding color tokens");
  return { ...(body.publicName === undefined ? {} : { publicName: nullableText(body.publicName, "Branding public name") }), ...(body.logoAssetReference === undefined ? {} : { logoAssetReference: nullableText(body.logoAssetReference, "Branding logo asset reference") }), ...(body.colorTokens === undefined ? {} : { colorTokens: body.colorTokens as BrandingRequestDto["colorTokens"] }) } as BrandingRequestDto;
}

function configuration(value: unknown): ConfigurationDto {
  const body = record(value, "Configuration"); exact(body, ["timezone", "locale", "operatingLocale", "businessHours"], "Configuration");
  if (!("timezone" in body) || !("locale" in body) || !("operatingLocale" in body) || !("businessHours" in body)) throw new CompanyHttpValidationError("Configuration requires timezone, locale, operatingLocale, and businessHours.");
  const operatingLocale = record(body.operatingLocale, "Operating locale"); exact(operatingLocale, ["countryCode", "currencyCode", "dateFormat", "phoneFormat"], "Operating locale");
  if (!("countryCode" in operatingLocale) || !("currencyCode" in operatingLocale) || !("dateFormat" in operatingLocale) || !("phoneFormat" in operatingLocale)) throw new CompanyHttpValidationError("Operating locale is incomplete.");
  const businessHours = record(body.businessHours, "Business hours"); exact(businessHours, ["weekly", "exceptions"], "Business hours");
  if (!("weekly" in businessHours)) throw new CompanyHttpValidationError("Business hours requires weekly."); record(businessHours.weekly, "Business hours weekly"); if (businessHours.exceptions !== undefined) record(businessHours.exceptions, "Business hours exceptions");
  return { timezone: text(body.timezone, "Configuration timezone"), locale: text(body.locale, "Configuration locale"), operatingLocale: { countryCode: text(operatingLocale.countryCode, "Operating locale country code"), currencyCode: text(operatingLocale.currencyCode, "Operating locale currency code"), dateFormat: text(operatingLocale.dateFormat, "Operating locale date format") as DateFormatDto, phoneFormat: text(operatingLocale.phoneFormat, "Operating locale phone format") as PhoneFormatDto }, businessHours: { weekly: businessHours.weekly as BusinessHoursDto["weekly"], ...(businessHours.exceptions === undefined ? {} : { exceptions: businessHours.exceptions as NonNullable<BusinessHoursDto["exceptions"]> }) } as BusinessHoursDto };
}

function versioned(value: unknown): VersionedRequestDto { const body = record(value, "Request"); if (!("expectedVersion" in body)) throw new CompanyHttpValidationError("Request requires expectedVersion."); return { expectedVersion: positiveInteger(body.expectedVersion, "Expected version") }; }

export function parseCompanyId(value: unknown): number { return positiveInteger(typeof value === "string" ? Number(value) : value, "Company ID"); }
export function parseSlug(value: unknown): string { return text(value, "Company slug"); }
export function parseListCompaniesQuery(value: unknown): void { if (Object.keys(record(value, "Query")).length !== 0) throw new CompanyHttpValidationError("Company list does not accept query parameters."); }
export function parseCreateCompanyRequest(value: unknown): CreateCompanyRequestDto { const body = record(value, "Request"); exact(body, ["identity", "branding"], "Request"); if (!("identity" in body)) throw new CompanyHttpValidationError("Request requires identity."); return { identity: identity(body.identity), ...(body.branding === undefined ? {} : { branding: branding(body.branding) }) }; }
export function parseUpdateIdentityRequest(value: unknown): UpdateIdentityRequestDto { const body = record(value, "Request"); exact(body, ["expectedVersion", "identity"], "Request"); if (!("identity" in body)) throw new CompanyHttpValidationError("Request requires identity."); return { ...versioned(body), identity: identity(body.identity) }; }
export function parseUpdateBrandingRequest(value: unknown): UpdateBrandingRequestDto { const body = record(value, "Request"); exact(body, ["expectedVersion", "branding"], "Request"); if (!("branding" in body)) throw new CompanyHttpValidationError("Request requires branding."); return { ...versioned(body), branding: branding(body.branding) }; }
export function parseUpdateConfigurationRequest(value: unknown): UpdateConfigurationRequestDto { const body = record(value, "Request"); exact(body, ["expectedVersion", "configuration"], "Request"); if (!("configuration" in body)) throw new CompanyHttpValidationError("Request requires configuration."); return { ...versioned(body), configuration: configuration(body.configuration) }; }
export function parseVersionedRequest(value: unknown): VersionedRequestDto { const body = record(value, "Request"); exact(body, ["expectedVersion"], "Request"); return versioned(body); }
