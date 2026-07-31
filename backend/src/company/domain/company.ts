export type CompanyId = number & { readonly __brand: "CompanyId" };
export type CompanyName = string & { readonly __brand: "CompanyName" };
export type CompanySlug = string & { readonly __brand: "CompanySlug" };
export type CompanyDescription = string & { readonly __brand: "CompanyDescription" };
export type WebsiteUrl = string & { readonly __brand: "WebsiteUrl" };
export type CompanyTimezone = string & { readonly __brand: "CompanyTimezone" };
export type CompanyLocale = string & { readonly __brand: "CompanyLocale" };
export type CompanyLifecycleState = "draft" | "configured" | "operational" | "attention_required" | "suspended" | "archived";
export type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
export type BrandColorToken = "primary" | "secondary" | "accent";
export type DateFormat = "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY";
export type PhoneFormat = "international" | "national";
export type ReadinessOutcome = "eligible" | "ineligible" | "indeterminate";
export type ReadinessAction = "promote_to_operational" | "mark_attention_required" | "none";

const weekdays: readonly Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const brandTokens: readonly BrandColorToken[] = ["primary", "secondary", "accent"];

export class CompanyDomainError extends Error {}

export interface Branding {
  readonly publicName: string | null;
  readonly logoAssetReference: string | null;
  readonly colorTokens: Readonly<Partial<Record<BrandColorToken, string>>>;
}

export interface BrandingInput {
  readonly publicName?: string | null;
  readonly logoAssetReference?: string | null;
  readonly colorTokens?: Readonly<Partial<Record<BrandColorToken, string>>>;
}

export interface OperatingLocale {
  readonly countryCode: string;
  readonly currencyCode: string;
  readonly dateFormat: DateFormat;
  readonly phoneFormat: PhoneFormat;
}

export interface OperatingLocaleInput {
  readonly countryCode: string;
  readonly currencyCode: string;
  readonly dateFormat: DateFormat;
  readonly phoneFormat: PhoneFormat;
}

export interface BusinessHoursInterval { readonly opensAt: string; readonly closesAt: string; }
export interface BusinessHours {
  readonly weekly: Readonly<Record<Weekday, readonly BusinessHoursInterval[]>>;
  readonly exceptions: Readonly<Record<string, readonly BusinessHoursInterval[]>>;
}

export interface BusinessHoursInput {
  readonly weekly: Readonly<Record<Weekday, readonly BusinessHoursInterval[]>>;
  readonly exceptions?: Readonly<Record<string, readonly BusinessHoursInterval[]>>;
}

export interface CompanyConfiguration {
  readonly timezone: CompanyTimezone;
  readonly locale: CompanyLocale;
  readonly operatingLocale: OperatingLocale;
  readonly businessHours: BusinessHours;
}

export interface CompanyConfigurationInput {
  readonly timezone: string;
  readonly locale: string;
  readonly operatingLocale: OperatingLocaleInput;
  readonly businessHours: BusinessHoursInput;
}

export interface CompanyIdentityInput {
  readonly name: string;
  readonly slug: string;
  readonly description?: string | null;
  readonly website?: string | null;
}

export interface CreateCompanyInput {
  readonly id: number;
  readonly workspaceId: number;
  readonly identity: CompanyIdentityInput;
  readonly branding?: BrandingInput;
  readonly createdAt: string;
}

export interface Company {
  readonly id: CompanyId;
  readonly workspaceId: number;
  readonly name: CompanyName;
  readonly normalizedName: string;
  readonly slug: CompanySlug;
  readonly description: CompanyDescription | null;
  readonly website: WebsiteUrl | null;
  readonly branding: Branding;
  readonly configuration: CompanyConfiguration | null;
  readonly lifecycle: CompanyLifecycleState;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lifecycleChangedAt: string;
  readonly suspendedAt: string | null;
  readonly archivedAt: string | null;
}

