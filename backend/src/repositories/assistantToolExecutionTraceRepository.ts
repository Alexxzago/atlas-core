import type { SqlDatabase } from "../config/sqlDatabase.js";
import type { ToolExecutionTrace, ToolExecutionTraceRepositoryPort } from "../assistant/application/toolContracts.js";

export class AssistantToolExecutionTraceRepository implements ToolExecutionTraceRepositoryPort {
  public constructor(private readonly database: SqlDatabase) {}
  public async createRequested(value: ToolExecutionTrace & { readonly workspaceId: number; readonly companyId: number; readonly assistantProfileId: string; readonly auditInput: unknown; readonly requestedAt: string }): Promise<ToolExecutionTrace> {
    await this.database.execute(`INSERT INTO tool_execution_traces(id,assistant_execution_record_id,workspace_id,company_id,assistant_profile_id,model_tool_call_id,tool_name,state,audit_input_json,requested_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, [value.id,value.assistantExecutionRecordId,value.workspaceId,value.companyId,value.assistantProfileId,value.modelToolCallId,value.toolName,"requested",json(value.auditInput),value.requestedAt]);
    return Object.freeze({ id:value.id, assistantExecutionRecordId:value.assistantExecutionRecordId, modelToolCallId:value.modelToolCallId, toolName:value.toolName, state:"requested" });
  }
  public async complete(id: string, expectedState: "requested", value: { readonly auditOutput: unknown; readonly outputReference?: string | null; readonly completedAt: string; readonly durationMilliseconds: number }): Promise<boolean> {
    const result=await this.database.execute(`UPDATE tool_execution_traces SET state='completed',audit_output_json=?,output_reference=?,completed_at=?,duration_milliseconds=? WHERE id=? AND state=?`,[json(value.auditOutput),value.outputReference ?? null,value.completedAt,value.durationMilliseconds,id,expectedState]); return Number(result.rowsAffected)===1;
  }
  public async fail(id: string, expectedState: "requested", value: { readonly errorCode: string; readonly completedAt: string; readonly durationMilliseconds: number }): Promise<boolean> {
    const result=await this.database.execute(`UPDATE tool_execution_traces SET state='failed',error_code=?,completed_at=?,duration_milliseconds=? WHERE id=? AND state=?`,[value.errorCode,value.completedAt,value.durationMilliseconds,id,expectedState]); return Number(result.rowsAffected)===1;
  }
}
function json(value: unknown): string | null { return value === null || value === undefined ? null : JSON.stringify(value); }
