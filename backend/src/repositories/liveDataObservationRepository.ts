import type { SqlDatabase } from "../config/sqlDatabase.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import type { LiveDataObservationRepositoryPort } from "../liveData/application/ports.js";
import { liveDataObservationId, reconstructLiveDataObservation, type LiveDataObservation, type LiveDataObservationId } from "../liveData/domain/liveData.js";

interface Row extends Record<string, unknown> { id: string; tool_trace_id: string; workspace_id: number; company_id: number; resource_type: "observation"; provider: string; outcome: "confirmed" | "empty" | "not_found" | "unavailable"; observed_at: string; fetched_at: string; expires_at: string; freshness: "fresh" | "stale" | "expired"; safe_payload_json: string; }
export class LiveDataObservationRepository implements LiveDataObservationRepositoryPort {
  public constructor(private readonly database: SqlDatabase) {}
  public async create(context: WorkspaceContext, value: LiveDataObservation): Promise<LiveDataObservation | null> {
    return this.database.transaction(async (database) => {
      const result = await database.execute("INSERT INTO live_data_observations(id,tool_trace_id,workspace_id,company_id,resource_type,provider,outcome,observed_at,fetched_at,expires_at,freshness,safe_payload_json) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM companies WHERE id=? AND workspace_id=?)", [value.id, value.toolTraceId, context.workspaceId, value.companyId, value.resourceType, value.provider, value.outcome, value.observedAt, value.fetchedAt, value.expiresAt, value.freshness, value.safePayloadJson, value.companyId, context.workspaceId]);
      if (Number(result.rowsAffected) !== 1) return null;
      return value;
    });
  }
  public async findLatest(context: WorkspaceContext, companyId: number, resourceType: string): Promise<LiveDataObservation | null> { return this.findOne("SELECT * FROM live_data_observations WHERE workspace_id=? AND company_id=? AND resource_type=? ORDER BY observed_at DESC,id DESC LIMIT 1", [context.workspaceId, companyId, resourceType]); }
  public async findById(context: WorkspaceContext, companyId: number, id: LiveDataObservationId): Promise<LiveDataObservation | null> { return this.findOne("SELECT * FROM live_data_observations WHERE workspace_id=? AND company_id=? AND id=?", [context.workspaceId, companyId, id]); }
  private async findOne(sql: string, args: readonly (string | number)[]): Promise<LiveDataObservation | null> { const rows = await this.database.query<Row>(sql, args); return rows[0] ? map(rows[0]) : null; }
}
function map(row: Row): LiveDataObservation { return reconstructLiveDataObservation({ id: liveDataObservationId(row.id), toolTraceId: row.tool_trace_id, workspaceId: row.workspace_id, companyId: row.company_id, resourceType: row.resource_type, provider: row.provider, outcome: row.outcome, observedAt: row.observed_at, fetchedAt: row.fetched_at, expiresAt: row.expires_at, freshness: row.freshness, safePayloadJson: row.safe_payload_json }); }
