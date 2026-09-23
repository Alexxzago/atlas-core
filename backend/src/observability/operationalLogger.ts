import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type OperationalLogLevel = "info" | "warn" | "error";
export type SafeErrorCategory = "validation" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "rate_limited" | "provider_timeout" | "provider_rejected" | "provider_unavailable" | "transport_failure" | "storage_failure" | "database_failure" | "internal_failure";
export interface OperationalContext { readonly requestId?: string; readonly runId?: string; }
export type OperationalLogFields = Partial<Record<"requestId" | "runId" | "workspaceId" | "companyId" | "conversationId" | "assistantProfileId" | "integrationConnectionId" | "whatsAppConnectionId" | "outboundDeliveryId" | "providerEventId" | "operationId" | "actionId" | "bookingId" | "billingOperationId" | "backupId" | "targetDatabaseName" | "provider" | "subsystem" | "outcome" | "phase" | "stage" | "safeErrorCategory" | "httpMethod" | "routePattern" | "httpStatus" | "durationMs" | "attempt" | "worker" | "unavailableWorkers" | "unavailableWorkerHealth" | "started" | "running" | "currentStage" | "lastSuccessfulCycleAt" | "lastFailedCycleAt" | "lastErrorCategory" | "lastFailedStage" | "consecutiveFailures" | "lastActivityAt" | "backlogUnsafe" | "staleLease" | "deploymentVersion" | "migrationHead" | "operation" | "scopeType" | "mediaObjectCount" | "completeSetsScanned" | "setsProtected" | "setsPruned" | "setsLocked" | "objectsDeleted" | "objectsLocked", string | number>>;
export interface OperationalLogRecord extends OperationalLogFields { readonly timestamp: string; readonly level: OperationalLogLevel; readonly event: string; }

const context = new AsyncLocalStorage<OperationalContext>();
const maximumRecordBytes = 4_096, maximumFields = 24, maximumStringLength = 160, identifier = /^[A-Za-z0-9_.:-]{1,160}$/;
const allowedFields = new Set(["requestId", "runId", "workspaceId", "companyId", "conversationId", "assistantProfileId", "integrationConnectionId", "whatsAppConnectionId", "outboundDeliveryId", "providerEventId", "operationId", "actionId", "bookingId", "billingOperationId", "backupId", "targetDatabaseName", "provider", "subsystem", "outcome", "phase", "stage", "safeErrorCategory", "httpMethod", "routePattern", "httpStatus", "durationMs", "attempt", "worker", "unavailableWorkers", "unavailableWorkerHealth", "started", "running", "currentStage", "lastSuccessfulCycleAt", "lastFailedCycleAt", "lastErrorCategory", "lastFailedStage", "consecutiveFailures", "lastActivityAt", "backlogUnsafe", "staleLease", "deploymentVersion", "migrationHead", "operation", "scopeType", "mediaObjectCount", "completeSetsScanned", "setsProtected", "setsPruned", "setsLocked", "objectsDeleted", "objectsLocked"]);
let sink: (line: string) => void = (line) => console.info(line);

function opaque(prefix: "req" | "run"): string { return `${prefix}_${randomUUID().replaceAll("-", "")}`; }
function string(value: string, route = false): string | null { return value.length <= maximumStringLength && (route ? /^\/[A-Za-z0-9_:/-]{0,159}$/.test(value) : identifier.test(value)) ? value : null; }
function field(key: string, value: string | number): string | number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647 ? value : null;
  if (key === "unavailableWorkerHealth") { try { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed) && parsed.length <= 10 && parsed.every(item => item !== null && typeof item === "object" && Object.values(item).every(entry => typeof entry === "string" && identifier.test(entry)))) return value; } catch {} return null; }
  return string(value, key === "routePattern");
}

export function createRequestId(): string { return opaque("req"); }
export function createRunId(): string { return opaque("run"); }
export function currentOperationalContext(): OperationalContext { return context.getStore() ?? {}; }
export function withRequestContext<T>(requestId: string, operation: () => T): T { return context.run({ requestId }, operation); }
export function withRunContext<T>(runId: string, operation: () => T): T { return context.run({ runId }, operation); }
export function normalizeOperationalError(error: unknown): SafeErrorCategory {
  if (!error || typeof error !== "object") return "internal_failure";
  const value = error as { name?: unknown; code?: unknown; status?: unknown };
  if (value.status === 400 || value.name === "SyntaxError") return "validation";
  if (value.status === 401) return "unauthorized";
  if (value.status === 403) return "forbidden";
  if (value.status === 404) return "not_found";
  if (value.status === 409) return "conflict";
  if (value.status === 429) return "rate_limited";
  if (value.name === "AbortError" || value.code === "ETIMEDOUT") return "provider_timeout";
  if (value.code === "ECONNREFUSED" || value.code === "ECONNRESET") return "transport_failure";
  return "internal_failure";
}

export class OperationalLogger {
  public emit(level: OperationalLogLevel, event: string, fields: OperationalLogFields = {}): void {
    const safeEvent = string(event); if (!safeEvent) return;
    const record: Record<string, string | number> = { timestamp: new Date().toISOString(), level, event: safeEvent };
    const inherited = currentOperationalContext();
    for (const [key, value] of Object.entries({ ...fields, ...inherited })) {
      if (!allowedFields.has(key)) continue;
      if (Object.keys(record).length >= maximumFields || value === undefined) break;
      const normalized = field(key, value); if (normalized !== null) record[key] = normalized;
    }
    let line = JSON.stringify(record);
    if (Buffer.byteLength(line, "utf8") > maximumRecordBytes) line = JSON.stringify({ timestamp: record.timestamp, level, event: safeEvent, safeErrorCategory: "internal_failure" });
    sink(line);
  }
  public info(event: string, fields?: OperationalLogFields): void { this.emit("info", event, fields); }
  public warn(event: string, fields?: OperationalLogFields): void { this.emit("warn", event, fields); }
  public error(event: string, fields?: OperationalLogFields): void { this.emit("error", event, fields); }
}

export const operationalLogger = new OperationalLogger();
export function setOperationalLogSinkForTests(next: (line: string) => void): () => void { const previous = sink; sink = next; return () => { sink = previous; }; }
