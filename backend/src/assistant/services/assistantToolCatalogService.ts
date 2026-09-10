import type { AssistantProfileCapabilityRepositoryPort, ToolAvailabilityPolicy } from "../application/toolContracts.js";
import type { ToolRegistry } from "../application/toolRegistry.js";
import { AssistantCapabilityNotFoundError } from "./assistantCapabilityService.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export type AssistantToolAvailability = "available" | "unavailable" | "degraded";
export interface AssistantToolCatalogItem {
  readonly id: string;
  readonly enabled: boolean;
  readonly availability: AssistantToolAvailability;
  readonly capabilityId: string;
  readonly safeReason: string | null;
  readonly safeNextAction: string | null;
}

/** Customer-safe projection of the production registry; definitions never leave this layer. */
export class AssistantToolCatalogService {
  public constructor(private readonly repository: AssistantProfileCapabilityRepositoryPort, private readonly tools: ToolRegistry, private readonly availability: ToolAvailabilityPolicy) {}

  public async list(context: WorkspaceContext, companyId: unknown, profileId: unknown): Promise<readonly AssistantToolCatalogItem[]> {
    const company = parseCompany(companyId), profile = parseProfile(profileId);
    if (!await this.repository.existsForProfile(context, company, profile)) throw new AssistantCapabilityNotFoundError("Assistant Profile was not found.");
    const assigned = new Set(await this.repository.listForProfile(context, company, profile));
    return Object.freeze(await Promise.all(this.tools.list().map(async (tool) => {
      if (tool.requiredCapabilities.length !== 1) throw new Error("Customer-visible tools require exactly one capability.");
      const available = await this.availability.isAvailable(tool, { workspaceId: context.workspaceId, companyId: company, assistantProfileId: profile });
      const capabilityId = tool.requiredCapabilities[0]!;
      return Object.freeze({
        id: tool.name,
        enabled: assigned.has(capabilityId),
        availability: available ? "available" : "unavailable",
        capabilityId,
        safeReason: available ? null : "Esta herramienta necesita una configuración pendiente.",
        safeNextAction: available ? null : "Revisá la configuración de la empresa.",
      });
    })));
  }
}

function parseCompany(value: unknown): number { const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN; if (!Number.isSafeInteger(parsed) || parsed < 1) throw new AssistantCapabilityNotFoundError("Assistant Profile was not found."); return parsed; }
function parseProfile(value: unknown): string { if (typeof value !== "string" || !/^asp_[a-z0-9]{32}$/i.test(value)) throw new AssistantCapabilityNotFoundError("Assistant Profile was not found."); return value; }
