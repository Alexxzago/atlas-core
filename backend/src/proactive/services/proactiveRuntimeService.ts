import type { CompanyRepositoryPort } from "../../application/ports/repositories.js";
import type { AssistantProfileRepositoryPort } from "../../assistant/application/ports.js";
import { assistantProfileId } from "../../assistant/domain/assistantProfile.js";
import { AssistantProfileExecutionPolicy } from "../../assistant/domain/assistantProfilePolicies.js";
import type { OperationalAssistantRuntime } from "../../assistant/services/operationalAssistantRuntime.js";
import { historyFor } from "../../assistant/services/operationalConversationTurnService.js";
import type { ConversationService } from "../../conversation/services/conversationService.js";
import { conversationId } from "../../conversation/domain/conversation.js";
import type { ConversationIntelligenceService } from "../../conversationIntelligence/services/conversationIntelligenceService.js";
import { conversationWorkingMemory } from "../../conversationIntelligence/services/conversationWorkingMemory.js";
import type { Clock } from "../../identity/application/ports.js";
import type { CompanyKnowledgeVersion } from "../../knowledge/domain/knowledge.js";
import type { LexicalKnowledgeRetrievalService } from "../../knowledgeV2/services/knowledgeRetrievalService.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { ProactiveActionRepositoryPort } from "../application/ports.js";
import type { ProactiveActionLease } from "../domain/proactiveAction.js";

const followUpInstruction = "Continue the existing conversation with an appropriate useful follow-up based only on authorized current context.";
const leaseExtensionMilliseconds = 60_000;
const historyLimit = 20;
type HeartbeatScheduler = (callback: () => void, milliseconds: number) => () => void;

const systemHeartbeatScheduler: HeartbeatScheduler = (callback, milliseconds) => {
  const timer = setInterval(callback, milliseconds);
  timer.unref();
  return () => clearInterval(timer);
};

/** Runs a leased follow-up through the existing assistant runtime without creating a conversation artifact. */
export class ProactiveRuntimeService {
  private readonly profilePolicy = new AssistantProfileExecutionPolicy();

  public constructor(
    private readonly actions: ProactiveActionRepositoryPort,
    private readonly companies: CompanyRepositoryPort,
    private readonly knowledge: { loadCurrentVersion(context: WorkspaceContext, companyId: number): CompanyKnowledgeVersion | null },
    private readonly profiles: AssistantProfileRepositoryPort,
    private readonly conversations: ConversationService,
    private readonly runtime: OperationalAssistantRuntime,
    private readonly clock: Clock,
    private readonly intelligence?: ConversationIntelligenceService,
    private readonly retrieval?: LexicalKnowledgeRetrievalService,
    private readonly heartbeatIntervalMilliseconds = Math.floor(leaseExtensionMilliseconds / 3),
    private readonly scheduleHeartbeat: HeartbeatScheduler = systemHeartbeatScheduler,
  ) {}

  public async execute(lease: ProactiveActionLease): Promise<void> {
    const action = lease.action, context: WorkspaceContext = { workspaceId: action.workspaceId, workspaceKey: "proactive" }, now = this.clock.now();
    if (this.actions.validateClaim(lease, now) !== "valid") return;
    const company = this.companies.findById(context, action.companyId);
    const profile = this.profiles.findById(context, action.companyId, assistantProfileId(action.assistantProfileId));
    const knowledge = this.knowledge.loadCurrentVersion(context, action.companyId);
    if (!company || !profile || !knowledge || company.status !== "ready") { this.actions.suppressClaim(lease, now, "proactive_runtime_unavailable"); return; }
    try { this.profilePolicy.assert(profile); }
    catch { this.actions.suppressClaim(lease, now, "assistant_profile_unavailable"); return; }
    const conversation = conversationId(action.conversationId);
    const history = historyFor(this.conversations.listMessages(context, action.companyId, conversation), historyLimit);
    const memory = this.intelligence?.state(context, action.companyId, conversation);
    const heartbeat = this.startHeartbeat(lease);
    try {
      const executed = await this.runtime.execute(company, profile, knowledge, followUpInstruction, history, {
        purpose: "proactive_execution", provider: "gemini", fallbackOnUnavailable: true, proactiveActionId: action.id,
        conversationMemory: memory ? conversationWorkingMemory(memory) : "",
        snapshotContext: { conversationId: action.conversationId, whatsAppConnectionId: action.whatsAppConnectionId, authorityGeneration: action.expectedAuthorityGeneration, channelProvider: "whatsapp" },
        ...(this.retrieval ? { retrieval: this.retrieval.context(context, action.companyId, knowledge.sourceRevisionIds, followUpInstruction) } : {}),
      });
      this.actions.selectCompletedExecution(context, action.companyId, { actionId: action.id, executionRecordId: executed.record.id, leaseToken: lease.leaseToken, now: this.clock.now() });
    } catch {
      // Runtime evidence retains the provider category; action audit stores only this safe classification.
      this.actions.scheduleRetry(lease, this.clock.now(), "proactive_runtime_transient");
    } finally { heartbeat(); }
  }

  private startHeartbeat(lease: ProactiveActionLease): () => void {
    return this.scheduleHeartbeat(() => {
      const now = this.clock.now();
      this.actions.renewClaim(lease, now, new Date(Date.parse(now) + leaseExtensionMilliseconds).toISOString());
    }, this.heartbeatIntervalMilliseconds);
  }
}
