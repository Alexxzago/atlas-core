export type LiveDataResourceType = "observation";
export type LiveDataOutcome = "confirmed" | "empty" | "not_found" | "unavailable";
export type LiveDataFreshness = "fresh" | "stale" | "expired";
export type LiveDataObservationId = string & { readonly __liveDataObservationId: unique symbol };

export interface LiveDataObservation {
  readonly id: LiveDataObservationId;
  readonly toolTraceId: string;
  readonly workspaceId: number;
  readonly companyId: number;
  readonly resourceType: LiveDataResourceType;
  readonly provider: string;
  readonly outcome: LiveDataOutcome;
  readonly observedAt: string;
  readonly fetchedAt: string;
  readonly expiresAt: string;
  readonly freshness: LiveDataFreshness;
  readonly safePayloadJson: string;
}

export class LiveDataError extends Error {}

export function liveDataObservationId(value: string): LiveDataObservationId {
  if (!/^ldo_[a-f0-9]{32}$/.test(value)) throw new LiveDataError("Live data observation ID is invalid.");
  return value as LiveDataObservationId;
}

export function reconstructLiveDataObservation(value: LiveDataObservation): LiveDataObservation {
  if (!Number.isSafeInteger(value.workspaceId) || value.workspaceId < 1 || !Number.isSafeInteger(value.companyId) || value.companyId < 1) throw new LiveDataError("Live data scope is invalid.");
  if (!/^ttr_[a-f0-9]{32}$/.test(value.toolTraceId) || value.resourceType !== "observation" || !validText(value.provider, 100) || !["confirmed", "empty", "not_found", "unavailable"].includes(value.outcome) || !["fresh", "stale", "expired"].includes(value.freshness)) throw new LiveDataError("Live data observation is invalid.");
  if (Number.isNaN(Date.parse(value.observedAt)) || Number.isNaN(Date.parse(value.fetchedAt)) || Number.isNaN(Date.parse(value.expiresAt)) || value.fetchedAt < value.observedAt) throw new LiveDataError("Live data timestamps are invalid.");
  if (!safePayload(value.safePayloadJson)) throw new LiveDataError("Live data safe payload is invalid.");
  return Object.freeze({ ...value, id: liveDataObservationId(value.id), provider: value.provider.trim() });
}

function validText(value: string, maximumLength: number): boolean { return value.trim().length > 0 && value.length <= maximumLength; }
function safePayload(value: string): boolean {
  if (value.length > 8_512) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "summary" && key !== "source")) return false;
    return (record.summary === undefined || validTextValue(record.summary, 8_000)) && (record.source === undefined || validTextValue(record.source, 200));
  } catch { return false; }
}
function validTextValue(value: unknown, maximumLength: number): boolean { return typeof value === "string" && validText(value, maximumLength); }
