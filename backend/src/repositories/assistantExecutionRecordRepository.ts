import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { AssistantExecutionRecordRepositoryPort } from "../assistant/application/operationalAssistantRuntime.js";
import { assistantExecutionRecordId, type AssistantExecutionRecord, type AssistantExecutionRecordId, type AssistantExecutionRecordState, type AssistantProfileRuntimeSnapshot, type AssistantRuntimePurpose, type PublishedKnowledgeSnapshotReference } from "../assistant/domain/operationalAssistantRuntime.js";
import { assistantProfileId } from "../assistant/domain/assistantProfile.js";

interface Row { id:string;company_id:number;assistant_profile_id:string;profile_snapshot_json:string;knowledge_version_id:string;provider:string;purpose:AssistantRuntimePurpose;state:AssistantExecutionRecordState;fallback_used:number;result:string|null;input_tokens:number|null;output_tokens:number|null;error_code:string|null;started_at:string;completed_at:string|null;duration_milliseconds:number|null;version_number:number;snapshot_digest:string; }

function record(row: Row): AssistantExecutionRecord {
  const snapshot = JSON.parse(row.profile_snapshot_json) as AssistantProfileRuntimeSnapshot;
  const knowledgeSnapshot: PublishedKnowledgeSnapshotReference = { versionId: row.knowledge_version_id, versionNumber: row.version_number, snapshotDigest: row.snapshot_digest };
  return Object.freeze({ id: assistantExecutionRecordId(row.id), companyId: row.company_id, profileId: assistantProfileId(row.assistant_profile_id), profileSnapshot: Object.freeze(snapshot), knowledgeSnapshot: Object.freeze(knowledgeSnapshot), provider: row.provider, purpose: row.purpose, state: row.state, fallbackUsed: row.fallback_used === 1, result: row.result, inputTokens: row.input_tokens, outputTokens: row.output_tokens, errorCode: row.error_code, startedAt: row.started_at, completedAt: row.completed_at, durationMilliseconds: row.duration_milliseconds });
}

export class AssistantExecutionRecordRepository implements AssistantExecutionRecordRepositoryPort {
  public constructor(private readonly db: SynchronousDatabase) {}

  public create(value: AssistantExecutionRecord): AssistantExecutionRecord {
    const result = this.db.prepare(`
      INSERT INTO assistant_execution_records (
        id, company_id, assistant_profile_id, profile_snapshot_json, knowledge_version_id, provider, purpose,
        state, fallback_used, result, input_tokens, output_tokens, error_code, started_at, completed_at, duration_milliseconds
      ) SELECT ?, c.id, p.id, ?, kv.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM companies c
      INNER JOIN assistant_profiles p ON p.id = ? AND p.company_id = c.id
      INNER JOIN company_knowledge_versions kv ON kv.id = ? AND kv.company_id = c.id
      WHERE c.id = ?
    `).run(value.id, JSON.stringify(value.profileSnapshot), value.provider, value.purpose, value.state, value.fallbackUsed ? 1 : 0,
      value.result, value.inputTokens, value.outputTokens, value.errorCode, value.startedAt, value.completedAt,
      value.durationMilliseconds, value.profileId, value.knowledgeSnapshot.versionId, value.companyId);
    if (result.changes !== 1) throw new Error("Assistant execution record ownership could not be persisted.");
    return value;
  }

  public complete(value: AssistantExecutionRecord, expectedState: "started"): boolean {
    return this.db.prepare(`
      UPDATE assistant_execution_records
      SET state = ?, fallback_used = ?, result = ?, input_tokens = ?, output_tokens = ?, error_code = ?,
        completed_at = ?, duration_milliseconds = ?
      WHERE id = ? AND state = ?
    `).run(value.state, value.fallbackUsed ? 1 : 0, value.result, value.inputTokens, value.outputTokens,
      value.errorCode, value.completedAt, value.durationMilliseconds, value.id, expectedState).changes === 1;
  }

  public findById(id: AssistantExecutionRecordId): AssistantExecutionRecord | null {
    const row = this.db.prepare(`
      SELECT r.*, kv.version_number, kv.snapshot_digest
      FROM assistant_execution_records r
      INNER JOIN company_knowledge_versions kv ON kv.id = r.knowledge_version_id
      WHERE r.id = ?
    `).get(id) as Row | undefined;
    return row ? record(row) : null;
  }
}
