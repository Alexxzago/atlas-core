import type { ToolAvailabilityPolicy } from "../../assistant/application/toolContracts.js";
import type { ToolDefinition } from "../../assistant/domain/tool.js";
import type { IntegrationReadinessPort } from "../../integrations/application/ports.js";

export class LiveDataToolAvailabilityPolicy implements ToolAvailabilityPolicy {
  public constructor(private readonly fallback: ToolAvailabilityPolicy, private readonly readiness: IntegrationReadinessPort) {}
  public async isAvailable(definition: ToolDefinition, context: { readonly workspaceId: number; readonly companyId: number; readonly assistantProfileId: string }): Promise<boolean> {
    if (!await this.fallback.isAvailable(definition, context)) return false;
    const requirement = definition.liveData;
    return !requirement || this.readiness.isReadyForTool(context, context.companyId, requirement.provider, requirement.kind);
  }
}
