import type { ConversationIntelligenceService } from "../../conversationIntelligence/services/conversationIntelligenceService.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { ProactiveActionRepositoryPort } from "../application/ports.js";

/** Applies only externally committed proactive messages through the existing applied-message ledger. */
export class ProactiveSemanticRecoveryService {
  public constructor(private readonly actions: Pick<ProactiveActionRepositoryPort, "findVisibleAssistantMessages" | "recoverableSemanticScopes">, private readonly intelligence: ConversationIntelligenceService) {}

  public async recover(context: WorkspaceContext, companyId: number, limit = 25): Promise<number> {
    let applied = 0;
    for (const message of await this.actions.findVisibleAssistantMessages(context, companyId, limit)) if ((await this.intelligence.apply(context, companyId, message)).kind === "applied") applied += 1;
    return applied;
  }

  public async recoverAvailable(limit = 25): Promise<number> {
    let applied = 0;
    for (const scope of await this.actions.recoverableSemanticScopes(limit)) applied += await this.recover({ workspaceId: scope.workspaceId, workspaceKey: "proactive" }, scope.companyId, limit);
    return applied;
  }
}
