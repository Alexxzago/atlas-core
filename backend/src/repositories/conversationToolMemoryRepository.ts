import { createHash } from "node:crypto";
import type { SqlDatabase } from "../config/sqlDatabase.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import type { ConversationId } from "../conversation/domain/conversation.js";
import { CONVERSATION_ACTIVE_GROUP_LIMIT, CONVERSATION_FACT_LIMIT, CONVERSATION_REFERENCE_OPTION_LIMIT, CONVERSATION_STALE_GROUP_LIMIT, CONVERSATION_TOOL_MEMORY_LIMIT } from "../conversationIntelligence/domain/conversationIntelligence.js";
import type { ConversationToolMemoryAppendResult, ConversationToolMemoryCandidate, ConversationToolMemoryRepositoryPort } from "../conversationIntelligence/application/ports.js";

const CATEGORY = "tool_result";

export class ConversationToolMemoryRepository implements ConversationToolMemoryRepositoryPort {
  public constructor(private readonly database: SqlDatabase) {}

  public async findVersion(context: WorkspaceContext, companyId: number, conversationId: ConversationId): Promise<number | null> {
    const rows = await this.database.query<{ version: number }>("SELECT version FROM conversation_intelligence_states WHERE workspace_id=? AND company_id=? AND conversation_id=?", [context.workspaceId, companyId, conversationId]);
    return rows[0]?.version ?? null;
  }

