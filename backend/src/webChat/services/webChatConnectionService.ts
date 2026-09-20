import { randomUUID } from "node:crypto";
import type { CompanyPersistencePort } from "../../application/ports/repositories.js";
import type { AssistantProfileRepositoryPort } from "../../assistant/application/ports.js";
import { assistantProfileId } from "../../assistant/domain/assistantProfile.js";
import { AssistantProfileExecutionPolicy, AssistantProfilePolicyError } from "../../assistant/domain/assistantProfilePolicies.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import { assertBillingEntitlement, BillingEntitlementDeniedError, type BillingEntitlementPort } from "../../billing/services/billingEntitlementService.js";
import type { WebChatConnectionRepositoryPort } from "../application/ports.js";
import { reconstructWebChatConnection, webChatConnectionId, webChatConnectionPublicId, webChatConnectionStatus, type WebChatConnection, type WebChatConnectionStatus } from "../domain/webChatConnection.js";

export class WebChatConnectionValidationError extends Error {}
export class WebChatConnectionNotFoundError extends Error {}
export class WebChatConnectionProfileNotExecutableError extends Error {}
export class WebChatConnectionCapacityError extends Error {}

export interface WebChatConnectionClock { now(): string; }

export class WebChatConnectionService {
  private readonly profilePolicy = new AssistantProfileExecutionPolicy();

  public constructor(
    private readonly companies: CompanyPersistencePort,
    private readonly profiles: AssistantProfileRepositoryPort,
    private readonly connections: WebChatConnectionRepositoryPort,
    private readonly clock: WebChatConnectionClock,
    private readonly entitlements?: BillingEntitlementPort,
  ) {}

  public async create(context: WorkspaceContext, companyIdValue: unknown, value: unknown): Promise<WebChatConnection> {
    const companyId = parseCompanyId(companyIdValue), profileId = createInput(value);
    await this.company(context, companyId);
    const profile = await this.profiles.findById(context, companyId, profileId);
    if (!profile) throw new WebChatConnectionNotFoundError("Assistant Profile was not found.");
    this.assertExecutable(profile);
    await this.assertCapacity(context);
    const now = this.clock.now();
    const created = await this.connections.create(context, reconstructWebChatConnection({
      id: webChatConnectionId(`wcc_${randomUUID().replaceAll("-", "")}`),
      publicId: webChatConnectionPublicId(`wcp_${randomUUID().replaceAll("-", "")}`),
      workspaceId: context.workspaceId, companyId, assistantProfileId: profile.id, status: "active", createdAt: now, updatedAt: now,
    }));
    if (!created) throw new WebChatConnectionNotFoundError("Web Chat Connection could not be created.");
    return created;
  }

  public async list(context: WorkspaceContext, companyIdValue: unknown): Promise<WebChatConnection[]> {
    const id = parseCompanyId(companyIdValue); await this.company(context, id); return this.connections.listByCompany(context, id);
  }

  public async get(context: WorkspaceContext, companyIdValue: unknown, connectionIdValue: unknown): Promise<WebChatConnection> {
    const company = parseCompanyId(companyIdValue), id = parseConnectionId(connectionIdValue);
    const value = await this.connections.findById(context, company, id);
    if (!value) throw new WebChatConnectionNotFoundError("Web Chat Connection was not found.");
    return value;
  }

  public async setStatus(context: WorkspaceContext, companyIdValue: unknown, connectionIdValue: unknown, value: unknown): Promise<WebChatConnection> {
    const current = await this.get(context, companyIdValue, connectionIdValue), status = statusInput(value);
    if (status === "active") {
      await this.company(context, current.companyId);
      const profile = await this.profiles.findById(context, current.companyId, current.assistantProfileId);
      if (!profile) throw new WebChatConnectionNotFoundError("Assistant Profile was not found.");
      this.assertExecutable(profile);
    }
    if (current.status === status) return current;
    if (current.status !== "active" && status === "active") await this.assertCapacity(context);
    const updated = await this.connections.updateStatus(context, current.companyId, current.id, status, this.clock.now());
    if (!updated) throw new WebChatConnectionNotFoundError("Web Chat Connection was not found.");
    return updated;
  }

  public async resolveActiveByPublicId(publicIdValue: unknown): Promise<WebChatConnection | null> {
    if (typeof publicIdValue !== "string") return null;
    try { return await this.active(await this.connections.findActiveByPublicId(webChatConnectionPublicId(publicIdValue))); }
    catch { return null; }
  }

  public async resolveActiveById(connectionIdValue: unknown): Promise<WebChatConnection | null> {
    if (typeof connectionIdValue !== "string") return null;
    try { return await this.active(await this.connections.findActiveById(webChatConnectionId(connectionIdValue))); }
    catch { return null; }
  }

  private async company(context: WorkspaceContext, id: number): Promise<void> {
    if (!await this.companies.findById(context, id)) throw new WebChatConnectionNotFoundError("Company was not found.");
  }

  private async active(connection: WebChatConnection | null): Promise<WebChatConnection | null> {
    if (!connection) return null;
    const profile = await this.profiles.findById({ workspaceId: connection.workspaceId, workspaceKey: "public" }, connection.companyId, connection.assistantProfileId);
    if (!profile) return null;
    try { this.profilePolicy.assert(profile); return connection; }
    catch { return null; }
  }

  private assertExecutable(profile: Parameters<AssistantProfileExecutionPolicy["assert"]>[0]): void {
    try { this.profilePolicy.assert(profile); }
    catch (error: unknown) {
      if (error instanceof AssistantProfilePolicyError) throw new WebChatConnectionProfileNotExecutableError("Assistant Profile is not executable.");
      throw error;
    }
  }
  private async assertCapacity(context: WorkspaceContext): Promise<void> {
    try { if (this.entitlements) assertBillingEntitlement(await this.entitlements.mayActivateChannel(context.workspaceId)); }
    catch (error: unknown) { if (error instanceof BillingEntitlementDeniedError) throw new WebChatConnectionCapacityError(error.message); throw error; }
  }
}

function parseCompanyId(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new WebChatConnectionValidationError("Company ID is invalid.");
  return parsed;
}

function parseConnectionId(value: unknown): ReturnType<typeof webChatConnectionId> {
  if (typeof value !== "string") throw new WebChatConnectionValidationError("Web Chat Connection ID is invalid.");
  try { return webChatConnectionId(value); }
  catch { throw new WebChatConnectionValidationError("Web Chat Connection ID is invalid."); }
}

function createInput(value: unknown): ReturnType<typeof assistantProfileId> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WebChatConnectionValidationError("Web Chat Connection input is invalid.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.assistantProfileId !== "string") throw new WebChatConnectionValidationError("Web Chat Connection input is invalid.");
  try { return assistantProfileId(record.assistantProfileId); }
  catch { throw new WebChatConnectionValidationError("Web Chat Connection input is invalid."); }
}

function statusInput(value: unknown): WebChatConnectionStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WebChatConnectionValidationError("Web Chat Connection status is invalid.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.status !== "string") throw new WebChatConnectionValidationError("Web Chat Connection status is invalid.");
  try { return webChatConnectionStatus(record.status); }
  catch { throw new WebChatConnectionValidationError("Web Chat Connection status is invalid."); }
}
