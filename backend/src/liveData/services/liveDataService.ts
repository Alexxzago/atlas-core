import { randomUUID } from "node:crypto";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { LiveDataIntegrationReadinessPort, LiveDataObservationRepositoryPort, LiveDataProviderOutcome, LiveDataProviderPort, LiveDataReadOutcome } from "../application/ports.js";
import { reconstructLiveDataObservation, type LiveDataFreshness, type LiveDataObservation } from "../domain/liveData.js";

const MAXIMUM_FRESHNESS_MILLISECONDS = 24 * 60 * 60 * 1000;

export class LiveDataService {
  public constructor(private readonly observations: LiveDataObservationRepositoryPort, private readonly readiness: LiveDataIntegrationReadinessPort, private readonly provider: LiveDataProviderPort, private readonly clock: { now(): string }, private readonly providerTimeoutMilliseconds = 5_000) {}

  public async read(context: WorkspaceContext, companyId: number, input: { readonly kind: "observation"; readonly query: string; readonly toolTraceId?: string }, signal: AbortSignal): Promise<LiveDataReadOutcome> {
    const observedAt = timestamp(this.clock.now()) ?? new Date(0).toISOString();
    const unavailable = (): LiveDataReadOutcome => unavailableOutcome(observedAt, observedAt);
    const query = input.query.trim();
    if (!query || query.length > 500 || !Number.isSafeInteger(companyId) || companyId < 1 || !input.toolTraceId) return unavailable();
    try {
      if (!await this.readiness.isReadyForTool(context, companyId, "live_data", input.kind)) return unavailable();
      const providerResult = await this.readProvider(context, companyId, { kind: input.kind, query }, signal);
      const fetchedAt = timestamp(this.clock.now()) ?? observedAt;
      const normalized = normalize(providerResult, observedAt, fetchedAt);
      const observation = reconstructLiveDataObservation({ id: `ldo_${randomUUID().replaceAll("-", "")}` as LiveDataObservation["id"], toolTraceId: input.toolTraceId, workspaceId: context.workspaceId, companyId, resourceType: input.kind, provider: "live_data", outcome: normalized.providerOutcome, observedAt, fetchedAt, expiresAt: normalized.readOutcome.expiresAt, freshness: normalized.readOutcome.freshness, safePayloadJson: normalized.safePayloadJson });
      return await this.observations.create(context, observation) ? withObservationReference(normalized.readOutcome, observation.id) : unavailableOutcome(observedAt, fetchedAt);
    } catch {
      return unavailable();
    }
  }

  private async readProvider(context: WorkspaceContext, companyId: number, input: { readonly kind: string; readonly query: string }, signal: AbortSignal): Promise<LiveDataProviderOutcome> {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Live data provider timed out.")); }, this.providerTimeoutMilliseconds); });
      return await Promise.race([this.provider.read(context, companyId, input, controller.signal), timeout]);
    } finally {
      if (timer !== null) clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }
}

function normalize(value: LiveDataProviderOutcome, observedAt: string, fetchedAt: string): { readonly readOutcome: LiveDataReadOutcome; readonly providerOutcome: "confirmed" | "empty" | "not_found" | "unavailable"; readonly safePayloadJson: string } {
  const expiry = expiration(value.expiresAt, observedAt, fetchedAt);
  if (!expiry) return Object.freeze({ readOutcome: unavailableOutcome(observedAt, fetchedAt), providerOutcome: "unavailable", safePayloadJson: "{}" });
  if (value.status === "confirmed" && validText(value.summary, 8_000) && validText(value.source, 200)) {
    const safePayloadJson = JSON.stringify({ summary: value.summary.trim(), source: value.source.trim() });
    const readOutcome = expiry.freshness === "fresh"
      ? Object.freeze({ status: "confirmed" as const, summary: value.summary.trim(), source: value.source.trim(), observedAt, fetchedAt, expiresAt: expiry.expiresAt, freshness: "fresh" as const })
      : unavailableOutcome(observedAt, fetchedAt, expiry.expiresAt, expiry.freshness);
    return Object.freeze({ readOutcome, providerOutcome: "confirmed", safePayloadJson });
  }
  if (value.status === "empty" || value.status === "not_found") return Object.freeze({ readOutcome: Object.freeze({ status: value.status, summary: null, source: null, observedAt, fetchedAt, expiresAt: expiry.expiresAt, freshness: expiry.freshness }), providerOutcome: value.status, safePayloadJson: "{}" });
  return Object.freeze({ readOutcome: unavailableOutcome(observedAt, fetchedAt, expiry.expiresAt, expiry.freshness), providerOutcome: "unavailable", safePayloadJson: "{}" });
}

function validText(value: unknown, maximumLength: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength; }
function timestamp(value: string): string | null { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function expiration(value: unknown, observedAt: string, fetchedAt: string): { readonly expiresAt: string; readonly freshness: LiveDataFreshness } | null {
  if (typeof value !== "string") return null;
  const expiresAt = timestamp(value);
  if (!expiresAt) return null;
  const observed = Date.parse(observedAt), fetched = Date.parse(fetchedAt), expires = Date.parse(expiresAt);
  if (expires - observed > MAXIMUM_FRESHNESS_MILLISECONDS || observed - expires > MAXIMUM_FRESHNESS_MILLISECONDS) return null;
  return Object.freeze({ expiresAt, freshness: expires > fetched ? "fresh" : expires === fetched ? "stale" : "expired" });
}
function unavailableOutcome(observedAt: string, fetchedAt: string, expiresAt = fetchedAt, freshness: LiveDataFreshness = "expired"): LiveDataReadOutcome {
  return Object.freeze({ status: "unavailable", summary: null, source: null, observedAt, fetchedAt, expiresAt, freshness });
}
function withObservationReference(outcome: LiveDataReadOutcome, observationId: string): LiveDataReadOutcome {
  const result = { ...outcome };
  Object.defineProperty(result, "observationId", { value: observationId, enumerable: false });
  return Object.freeze(result);
}
export function liveDataObservationReference(value: unknown): string | null {
  const reference = value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "observationId")?.value : null;
  return typeof reference === "string" ? reference : null;
}
