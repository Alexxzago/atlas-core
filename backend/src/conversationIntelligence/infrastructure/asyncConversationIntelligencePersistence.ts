import type { SqlDatabase } from "../../config/sqlDatabase.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { ConversationId, ConversationMessageId } from "../../conversation/domain/conversation.js";
import type { ConversationIntelligenceRepositoryPort } from "../application/ports.js";
import { conversationValue, type ConversationFact, type ConversationFactSourceKind, type ConversationIntelligenceState } from "../domain/conversationIntelligence.js";

interface StateRow extends Record<string, unknown> { readonly conversation_id: string; readonly active_intent_json: string | null; readonly version: number; readonly created_at: string; readonly updated_at: string; }
interface FactRow extends Record<string, unknown> { readonly fact_key: string; readonly value_json: string; readonly authority: ConversationFact["authority"]; readonly source_kind: ConversationFact["sourceKind"]; readonly source_message_id: string | null; readonly source_tool_trace_id: string | null; readonly source_order: string; readonly updated_at: string; }
interface PendingRow extends Record<string, unknown> { readonly pending_key: string; readonly asked_at: string | null; readonly created_at: string; }
interface GroupRow extends Record<string, unknown> { readonly id: string; readonly group_kind: string; readonly status: "active" | "stale"; readonly source_message_id: string | null; readonly source_tool_trace_id: string | null; readonly created_at: string; readonly stale_at: string | null; readonly expires_at: string | null; }
interface OptionRow extends Record<string, unknown> { readonly reference_id: string; readonly ordinal: number; readonly label: string; readonly safe_payload_json: string; }
interface ToolMemoryRow extends Record<string, unknown> { readonly id: string; readonly tool_trace_id: string; readonly category: string; readonly value_json: string; readonly created_at: string; }

export class AsyncConversationIntelligencePersistence implements ConversationIntelligenceRepositoryPort {
  public constructor(private readonly database: SqlDatabase) {}

  public async find(context: WorkspaceContext, companyId: number, conversationId: ConversationId): Promise<ConversationIntelligenceState | null> {
    return this.findFrom(this.database, context, companyId, conversationId);
  }

  private async findFrom(database: SqlDatabase, context: WorkspaceContext, companyId: number, conversationId: ConversationId): Promise<ConversationIntelligenceState | null> {
    const states = await database.query<StateRow>("SELECT s.conversation_id,s.active_intent_json,s.version,s.created_at,s.updated_at FROM conversation_intelligence_states s JOIN conversations c ON c.id=s.conversation_id WHERE s.workspace_id=? AND s.company_id=? AND c.company_id=? AND s.conversation_id=?", [context.workspaceId, companyId, companyId, conversationId]);
    const state = states[0];
    if (!state) return null;
    const [facts, pending, groups, toolMemory] = await Promise.all([
      database.query<FactRow>("SELECT fact_key,value_json,authority,source_kind,source_message_id,source_tool_trace_id,source_order,updated_at FROM conversation_intelligence_facts WHERE conversation_id=? ORDER BY updated_at DESC,fact_key", [conversationId]),
      database.query<PendingRow>("SELECT pending_key,asked_at,created_at FROM conversation_intelligence_pending_items WHERE conversation_id=? ORDER BY created_at,pending_key", [conversationId]),
      database.query<GroupRow>("SELECT id,group_kind,status,source_message_id,source_tool_trace_id,created_at,stale_at,expires_at FROM conversation_intelligence_reference_groups WHERE conversation_id=? ORDER BY created_at DESC,id DESC", [conversationId]),
      database.query<ToolMemoryRow>("SELECT id,tool_trace_id,category,value_json,created_at FROM conversation_intelligence_tool_memory WHERE conversation_id=? ORDER BY created_at DESC,id DESC", [conversationId]),
    ]);
    const options = await Promise.all(groups.map((group) => database.query<OptionRow>("SELECT reference_id,ordinal,label,safe_payload_json FROM conversation_intelligence_reference_options WHERE group_id=? ORDER BY ordinal", [group.id])));
    return Object.freeze({
      conversationId: state.conversation_id as ConversationId,
      version: state.version,
      activeIntent: state.active_intent_json === null ? null : value(state.active_intent_json),
      facts: Object.freeze(facts.map((fact) => Object.freeze({ key: fact.fact_key, value: value(fact.value_json), authority: fact.authority, sourceKind: fact.source_kind, sourceMessageId: fact.source_message_id as ConversationMessageId | null, sourceToolTraceId: fact.source_tool_trace_id, sourceOrder: fact.source_order, updatedAt: fact.updated_at }))),
      pending: Object.freeze(pending.map((item) => Object.freeze({ key: item.pending_key, askedAt: item.asked_at, createdAt: item.created_at }))),
      referenceGroups: Object.freeze(groups.map((group, index) => Object.freeze({ id: group.id, kind: group.group_kind, status: group.status, sourceMessageId: group.source_message_id as ConversationMessageId | null, sourceToolTraceId: group.source_tool_trace_id, createdAt: group.created_at, staleAt: group.stale_at, expiresAt: group.expires_at, options: Object.freeze(options[index]!.map((item) => Object.freeze({ referenceId: item.reference_id, ordinal: item.ordinal, label: item.label, safePayload: value(item.safe_payload_json) }))) }))),
      toolMemory: Object.freeze(toolMemory.map((item) => Object.freeze({ id: item.id, traceId: item.tool_trace_id, category: item.category, value: value(item.value_json), createdAt: item.created_at }))),
      createdAt: state.created_at,
      updatedAt: state.updated_at,
    });
  }

