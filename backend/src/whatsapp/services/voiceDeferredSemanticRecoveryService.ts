import type { ConversationIntelligenceService } from "../../conversationIntelligence/services/conversationIntelligenceService.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { AsyncVoiceLookupPort, VoiceRepositoryPort } from "../application/voicePorts.js";

/** Applies durable voice semantics through the existing applied-message ledger. */
export class VoiceDeferredSemanticRecoveryService {
  public constructor(private readonly voices: Pick<AsyncVoiceLookupPort, "findCompletedInboundTranscriptMessages" | "findVisibleDeferredAssistantMessages" | "recoverableSemanticScopes"> | Pick<VoiceRepositoryPort, "findCompletedInboundTranscriptMessages" | "findVisibleDeferredAssistantMessages" | "recoverableSemanticScopes">, private readonly intelligence: ConversationIntelligenceService) {}

  public async recover(context: WorkspaceContext, companyId: number, limit = 25): Promise<number> {
    let applied = 0;
    for (const message of [...await this.voices.findCompletedInboundTranscriptMessages(context, companyId, limit), ...await this.voices.findVisibleDeferredAssistantMessages(context, companyId, limit)]) {
      if ((await this.intelligence.apply(context, companyId, message)).kind === "applied") applied += 1;
    }
    return applied;
  }

  public async recoverAvailable(limit = 25): Promise<number> {
    let applied = 0;
    for (const scope of await this.voices.recoverableSemanticScopes(limit)) applied += await this.recover({ workspaceId: scope.workspaceId, workspaceKey: "whatsapp" }, scope.companyId, limit);
    return applied;
  }
}
