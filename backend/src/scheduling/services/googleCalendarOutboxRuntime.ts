import { randomUUID } from "node:crypto";
import type { CalendarSyncScope } from "../../repositories/calendarSyncRepository.js";
import type { SharedWorkerOwnershipLease } from "../../repositories/sharedWorkerOwnershipRepository.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import { GoogleCalendarProviderFenceLostError } from "./googleCalendarOutboxWorker.js";
import { registerRuntimeWorker, runtimeWorkerCycleFailed, runtimeWorkerCycleStarted, runtimeWorkerCycleSucceeded, runtimeWorkerScheduled, runtimeWorkerStarted, runtimeWorkerStopped } from "../../config/runtimeReadiness.js";
import { createRunId, normalizeOperationalError, operationalLogger, withRunContext } from "../../observability/operationalLogger.js";

const defaultIntervalMilliseconds = 5_000;
const defaultScopeLimit = 20;
const defaultConcurrency = 2;

type Timer = { unref(): void };
type OutboxWorker = Readonly<{ runOnce(context: WorkspaceContext, companyId: number, owner: string, leaseMilliseconds?: number, fence?: () => Promise<void>): Promise<unknown> }>;
type ScopeRepository = Readonly<{ listPendingScopes(limit: number): Promise<readonly CalendarSyncScope[]> }>;
type SharedWorkerOwnership = Readonly<{ acquire(worker: string, owner: string, now: string, expiresAt: string): Promise<SharedWorkerOwnershipLease | null>; renew(current: SharedWorkerOwnershipLease, now: string, expiresAt: string): Promise<SharedWorkerOwnershipLease | null>; release(current: SharedWorkerOwnershipLease): Promise<void> }>;

export interface GoogleCalendarOutboxRuntimeConfiguration { readonly enabled: boolean; readonly requested: boolean; readonly ownershipApproved: boolean; readonly sharedLeaderAvailable: boolean; readonly intervalMilliseconds: number; readonly scopeLimit: number; readonly concurrency: number; }
export interface GoogleCalendarOutboxRuntimeDependencies { readonly schedule?: (callback: () => void, milliseconds: number) => Timer; readonly clear?: (timer: Timer) => void; readonly reportError?: () => void; readonly now?: () => string; }
export interface GoogleCalendarOutboxRuntimeDiagnostics { readonly state: "blocked" | "stopped" | "running" | "scheduled"; readonly requested: boolean; readonly ownershipApproved: boolean; readonly sharedLeaderAvailable: boolean; readonly cyclesStarted: number; readonly cyclesSucceeded: number; readonly cyclesFailed: number; readonly pendingScopes: number; readonly processedScopes: number; }

/** Parses an opt-in scheduler configuration. Any absent flag leaves provider work disabled. */
export function googleCalendarOutboxRuntimeConfiguration(environment: NodeJS.ProcessEnv = process.env): GoogleCalendarOutboxRuntimeConfiguration {
  const requested = boolean(environment.GOOGLE_CALENDAR_OUTBOX_WORKER_ENABLED, "GOOGLE_CALENDAR_OUTBOX_WORKER_ENABLED"), ownershipApproved = boolean(environment.GOOGLE_CALENDAR_OUTBOX_WORKER_OWNERSHIP_APPROVED, "GOOGLE_CALENDAR_OUTBOX_WORKER_OWNERSHIP_APPROVED");
  const enabled = requested && ownershipApproved;
  return Object.freeze({ enabled, requested, ownershipApproved, sharedLeaderAvailable: enabled, intervalMilliseconds: bounded(environment.GOOGLE_CALENDAR_OUTBOX_WORKER_INTERVAL_MS, defaultIntervalMilliseconds, 1_000, 60_000, "GOOGLE_CALENDAR_OUTBOX_WORKER_INTERVAL_MS"), scopeLimit: bounded(environment.GOOGLE_CALENDAR_OUTBOX_WORKER_SCOPE_LIMIT, defaultScopeLimit, 1, 100, "GOOGLE_CALENDAR_OUTBOX_WORKER_SCOPE_LIMIT"), concurrency: bounded(environment.GOOGLE_CALENDAR_OUTBOX_WORKER_CONCURRENCY, defaultConcurrency, 1, 10, "GOOGLE_CALENDAR_OUTBOX_WORKER_CONCURRENCY") });
}