  public async append(context: WorkspaceContext, companyId: number, conversationId: ConversationId, expectedVersion: number, candidates: readonly ConversationToolMemoryCandidate[], at: string): Promise<ConversationToolMemoryAppendResult> {
    if (candidates.length === 0) return { kind: "already_applied", version: expectedVersion };
    return this.database.transaction(async (database) => {
      const state = await database.query<{ version: number }>("SELECT version FROM conversation_intelligence_states WHERE workspace_id=? AND company_id=? AND conversation_id=?", [context.workspaceId, companyId, conversationId]);
      if (!state[0]) return { kind: "rejected" };
      const applied = await Promise.all(candidates.map(async (candidate) => (await database.query<{ present: number }>("SELECT 1 AS present FROM conversation_intelligence_applied_tool_traces WHERE conversation_id=? AND tool_trace_id=?", [conversationId, candidate.traceId])).length === 1));
      if (applied.every(Boolean)) return { kind: "already_applied", version: state[0].version };
      for (const [index, candidate] of candidates.entries()) if (!applied[index] && !await ownsCompletedTrace(database, context, companyId, conversationId, candidate.traceId)) return { kind: "rejected" };
      if (state[0].version !== expectedVersion) return { kind: "conflict" };
      let inserted = false;
      for (const [index, candidate] of candidates.entries()) {
        if (applied[index]) continue;
        const result = await database.execute("INSERT INTO conversation_intelligence_tool_memory(id,conversation_id,tool_trace_id,category,value_json,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(conversation_id,tool_trace_id,category) DO NOTHING", [memoryId(conversationId, candidate.traceId), conversationId, candidate.traceId, CATEGORY, JSON.stringify(candidate.value), at]);
        inserted ||= Number(result.rowsAffected) === 1;
        for (const fact of candidate.facts) {
          const existingFact = await database.query<{ authority: string }>("SELECT authority FROM conversation_intelligence_facts WHERE conversation_id=? AND fact_key=?", [conversationId, fact.key]);
          if (existingFact[0]?.authority === "human_asserted") continue;
          await database.execute("INSERT INTO conversation_intelligence_facts(conversation_id,fact_key,value_json,authority,source_kind,source_message_id,source_tool_trace_id,source_order,updated_at) VALUES(?,?,?,'tool_observed','tool',NULL,?,?,?) ON CONFLICT(conversation_id,fact_key) DO UPDATE SET value_json=excluded.value_json,authority=excluded.authority,source_kind=excluded.source_kind,source_message_id=NULL,source_tool_trace_id=excluded.source_tool_trace_id,source_order=excluded.source_order,updated_at=excluded.updated_at", [conversationId, fact.key, JSON.stringify(fact.value), candidate.traceId, at, at]);
          inserted = true;
        }
        for (const group of candidate.referenceGroups) {
          await database.execute("UPDATE conversation_intelligence_reference_groups SET status='stale',stale_at=? WHERE conversation_id=? AND group_kind=? AND status='active'", [at, conversationId, group.groupKind]);
          const groupId = referenceGroupId(conversationId, candidate.traceId, group.groupKind);
          await database.execute("INSERT INTO conversation_intelligence_reference_groups(id,conversation_id,group_kind,status,source_message_id,source_tool_trace_id,created_at,stale_at,expires_at) VALUES(?,?,?,'active',NULL,?,?,NULL,NULL) ON CONFLICT(id) DO NOTHING", [groupId, conversationId, group.groupKind, candidate.traceId, at]);
          for (const [index, option] of group.options.entries()) await database.execute("INSERT INTO conversation_intelligence_reference_options(group_id,reference_id,ordinal,label,safe_payload_json) VALUES(?,?,?,?,?) ON CONFLICT(group_id,reference_id) DO NOTHING", [groupId, option.referenceId, index + 1, option.label, JSON.stringify(option.safePayload)]);
          inserted = true;
        }
        await database.execute("INSERT INTO conversation_intelligence_applied_tool_traces(conversation_id,tool_trace_id,applied_at) VALUES(?,?,?)", [conversationId, candidate.traceId, at]);
      }
      if (!inserted) return { kind: "already_applied", version: expectedVersion };
      const nextVersion = expectedVersion + 1;
      const updated = await database.execute("UPDATE conversation_intelligence_states SET version=?,updated_at=? WHERE workspace_id=? AND company_id=? AND conversation_id=? AND version=?", [nextVersion, at, context.workspaceId, companyId, conversationId, expectedVersion]);
      if (Number(updated.rowsAffected) !== 1) throw new Error("Conversation tool memory state changed during its transaction.");
      await database.execute("DELETE FROM conversation_intelligence_tool_memory WHERE conversation_id=? AND id IN (SELECT id FROM conversation_intelligence_tool_memory WHERE conversation_id=? ORDER BY created_at DESC,id DESC LIMIT -1 OFFSET ?)", [conversationId, conversationId, CONVERSATION_TOOL_MEMORY_LIMIT]);
      await database.execute("DELETE FROM conversation_intelligence_facts WHERE conversation_id=? AND fact_key IN (SELECT fact_key FROM conversation_intelligence_facts WHERE conversation_id=? ORDER BY updated_at DESC,fact_key LIMIT -1 OFFSET ?)", [conversationId, conversationId, CONVERSATION_FACT_LIMIT]);
      await database.execute("DELETE FROM conversation_intelligence_reference_groups WHERE conversation_id=? AND id IN (SELECT id FROM conversation_intelligence_reference_groups WHERE conversation_id=? AND status='active' ORDER BY created_at DESC,id DESC LIMIT -1 OFFSET ?)", [conversationId, conversationId, CONVERSATION_ACTIVE_GROUP_LIMIT]);
      await database.execute("DELETE FROM conversation_intelligence_reference_groups WHERE conversation_id=? AND id IN (SELECT id FROM conversation_intelligence_reference_groups WHERE conversation_id=? AND status='stale' ORDER BY created_at DESC,id DESC LIMIT -1 OFFSET ?)", [conversationId, conversationId, CONVERSATION_STALE_GROUP_LIMIT]);
      return { kind: "appended", version: nextVersion };
    });
  }
}

async function ownsCompletedTrace(database: SqlDatabase, context: WorkspaceContext, companyId: number, conversationId: ConversationId, traceId: string): Promise<boolean> {
  const rows = await database.query<{ present: number }>(`SELECT 1 AS present
    FROM tool_execution_traces t
    INNER JOIN assistant_execution_records r ON r.id=t.assistant_execution_record_id
    INNER JOIN conversations c ON c.id=?
    INNER JOIN companies co ON co.id=c.company_id
    WHERE t.id=? AND t.state='completed' AND t.workspace_id=? AND t.company_id=?
      AND r.company_id=? AND c.company_id=? AND co.workspace_id=?
      AND json_type(r.execution_snapshot_json,'$.conversationId')='text'
      AND json_extract(r.execution_snapshot_json,'$.conversationId')=?`, [conversationId, traceId, context.workspaceId, companyId, companyId, companyId, context.workspaceId, conversationId]);
  return rows.length === 1;
}

function memoryId(conversationId: string, traceId: string): string {
  return `ctm_${createHash("sha256").update(`${conversationId}:${traceId}:${CATEGORY}`).digest("hex").slice(0, 32)}`;
}
function referenceGroupId(conversationId: string, traceId: string, kind: string): string { return `crg_${createHash("sha256").update(`${conversationId}:${traceId}:${kind}`).digest("hex").slice(0, 32)}`; }
