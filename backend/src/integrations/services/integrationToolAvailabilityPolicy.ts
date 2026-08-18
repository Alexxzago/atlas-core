import type { ToolAvailabilityPolicy } from "../../assistant/application/toolContracts.js";
import type { ToolDefinition } from "../../assistant/domain/tool.js";
import type { IntegrationReadinessPort } from "../application/ports.js";

/** Adds connection readiness checks without reading or exposing encrypted secrets. */
export class IntegrationToolAvailabilityPolicy implements ToolAvailabilityPolicy {
  public constructor(private readonly fallback: ToolAvailabilityPolicy, private readonly integrations: IntegrationReadinessPort) {}
  public async isAvailable(definition: ToolDefinition, context: { readonly workspaceId: number; readonly companyId: number; readonly assistantProfileId: string }): Promise<boolean> {
    if (!await this.fallback.isAvailable(definition, context)) return false;
    const requirement = definition.integration;
    return !requirement || this.integrations.isReadyForTool(context, context.companyId, requirement.provider, requirement.kind);
  }
}
