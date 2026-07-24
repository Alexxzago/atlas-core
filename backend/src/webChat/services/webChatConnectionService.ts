import { randomUUID } from "node:crypto";
import type { CompanyRepositoryPort } from "../../application/ports/repositories.js";
import type { AssistantProfileRepositoryPort } from "../../assistant/application/ports.js";
import { assistantProfileId } from "../../assistant/domain/assistantProfile.js";
import { AssistantProfileExecutionPolicy, AssistantProfilePolicyError } from "../../assistant/domain/assistantProfilePolicies.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { WebChatConnectionRepositoryPort } from "../application/ports.js";
import { reconstructWebChatConnection, webChatConnectionId, webChatConnectionPublicId, webChatConnectionStatus, type WebChatConnection, type WebChatConnectionStatus } from "../domain/webChatConnection.js";

export class WebChatConnectionValidationError extends Error {}
export class WebChatConnectionNotFoundError extends Error {}
export class WebChatConnectionProfileNotExecutableError extends Error {}

export interface WebChatConnectionClock { now(): string; }

export class WebChatConnectionService {
  private readonly profilePolicy = new AssistantProfileExecutionPolicy();

  public constructor(
    private readonly companies: CompanyRepositoryPort,
    private readonly profiles: AssistantProfileRepositoryPort,
    private readonly connections: WebChatConnectionRepositoryPort,
    private readonly clock: WebChatConnectionClock,
  ) {}

  public create(context: WorkspaceContext, companyIdValue: unknown, value: unknown): WebChatConnection {
    const companyId = parseCompanyId(companyIdValue), profileId = createInput(value);
    this.company(context, companyId);
    const profile = this.profiles.findById(context, companyId, profileId);
    if (!profile) throw new WebChatConnectionNotFoundError("Assistant Profile was not found.");
    this.assertExecutable(profile);
    const now = this.clock.now();
    const created = this.connections.create(context, reconstructWebChatConnection({
      id: webChatConnectionId(`wcc_${randomUUID().replaceAll("-", "")}`),
      publicId: webChatConnectionPublicId(`wcp_${randomUUID().replaceAll("-", "")}`),
      workspaceId: context.workspaceId, companyId, assistantProfileId: profile.id, status: "active", createdAt: now, updatedAt: now,
    }));
    if (!created) throw new WebChatConnectionNotFoundError("Web Chat Connection could not be created.");
    return created;
  }

  public list(context: WorkspaceContext, companyIdValue: unknown): WebChatConnection[] {
    const id = parseCompanyId(companyIdValue); this.company(context, id); return this.connections.listByCompany(context, id);
  }

  public get(context: WorkspaceContext, companyIdValue: unknown, connectionIdValue: unknown): WebChatConnection {
    const company = parseCompanyId(companyIdValue), id = parseConnectionId(connectionIdValue);
    const value = this.connections.findById(context, company, id);
    if (!value) throw new WebChatConnectionNotFoundError("Web Chat Connection was not found.");
    return value;
  }

  public setStatus(context: WorkspaceContext, companyIdValue: unknown, connectionIdValue: unknown, value: unknown): WebChatConnection {
    const current = this.get(context, companyIdValue, connectionIdValue), status = statusInput(value);
    if (status === "active") {
      this.company(context, current.companyId);
      const profile = this.profiles.findById(context, current.companyId, current.assistantProfileId);
      if (!profile) throw new WebChatConnectionNotFoundError("Assistant Profile was not found.");
      this.assertExecutable(profile);
    }
    if (current.status === status) return current;
    const updated = this.connections.updateStatus(context, current.companyId, current.id, status, this.clock.now());
    if (!updated) throw new WebChatConnectionNotFoundError("Web Chat Connection was not found.");
    return updated;
  }

  public resolveActiveByPublicId(publicIdValue: unknown): WebChatConnection | null {
    if (typeof publicIdValue !== "string") return null;
    try { return this.connections.findActiveByPublicId(webChatConnectionPublicId(publicIdValue)); }
    catch { return null; }
  }

  private company(context: WorkspaceContext, id: number): void {
    if (!this.companies.findById(context, id)) throw new WebChatConnectionNotFoundError("Company was not found.");
  }

  private assertExecutable(profile: Parameters<AssistantProfileExecutionPolicy["assert"]>[0]): void {
    try { this.profilePolicy.assert(profile); }
    catch (error: unknown) {
      if (error instanceof AssistantProfilePolicyError) throw new WebChatConnectionProfileNotExecutableError("Assistant Profile is not executable.");
      throw error;
    }
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