  public async isApplied(context: WorkspaceContext, companyId: number, conversationId: ConversationId, messageId: ConversationMessageId): Promise<boolean> {
    const rows = await this.database.query<{ readonly present: number }>("SELECT 1 AS present FROM conversation_intelligence_applied_messages a JOIN conversation_intelligence_states s ON s.conversation_id=a.conversation_id WHERE s.workspace_id=? AND s.company_id=? AND a.conversation_id=? AND a.conversation_message_id=?", [context.workspaceId, companyId, conversationId, messageId]);
    return rows.length === 1;
  }

  public async compareAndSet(context: WorkspaceContext, companyId: number, conversationId: ConversationId, expectedVersion: number | null, valueToSave: { readonly state: ConversationIntelligenceState; readonly appliedMessageId: ConversationMessageId; readonly sourceKind: ConversationFactSourceKind; readonly at: string }): Promise<ConversationIntelligenceState | null> {
    return this.database.transaction(async (database) => {
      const owned = await database.query<{ readonly present: number }>("SELECT 1 AS present FROM conversations c JOIN companies co ON co.id=c.company_id WHERE co.workspace_id=? AND c.company_id=? AND c.id=?", [context.workspaceId, companyId, conversationId]);
      if (owned.length === 0) return null;
      const applied = await database.query<{ readonly present: number }>("SELECT 1 AS present FROM conversation_intelligence_applied_messages WHERE conversation_id=? AND conversation_message_id=?", [conversationId, valueToSave.appliedMessageId]);
      if (applied.length !== 0) return null;
      const nextVersion = (expectedVersion ?? 0) + 1;
      const write = expectedVersion === null
        ? await database.execute("INSERT INTO conversation_intelligence_states(conversation_id,workspace_id,company_id,active_intent_json,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(conversation_id) DO NOTHING", [conversationId, context.workspaceId, companyId, valueToSave.state.activeIntent === null ? null : json(valueToSave.state.activeIntent), nextVersion, valueToSave.at, valueToSave.at])
        : await database.execute("UPDATE conversation_intelligence_states SET active_intent_json=?,version=?,updated_at=? WHERE conversation_id=? AND workspace_id=? AND company_id=? AND version=?", [valueToSave.state.activeIntent === null ? null : json(valueToSave.state.activeIntent), nextVersion, valueToSave.at, conversationId, context.workspaceId, companyId, expectedVersion]);
      if (Number(write.rowsAffected) !== 1) return null;

      for (const table of ["conversation_intelligence_facts", "conversation_intelligence_pending_items", "conversation_intelligence_reference_groups", "conversation_intelligence_tool_memory"]) await database.execute(`DELETE FROM ${table} WHERE conversation_id=?`, [conversationId]);
      for (const fact of valueToSave.state.facts) await database.execute("INSERT INTO conversation_intelligence_facts(conversation_id,fact_key,value_json,authority,source_kind,source_message_id,source_tool_trace_id,source_order,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", [conversationId, fact.key, json(fact.value), fact.authority, fact.sourceKind, fact.sourceMessageId, fact.sourceToolTraceId, fact.sourceOrder, fact.updatedAt]);
      for (const pending of valueToSave.state.pending) await database.execute("INSERT INTO conversation_intelligence_pending_items(conversation_id,pending_key,asked_at,created_at) VALUES(?,?,?,?)", [conversationId, pending.key, pending.askedAt, pending.createdAt]);
      for (const group of valueToSave.state.referenceGroups) {
        await database.execute("INSERT INTO conversation_intelligence_reference_groups(id,conversation_id,group_kind,status,source_message_id,source_tool_trace_id,created_at,stale_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)", [group.id, conversationId, group.kind, group.status, group.sourceMessageId, group.sourceToolTraceId, group.createdAt, group.staleAt, group.expiresAt]);
        for (const option of group.options) await database.execute("INSERT INTO conversation_intelligence_reference_options(group_id,reference_id,ordinal,label,safe_payload_json) VALUES(?,?,?,?,?)", [group.id, option.referenceId, option.ordinal, option.label, json(option.safePayload)]);
      }
      for (const memory of valueToSave.state.toolMemory) await database.execute("INSERT INTO conversation_intelligence_tool_memory(id,conversation_id,tool_trace_id,category,value_json,created_at) VALUES(?,?,?,?,?,?)", [memory.id, conversationId, memory.traceId, memory.category, json(memory.value), memory.createdAt]);
      await database.execute("INSERT INTO conversation_intelligence_applied_messages(conversation_id,conversation_message_id,state_version,applied_at) SELECT ?,m.id,?,? FROM conversation_messages m WHERE m.id=? AND m.conversation_id=?", [conversationId, nextVersion, valueToSave.at, valueToSave.appliedMessageId, conversationId]);
      return this.findFrom(database, context, companyId, conversationId);
    });
  }
}

function json(valueToEncode: unknown): string { return JSON.stringify(valueToEncode); }
function value(serialized: string): ReturnType<typeof conversationValue> { try { return conversationValue(JSON.parse(serialized)); } catch { throw new Error("Conversation intelligence value is invalid."); } }
