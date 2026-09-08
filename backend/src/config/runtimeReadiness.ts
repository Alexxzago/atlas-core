export type RuntimeReadinessStatus = "booting" | "ready" | "shutting_down";

const requiredWorkers = Object.freeze(["billing_reconciliation", "whatsapp_recovery"] as const);
let status: RuntimeReadinessStatus = "booting";
const workers = new Set<string>();

export function registerRuntimeWorker(name: string): void { workers.add(name); }
export function markRuntimeReady(): void { status = "ready"; }
export function markRuntimeBooting(): void { status = "booting"; }
export function markRuntimeShuttingDown(): void { status = "shutting_down"; }
export function runtimeReadinessStatus(): RuntimeReadinessStatus { return status; }
export function runtimeWorkersRegistered(): readonly string[] { return Object.freeze([...workers].sort()); }
export function runtimeMissingRequiredWorkers(): readonly string[] { return Object.freeze(requiredWorkers.filter((worker) => !workers.has(worker))); }
export function resetRuntimeReadinessForTests(): void { status = "booting"; workers.clear(); }