/** Runs durable calendar projection work only when explicitly enabled by production composition. */
export class GoogleCalendarOutboxRuntime {
  private timer: Timer | null = null;
  private running: Promise<void> | null = null;
  private started = false;
  private generation = 0;
  private cyclesStarted = 0;
  private cyclesSucceeded = 0;
  private cyclesFailed = 0;
  private pendingScopes = 0;
  private processedScopes = 0;
  private readonly ownerPrefix = `google-calendar-outbox-${randomUUID()}`;
  private lease: SharedWorkerOwnershipLease | null = null;
  private readonly schedule: (callback: () => void, milliseconds: number) => Timer;
  private readonly clear: (timer: Timer) => void;
  private readonly reportError: () => void;
  private readonly now: () => string;

  public constructor(private readonly worker: OutboxWorker, private readonly scopes: ScopeRepository, private readonly ownership: SharedWorkerOwnership, private readonly configuration: GoogleCalendarOutboxRuntimeConfiguration, dependencies: GoogleCalendarOutboxRuntimeDependencies = {}) { this.schedule = dependencies.schedule ?? ((callback, milliseconds) => setTimeout(callback, milliseconds)); this.clear = dependencies.clear ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>)); this.reportError = dependencies.reportError ?? (() => undefined); this.now = dependencies.now ?? (() => new Date().toISOString()); }
  public diagnostics(): GoogleCalendarOutboxRuntimeDiagnostics { return Object.freeze({ state: !this.configuration.enabled ? "blocked" : this.running ? "running" : this.timer ? "scheduled" : "stopped", requested: this.configuration.requested, ownershipApproved: this.configuration.ownershipApproved, sharedLeaderAvailable: this.configuration.sharedLeaderAvailable, cyclesStarted: this.cyclesStarted, cyclesSucceeded: this.cyclesSucceeded, cyclesFailed: this.cyclesFailed, pendingScopes: this.pendingScopes, processedScopes: this.processedScopes }); }
  public start(): void { registerRuntimeWorker("google_calendar_outbox", { configured: this.configuration.requested, required: false, staleAfterMilliseconds: 120_000 }); if (!this.configuration.enabled || this.started) { if (!this.configuration.enabled) operationalLogger.warn("google_calendar_outbox_blocked", { worker: "google_calendar_outbox", subsystem: "google_calendar", outcome: this.configuration.requested && this.configuration.ownershipApproved ? "shared_leader_unavailable" : "disabled" }); return; } this.started = true; this.generation += 1; runtimeWorkerStarted("google_calendar_outbox"); operationalLogger.info("google_calendar_outbox_started", { worker: "google_calendar_outbox", subsystem: "google_calendar", outcome: "started" }); this.run(); }
  public async stop(): Promise<void> { if (!this.started && !this.running) return; this.started = false; this.generation += 1; if (this.timer) { this.clear(this.timer); this.timer = null; } await this.running; await this.release(); runtimeWorkerStopped("google_calendar_outbox"); }
  private run(): void { if (!this.started || this.running) return; this.cyclesStarted += 1; runtimeWorkerCycleStarted("google_calendar_outbox"); const runId = createRunId(), startedAt = performance.now(); let schedule = true; const cycle = withRunContext(runId, () => this.execute()).then(({ pendingScopes, processedScopes }) => { this.pendingScopes = pendingScopes; this.cyclesSucceeded += 1; runtimeWorkerCycleSucceeded("google_calendar_outbox"); operationalLogger.info("google_calendar_outbox_cycle_completed", { worker: "google_calendar_outbox", subsystem: "google_calendar", outcome: "completed", attempt: processedScopes, durationMs: Math.round(performance.now() - startedAt), runId }); }).catch((error: unknown) => { this.cyclesFailed += 1; const category = normalizeOperationalError(error); runtimeWorkerCycleFailed("google_calendar_outbox", category === "database_failure" ? "database_failure" : "provider_failure"); this.reportError(); if (category === "database_failure" || error instanceof OwnershipLostError || error instanceof GoogleCalendarProviderFenceLostError) { schedule = false; this.started = false; operationalLogger.error("google_calendar_outbox_ownership_lost", { worker: "google_calendar_outbox", subsystem: "google_calendar", safeErrorCategory: category, outcome: "stopped", durationMs: Math.round(performance.now() - startedAt), runId }); return; } operationalLogger.error("google_calendar_outbox_cycle_failed", { worker: "google_calendar_outbox", subsystem: "google_calendar", safeErrorCategory: category, outcome: "failed", durationMs: Math.round(performance.now() - startedAt), runId }); }).finally(() => { if (this.running === cycle) this.running = null; if (schedule) this.scheduleNext(); }); this.running = cycle; }
  private async execute(): Promise<{ readonly pendingScopes: number; readonly processedScopes: number }> { const held = this.lease !== null; if (!await this.holdLeadership()) { if (held) throw new OwnershipLostError(); return { pendingScopes: 0, processedScopes: 0 }; } const scopes = await this.scopes.listPendingScopes(this.configuration.scopeLimit); this.pendingScopes = scopes.length; let next = 0; const consume = async (): Promise<number> => { let processed = 0; for (;;) { const scope = scopes[next++]; if (!scope) return processed; if (!await this.holdLeadership()) throw new OwnershipLostError(); await this.worker.runOnce({ workspaceId: scope.workspaceId, workspaceKey: scope.workspaceKey }, scope.companyId, `${this.ownerPrefix}-${scope.workspaceId}-${scope.companyId}`, undefined, async () => { if (!await this.holdLeadership()) throw new GoogleCalendarProviderFenceLostError(); }); processed += 1; this.processedScopes += 1; } }; const processed = await Promise.all(Array.from({ length: Math.min(this.configuration.concurrency, scopes.length) }, consume)); return { pendingScopes: scopes.length, processedScopes: processed.reduce((total, count) => total + count, 0) }; }
  private scheduleNext(): void { if (!this.started) return; const generation = this.generation; runtimeWorkerScheduled("google_calendar_outbox", Date.now() + this.configuration.intervalMilliseconds); this.timer = this.schedule(() => { if (this.started && this.generation === generation) this.run(); }, this.configuration.intervalMilliseconds); this.timer.unref(); }
  private async holdLeadership(): Promise<boolean> { try { const now = this.now(), expiresAt = new Date(Date.parse(now) + 60_000).toISOString(); if (this.lease) { const renewed = await this.ownership.renew(this.lease, now, expiresAt); if (!renewed) { this.lease = null; return false; } this.lease = renewed; return true; } const acquired = await this.ownership.acquire("google_calendar_outbox", this.ownerPrefix, now, expiresAt); if (!acquired) return false; this.lease = acquired; return true; } catch { throw new OwnershipLostError(); } }
  private async release(): Promise<void> { const current = this.lease; this.lease = null; if (current) await this.ownership.release(current); }
}

class OwnershipLostError extends Error {}

function boolean(value: string | undefined, name: string): boolean { if (value === undefined || value.trim() === "" || value === "false") return false; if (value === "true") return true; throw new Error(`${name} must be true or false.`); }
function bounded(value: string | undefined, fallback: number, minimum: number, maximum: number, name: string): number { if (value === undefined || value.trim() === "") return fallback; const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`); return parsed; }
