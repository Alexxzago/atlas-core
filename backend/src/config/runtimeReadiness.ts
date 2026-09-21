export type RuntimeReadinessStatus = "booting" | "ready" | "shutting_down";
export type RuntimeWorkerName = "billing_reconciliation" | "whatsapp_recovery";

export interface RuntimeWorkerOptions { readonly configured?: boolean; readonly required?: boolean; readonly staleAfterMilliseconds?: number; }
export interface RuntimeWorkerHealth {
  readonly registered: boolean; readonly configured: boolean; readonly required: boolean; readonly started: boolean; readonly running: boolean;
  readonly lastSuccessfulCycleAt: number | null; readonly lastFailedCycleAt: number | null;
  readonly lastError: "internal_failure" | "provider_failure" | "database_failure" | null;
  readonly consecutiveFailures: number; readonly lastActivityAt: number | null;
  readonly backlogUnsafe: boolean; readonly staleLease: boolean; readonly staleAfterMilliseconds: number;
}

const defaultStaleAfterMilliseconds = 15_000;
let status: RuntimeReadinessStatus = "booting";
const workers = new Map<string, RuntimeWorkerHealth>();

function current(name: string): RuntimeWorkerHealth {
  const worker = workers.get(name);
  if (!worker) throw new Error(`Runtime worker ${name} is not registered.`);
  return worker;
}
function update(name: string, changes: Partial<RuntimeWorkerHealth>): void { workers.set(name, Object.freeze({ ...current(name), ...changes })); }
function now(): number { return Date.now(); }

export function registerRuntimeWorker(name: RuntimeWorkerName | string, options: RuntimeWorkerOptions = {}): void {
  const existing = workers.get(name);
  const required = options.required ?? existing?.required ?? (name === "billing_reconciliation" || name === "whatsapp_recovery");
  const staleAfterMilliseconds = options.staleAfterMilliseconds ?? existing?.staleAfterMilliseconds ?? defaultStaleAfterMilliseconds;
  if (!Number.isSafeInteger(staleAfterMilliseconds) || staleAfterMilliseconds < 1) throw new Error("Runtime worker stale timeout must be a positive integer.");
  workers.set(name, Object.freeze({ registered: true, configured: options.configured ?? existing?.configured ?? required, required, started: existing?.started ?? false, running: false, lastSuccessfulCycleAt: existing?.lastSuccessfulCycleAt ?? null, lastFailedCycleAt: existing?.lastFailedCycleAt ?? null, lastError: existing?.lastError ?? null, consecutiveFailures: existing?.consecutiveFailures ?? 0, lastActivityAt: existing?.lastActivityAt ?? null, backlogUnsafe: existing?.backlogUnsafe ?? false, staleLease: existing?.staleLease ?? false, staleAfterMilliseconds }));
}
function ensureWorker(name: string): void { if (!workers.has(name)) registerRuntimeWorker(name, { required: false }); }
export function runtimeWorkerStarted(name: string): void { ensureWorker(name); update(name, { started: true, lastActivityAt: now() }); }
export function runtimeWorkerCycleStarted(name: string): void { ensureWorker(name); update(name, { running: true, lastActivityAt: now() }); }
export function runtimeWorkerCycleSucceeded(name: string, options: { readonly backlogUnsafe?: boolean; readonly staleLease?: boolean } = {}): void { ensureWorker(name); const at = now(); update(name, { running: false, lastSuccessfulCycleAt: at, lastActivityAt: at, lastError: null, consecutiveFailures: 0, backlogUnsafe: options.backlogUnsafe ?? false, staleLease: options.staleLease ?? false }); }
export function runtimeWorkerCycleFailed(name: string, safeError: RuntimeWorkerHealth["lastError"] = "internal_failure"): void { ensureWorker(name); const at = now(), worker = current(name); update(name, { running: false, lastFailedCycleAt: at, lastActivityAt: at, lastError: safeError, consecutiveFailures: worker.consecutiveFailures + 1 }); }
export function runtimeWorkerStopped(name: string): void { if (workers.has(name)) update(name, { running: false, lastActivityAt: now() }); }
export function runtimeWorkerHealth(name: string): RuntimeWorkerHealth | null { return workers.get(name) ?? null; }
export function runtimeWorkerIsHealthy(name: string, at = now()): boolean {
  const worker = workers.get(name);
  if (!worker || !worker.required || !worker.started || worker.lastSuccessfulCycleAt === null || worker.lastError !== null || worker.backlogUnsafe || worker.staleLease) return false;
  return at - worker.lastActivityAt! <= worker.staleAfterMilliseconds;
}
export function runtimeMissingRequiredWorkers(): readonly string[] { return Object.freeze([...workers.entries()].filter(([name, worker]) => worker.required && !runtimeWorkerIsHealthy(name)).map(([name]) => name).sort()); }
export function markRuntimeReady(): void { status = "ready"; }
export function markRuntimeBooting(): void { status = "booting"; }
export function markRuntimeShuttingDown(): void { status = "shutting_down"; }
export function runtimeReadinessStatus(): RuntimeReadinessStatus { return status; }
export function runtimeWorkersRegistered(): readonly string[] { return Object.freeze([...workers.keys()].sort()); }
export function resetRuntimeReadinessForTests(): void { status = "booting"; workers.clear(); }
