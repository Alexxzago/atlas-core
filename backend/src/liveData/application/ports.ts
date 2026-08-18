import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { IntegrationReadinessPort } from "../../integrations/application/ports.js";
import type { LiveDataFreshness, LiveDataObservation, LiveDataObservationId, LiveDataOutcome } from "../domain/liveData.js";

export type LiveDataProviderOutcome =
  | { readonly status: "confirmed"; readonly summary: string; readonly source: string; readonly expiresAt: string }
  | { readonly status: "empty"; readonly expiresAt: string }
  | { readonly status: "not_found"; readonly expiresAt: string }
  | { readonly status: "unavailable"; readonly expiresAt?: string };

export type LiveDataReadOutcome =
  | { readonly status: "confirmed"; readonly summary: string; readonly source: string; readonly observedAt: string; readonly fetchedAt: string; readonly expiresAt: string; readonly freshness: "fresh" }
  | { readonly status: Exclude<LiveDataOutcome, "confirmed">; readonly summary: null; readonly source: null; readonly observedAt: string; readonly fetchedAt: string; readonly expiresAt: string; readonly freshness: LiveDataFreshness };

export interface LiveDataProviderPort {
  read(context: WorkspaceContext, companyId: number, input: { readonly kind: string; readonly query: string }, signal: AbortSignal): Promise<LiveDataProviderOutcome>;
}

export type LiveDataIntegrationReadinessPort = IntegrationReadinessPort;

export interface LiveDataObservationRepositoryPort {
  create(context: WorkspaceContext, observation: LiveDataObservation): Promise<LiveDataObservation | null>;
  findLatest(context: WorkspaceContext, companyId: number, resourceType: string): Promise<LiveDataObservation | null>;
  findById(context: WorkspaceContext, companyId: number, id: LiveDataObservationId): Promise<LiveDataObservation | null>;
}