export interface CompanyState {
  readonly id: number;
  readonly workspaceId: number;
  readonly name: string;
  readonly normalizedName: string;
  readonly slug: string;
  readonly description: string | null;
  readonly website: string | null;
  readonly branding: BrandingInput;
  readonly configuration: CompanyConfigurationInput | null;
  readonly lifecycle: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lifecycleChangedAt: string;
  readonly suspendedAt: string | null;
  readonly archivedAt: string | null;
}

export interface ReadinessPolicyDefinition {
  readonly id: string;
  readonly version: string;
  readonly productCapabilities: readonly string[];
  readonly dependencyCategories: readonly string[];
}

export interface ReadinessEvidence {
  readonly source: string;
  readonly state: string;
  readonly version: string;
  readonly asOf: string;
}

export interface ReadinessAssessment {
  readonly companyId: CompanyId;
  readonly aggregateVersion: number;
  readonly policy: ReadinessPolicyDefinition;
  readonly outcome: ReadinessOutcome;
  readonly action: ReadinessAction;
  readonly reasonCodes: readonly string[];
  readonly evidence: readonly ReadinessEvidence[];
  readonly evaluatedAt: string;
}

export interface CompanyReadinessPolicy {
  readonly definition: ReadinessPolicyDefinition;
  assess(company: Company, evidence: readonly ReadinessEvidence[], evaluatedAt: string): ReadinessAssessment;
}

function requiredText(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length === 0 || length > maximum) throw new CompanyDomainError(`${label} must contain between 1 and ${maximum} characters.`);
  return normalized;
}

function optionalText(value: string | null | undefined, label: string, maximum: number): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  return requiredText(normalized, label, maximum);
}

function validTimestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (typeof value !== "string" || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new CompanyDomainError(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new CompanyDomainError(`${label} must be a positive integer.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

function timestampAfter(current: string, value: string, label: string): string {
  const timestamp = validTimestamp(value, label);
  if (timestamp <= current) throw new CompanyDomainError(`${label} must be later than the current update timestamp.`);
  return timestamp;
}

function freezeCompany(value: Company): Company { return Object.freeze(value); }

export function companyId(value: number): CompanyId { return positiveInteger(value, "Company ID") as CompanyId; }

export function companyName(value: string): CompanyName { return requiredText(value, "Company name", 160) as CompanyName; }

export function normalizeCompanyName(value: string): string { return companyName(value).normalize("NFKC").toLocaleLowerCase("en-US"); }

export function companySlug(value: string): CompanySlug {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) || normalized.length > 80) {
    throw new CompanyDomainError("Company slug must be a lowercase URL-safe identifier.");
  }
  return normalized as CompanySlug;
}

export function companyDescription(value: string | null | undefined): CompanyDescription | null {
  const normalized = optionalText(value, "Company description", 2_000);
  return normalized === null ? null : normalized as CompanyDescription;
}

export function websiteUrl(value: string | null | undefined): WebsiteUrl | null {
  if (value === undefined || value === null) return null;
  const normalized = requiredText(value, "Website URL", 2_048);
  let parsed: URL;
  try { parsed = new URL(normalized); } catch { throw new CompanyDomainError("Website URL must be valid."); }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname || parsed.username || parsed.password || parsed.hash) {
    throw new CompanyDomainError("Website URL must be an absolute public HTTP(S) URL.");
  }
  return parsed.toString() as WebsiteUrl;
}

export function companyTimezone(value: string): CompanyTimezone {
  const normalized = requiredText(value, "Company timezone", 100);
  try { new Intl.DateTimeFormat("en", { timeZone: normalized }); } catch { throw new CompanyDomainError("Company timezone must be a valid IANA timezone."); }
  return normalized as CompanyTimezone;
}

export function companyLocale(value: string): CompanyLocale {
  const normalized = requiredText(value, "Company locale", 35);
  try { return Intl.getCanonicalLocales(normalized)[0]! as CompanyLocale; } catch { throw new CompanyDomainError("Company locale must be a valid locale tag."); }
}

export function createBranding(input: BrandingInput = {}): Branding {
  const colors: Partial<Record<BrandColorToken, string>> = {};
  for (const [token, color] of Object.entries(input.colorTokens ?? {})) {
    if (!brandTokens.includes(token as BrandColorToken) || typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new CompanyDomainError("Brand colors must use approved semantic tokens and six-digit hex values.");
    }
    colors[token as BrandColorToken] = color.toUpperCase();
  }
  return Object.freeze({
    publicName: optionalText(input.publicName, "Brand public name", 160),
    logoAssetReference: optionalText(input.logoAssetReference, "Logo asset reference", 500),
    colorTokens: Object.freeze(colors),
  });
}

export function createOperatingLocale(input: OperatingLocaleInput): OperatingLocale {
  const countryCode = requiredText(input.countryCode, "Country code", 2).toUpperCase();
  const currencyCode = requiredText(input.currencyCode, "Currency code", 3).toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode) || !/^[A-Z]{3}$/.test(currencyCode)) throw new CompanyDomainError("Operating locale country and currency codes are invalid.");
  if (input.dateFormat !== "YYYY-MM-DD" && input.dateFormat !== "DD/MM/YYYY" && input.dateFormat !== "MM/DD/YYYY") throw new CompanyDomainError("Date format is invalid.");
  if (input.phoneFormat !== "international" && input.phoneFormat !== "national") throw new CompanyDomainError("Phone format is invalid.");
  return Object.freeze({ countryCode, currencyCode, dateFormat: input.dateFormat, phoneFormat: input.phoneFormat });
}

function parseMinutes(value: string): number {
  if (!/^\d{2}:\d{2}$/.test(value)) throw new CompanyDomainError("Business hours must use HH:MM time values.");
  const hours = Number(value.slice(0, 2)), minutes = Number(value.slice(3, 5));
  if (hours > 23 || minutes > 59) throw new CompanyDomainError("Business hours time is invalid.");
  return hours * 60 + minutes;
}

function createIntervals(value: unknown): readonly BusinessHoursInterval[] {
  if (!Array.isArray(value)) throw new CompanyDomainError("Business hour intervals must be an array.");
  let previousClose = -1;
  const intervals = value.map((interval) => {
    if (!isRecord(interval) || typeof interval.opensAt !== "string" || typeof interval.closesAt !== "string") {
      throw new CompanyDomainError("Business hour interval is invalid.");
    }
    const opensAt = interval.opensAt, closesAt = interval.closesAt;
    const open = parseMinutes(opensAt), close = parseMinutes(closesAt);
    if (open >= close || open < previousClose) throw new CompanyDomainError("Business hour intervals must be ordered and non-overlapping.");
    previousClose = close;
    return Object.freeze({ opensAt, closesAt });
  });
  return Object.freeze(intervals);
}

export function createBusinessHours(input: BusinessHoursInput): BusinessHours {
  if (!isRecord(input) || !isRecord(input.weekly)) throw new CompanyDomainError("Business hours weekly schedule is invalid.");
  const weekly = {} as Record<Weekday, readonly BusinessHoursInterval[]>;
  for (const day of weekdays) {
    if (!(day in input.weekly)) throw new CompanyDomainError("Business hours must define every weekday.");
    weekly[day] = createIntervals(input.weekly[day]);
  }
  const exceptions: Record<string, readonly BusinessHoursInterval[]> = {};
  if (input.exceptions !== undefined && !isRecord(input.exceptions)) throw new CompanyDomainError("Business hour exceptions are invalid.");
  for (const [date, intervals] of Object.entries(input.exceptions ?? {})) {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new CompanyDomainError("Business hour exception dates must use YYYY-MM-DD.");
    }
    exceptions[date] = createIntervals(intervals);
  }
  return Object.freeze({ weekly: Object.freeze(weekly), exceptions: Object.freeze(exceptions) });
}

export function createCompanyConfiguration(input: CompanyConfigurationInput): CompanyConfiguration {
  return Object.freeze({
    timezone: companyTimezone(input.timezone),
    locale: companyLocale(input.locale),
    operatingLocale: createOperatingLocale(input.operatingLocale),
    businessHours: createBusinessHours(input.businessHours),
  });
}

export function companyLifecycleState(value: string): CompanyLifecycleState {
  if (value !== "draft" && value !== "configured" && value !== "operational" && value !== "attention_required" && value !== "suspended" && value !== "archived") {
    throw new CompanyDomainError("Company lifecycle state is invalid.");
  }
  return value;
}

function identity(value: CompanyIdentityInput): Pick<Company, "name" | "normalizedName" | "slug" | "description" | "website"> {
  const name = companyName(value.name);
  return { name, normalizedName: normalizeCompanyName(name), slug: companySlug(value.slug), description: companyDescription(value.description), website: websiteUrl(value.website) };
}

export function reconstructCompany(state: CompanyState): Company {
  const values = identity({ name: state.name, slug: state.slug, description: state.description, website: state.website });
  if (state.normalizedName !== normalizeCompanyName(values.name)) throw new CompanyDomainError("Company normalized name does not match its name.");
  const lifecycle = companyLifecycleState(state.lifecycle);
  const configuration = state.configuration === null ? null : createCompanyConfiguration(state.configuration);
  if ((lifecycle === "configured" || lifecycle === "operational" || lifecycle === "attention_required") && configuration === null) {
    throw new CompanyDomainError("Company lifecycle requires complete configuration.");
  }
  const createdAt = validTimestamp(state.createdAt, "Creation timestamp");
  const updatedAt = validTimestamp(state.updatedAt, "Update timestamp");
  const lifecycleChangedAt = validTimestamp(state.lifecycleChangedAt, "Lifecycle change timestamp");
  if (createdAt > updatedAt || lifecycleChangedAt > updatedAt) throw new CompanyDomainError("Company timestamps are inconsistent.");
  const suspendedAt = state.suspendedAt === null ? null : validTimestamp(state.suspendedAt, "Suspension timestamp");
  const archivedAt = state.archivedAt === null ? null : validTimestamp(state.archivedAt, "Archive timestamp");
  if ((lifecycle === "suspended") !== (suspendedAt !== null) || (lifecycle === "archived") !== (archivedAt !== null)) {
    throw new CompanyDomainError("Company lifecycle timestamps are inconsistent.");
  }
  if (lifecycle === "archived" && suspendedAt !== null) throw new CompanyDomainError("Archived Company cannot retain suspension state.");
  return freezeCompany({
    id: companyId(state.id), workspaceId: positiveInteger(state.workspaceId, "Workspace ID"), ...values, branding: createBranding(state.branding), configuration, lifecycle,
    version: positiveInteger(state.version, "Company version"), createdAt, updatedAt, lifecycleChangedAt, suspendedAt, archivedAt,
  });
}

function changed(company: Company, patch: Partial<Company>, timestamp: string, lifecycleChanged = false): Company {
  const current = reconstructCompany(company);
  if (current.lifecycle === "archived") throw new CompanyDomainError("Archived Companies cannot be changed.");
  const updatedAt = timestampAfter(current.updatedAt, timestamp, "Update timestamp");
  return freezeCompany({ ...current, ...patch, version: current.version + 1, updatedAt, ...(lifecycleChanged ? { lifecycleChangedAt: updatedAt } : {}) });
}

export function createCompany(input: CreateCompanyInput): Company {
  const timestamp = validTimestamp(input.createdAt, "Creation timestamp");
  const values = identity(input.identity);
  return freezeCompany({
    id: companyId(input.id), workspaceId: positiveInteger(input.workspaceId, "Workspace ID"), ...values,
    branding: createBranding(input.branding), configuration: null, lifecycle: "draft",
    version: 1, createdAt: timestamp, updatedAt: timestamp, lifecycleChangedAt: timestamp, suspendedAt: null, archivedAt: null,
  });
}

export function updateCompanyIdentity(company: Company, input: CompanyIdentityInput, timestamp: string): Company { return changed(company, identity(input), timestamp); }

export function updateCompanyBranding(company: Company, input: BrandingInput, timestamp: string): Company { return changed(company, { branding: createBranding(input) }, timestamp); }

export function updateCompanyConfiguration(company: Company, input: CompanyConfigurationInput, timestamp: string): Company {
  const configuration = createCompanyConfiguration(input);
  const lifecycle = company.lifecycle === "draft" ? "configured" : company.lifecycle;
  return changed(company, { configuration, lifecycle }, timestamp, lifecycle !== company.lifecycle);
}

export function suspendCompany(company: Company, timestamp: string): Company {
  const current = reconstructCompany(company);
  if (current.lifecycle === "suspended" || current.lifecycle === "archived") throw new CompanyDomainError("Company cannot be suspended from its current lifecycle state.");
  const updatedAt = timestampAfter(current.updatedAt, timestamp, "Suspension timestamp");
  return freezeCompany({ ...current, lifecycle: "suspended", version: current.version + 1, updatedAt, lifecycleChangedAt: updatedAt, suspendedAt: updatedAt });
}

export function restoreCompany(company: Company, timestamp: string): Company {
  const current = reconstructCompany(company);
  if (current.lifecycle !== "suspended" || current.configuration === null) throw new CompanyDomainError("Company can be restored only from suspended with complete configuration.");
  const updatedAt = timestampAfter(current.updatedAt, timestamp, "Restore timestamp");
  return freezeCompany({ ...current, lifecycle: "configured", version: current.version + 1, updatedAt, lifecycleChangedAt: updatedAt, suspendedAt: null });
}

export function archiveCompany(company: Company, timestamp: string): Company {
  const current = reconstructCompany(company);
  if (current.lifecycle === "archived") throw new CompanyDomainError("Company is already archived.");
  const updatedAt = timestampAfter(current.updatedAt, timestamp, "Archive timestamp");
  return freezeCompany({ ...current, lifecycle: "archived", version: current.version + 1, updatedAt, lifecycleChangedAt: updatedAt, suspendedAt: null, archivedAt: updatedAt });
}

export function restoreArchivedCompany(company: Company, target: "draft" | "configured" | "suspended", timestamp: string): Company {
  const current = reconstructCompany(company);
  if (current.lifecycle !== "archived") throw new CompanyDomainError("Only archived Companies can be restored.");
  if (target === "configured" && current.configuration === null) throw new CompanyDomainError("Company requires complete configuration before configured restoration.");
  const updatedAt = timestampAfter(current.updatedAt, timestamp, "Restore timestamp");
  return freezeCompany({ ...current, lifecycle: target, version: current.version + 1, updatedAt, lifecycleChangedAt: updatedAt, archivedAt: null, suspendedAt: target === "suspended" ? updatedAt : null });
}

function validatePolicyDefinition(value: ReadinessPolicyDefinition): ReadinessPolicyDefinition {
  const id = requiredText(value.id, "Readiness policy ID", 120), version = requiredText(value.version, "Readiness policy version", 120);
  const normalizeValues = (values: readonly string[], label: string): readonly string[] => {
    if (!Array.isArray(values)) throw new CompanyDomainError(`${label} collection is invalid.`);
    const normalized = values.map((item) => requiredText(item, label, 120)).sort();
    if (new Set(normalized).size !== normalized.length) throw new CompanyDomainError(`${label} collection contains duplicates.`);
    return Object.freeze(normalized);
  };
  return Object.freeze({ id, version, productCapabilities: normalizeValues(value.productCapabilities, "Product capability"), dependencyCategories: normalizeValues(value.dependencyCategories, "Dependency category") });
}

function samePolicyDefinition(left: ReadinessPolicyDefinition, right: ReadinessPolicyDefinition): boolean {
  return left.id === right.id && left.version === right.version
    && left.productCapabilities.length === right.productCapabilities.length && left.productCapabilities.every((value, index) => value === right.productCapabilities[index])
    && left.dependencyCategories.length === right.dependencyCategories.length && left.dependencyCategories.every((value, index) => value === right.dependencyCategories[index]);
}

function validateEvidence(values: readonly ReadinessEvidence[]): readonly ReadinessEvidence[] {
  return Object.freeze(values.map((value) => Object.freeze({
    source: requiredText(value.source, "Evidence source", 120), state: requiredText(value.state, "Evidence state", 120), version: requiredText(value.version, "Evidence version", 120), asOf: validTimestamp(value.asOf, "Evidence timestamp"),
  })));
}

export function createReadinessAssessment(value: ReadinessAssessment): ReadinessAssessment {
  const policy = validatePolicyDefinition(value.policy);
  const assessedCompanyId = companyId(value.companyId);
  const aggregateVersion = positiveInteger(value.aggregateVersion, "Assessed aggregate version");
  if (value.outcome !== "eligible" && value.outcome !== "ineligible" && value.outcome !== "indeterminate") throw new CompanyDomainError("Readiness outcome is invalid.");
  if (value.action !== "promote_to_operational" && value.action !== "mark_attention_required" && value.action !== "none") throw new CompanyDomainError("Readiness action is invalid.");
  if ((value.outcome === "eligible" && value.action === "mark_attention_required") || (value.outcome === "ineligible" && value.action === "promote_to_operational") || (value.outcome === "indeterminate" && value.action !== "none")) {
    throw new CompanyDomainError("Readiness outcome and action are inconsistent.");
  }
  const reasonCodes = Object.freeze(value.reasonCodes.map((code) => requiredText(code, "Readiness reason code", 120)));
  return Object.freeze({ companyId: assessedCompanyId, aggregateVersion, policy, outcome: value.outcome, action: value.action, reasonCodes, evidence: validateEvidence(value.evidence), evaluatedAt: validTimestamp(value.evaluatedAt, "Readiness evaluation timestamp") });
}

export function evaluateCompanyReadiness(company: Company, policy: CompanyReadinessPolicy, evidence: readonly ReadinessEvidence[], evaluatedAt: string): ReadinessAssessment {
  const current = reconstructCompany(company);
  const timestamp = validTimestamp(evaluatedAt, "Readiness evaluation timestamp");
  const definition = validatePolicyDefinition(policy.definition);
  const assessment = createReadinessAssessment(policy.assess(current, validateEvidence(evidence), timestamp));
  if (!samePolicyDefinition(assessment.policy, definition)) throw new CompanyDomainError("Readiness assessment policy does not match evaluator.");
  if (assessment.companyId !== current.id || assessment.aggregateVersion !== current.version) throw new CompanyDomainError("Readiness assessment does not match the evaluated Company revision.");
  return assessment;
}

export function applyReadinessAssessment(company: Company, assessmentInput: ReadinessAssessment, timestamp: string): Company {
  const current = reconstructCompany(company);
  const assessment = createReadinessAssessment(assessmentInput);
  if (assessment.companyId !== current.id || assessment.aggregateVersion !== current.version) throw new CompanyDomainError("Readiness assessment is stale or belongs to another Company.");
  if (current.lifecycle === "suspended" || current.lifecycle === "archived") throw new CompanyDomainError("Readiness cannot override suspended or archived Company lifecycle.");
  if (assessment.action === "none") return current;
  if (assessment.action === "promote_to_operational") {
    if ((current.lifecycle !== "configured" && current.lifecycle !== "attention_required") || assessment.outcome !== "eligible") throw new CompanyDomainError("Company cannot be promoted to operational by this assessment.");
    return changed(current, { lifecycle: "operational" }, timestamp, true);
  }
  if (current.lifecycle !== "operational" || assessment.outcome !== "ineligible") throw new CompanyDomainError("Company cannot require attention by this assessment.");
  return changed(current, { lifecycle: "attention_required" }, timestamp, true);
}
