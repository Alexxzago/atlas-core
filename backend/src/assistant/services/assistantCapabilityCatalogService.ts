import type { ToolAvailabilityPolicy } from "../application/toolContracts.js";
import type { ToolRegistry } from "../application/toolRegistry.js";
import { type AssistantCapabilityKey, AssistantCapabilityCatalog } from "../domain/assistantCapability.js";
import type { AssistantProfileCapabilityRepositoryPort } from "../application/toolContracts.js";
import { AssistantCapabilityNotFoundError } from "./assistantCapabilityService.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export type AssistantCapabilityAvailability = "available" | "unavailable" | "degraded";
export type AssistantCapabilityConsequence = "read_only" | "consequential";
export interface AssistantCapabilityCatalogItem {
  readonly id: AssistantCapabilityKey;
  readonly assigned: boolean;
  readonly availability: AssistantCapabilityAvailability;
  readonly consequence: AssistantCapabilityConsequence;
  readonly safeReason: string | null;
  readonly safeNextAction: string | null;
  readonly toolCount: number;
}

export class AssistantCapabilityCatalogService {
  public constructor(private readonly catalog: AssistantCapabilityCatalog, private readonly repository: AssistantProfileCapabilityRepositoryPort, private readonly tools: ToolRegistry, private readonly availability: ToolAvailabilityPolicy) {}

  public async list(context: WorkspaceContext, companyId: unknown, profileId: unknown): Promise<readonly AssistantCapabilityCatalogItem[]> {
    const company = parseCompany(companyId), profile = parseProfile(profileId);
    if (!await this.repository.existsForProfile(context, company, profile)) throw new AssistantCapabilityNotFoundError("Assistant Profile was not found.");
    const assigned = new Set(await this.repository.listForProfile(context, company, profile));
    return Object.freeze(await Promise.all(this.catalog.list().map(async (definition) => {
      const matching = this.tools.list().filter((tool) => tool.requiredCapabilities.includes(definition.key));
      const states = await Promise.all(matching.map((tool) => this.availability.isAvailable(tool, { workspaceId: context.workspaceId, companyId: company, assistantProfileId: profile })));
      const available = states.filter(Boolean).length;
      const status: AssistantCapabilityAvailability = available === states.length ? "available" : available === 0 ? "unavailable" : "degraded";
      const needsAttention = status !== "available";
      return Object.freeze({ id: definition.key, assigned: assigned.has(definition.key), availability: status, consequence: matching.some((tool) => tool.operationClass !== "read") ? "consequential" : "read_only", safeReason: needsAttention ? "Esta capacidad necesita una integración configurada." : null, safeNextAction: needsAttention ? "Revisá las integraciones de la empresa." : null, toolCount: matching.length });
    })));
  }
}

function parseCompany(value: unknown): number { const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN; if (!Number.isSafeInteger(parsed) || parsed < 1) throw new AssistantCapabilityNotFoundError("Assistant Profile was not found."); return parsed; }
function parseProfile(value: unknown): string { if (typeof value !== "string" || !/^asp_[a-z0-9]{32}$/i.test(value)) throw new AssistantCapabilityNotFoundError("Assistant Profile was not found."); return value; }
