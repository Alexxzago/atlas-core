import { randomUUID } from "node:crypto";
import { createRunId, operationalLogger, withRunContext } from "../../observability/operationalLogger.js";
import { registerRuntimeWorker, runtimeWorkerCycleFailed, runtimeWorkerCycleStarted, runtimeWorkerCycleSucceeded, runtimeWorkerScheduled, runtimeWorkerStarted, runtimeWorkerStopped } from "../../config/runtimeReadiness.js";

const defaultIntervalMilliseconds = 5_000;
const idleDelays = [5_000, 15_000, 30_000, 60_000] as const;
const minimumIntervalMilliseconds = 1_000;
const maximumIntervalMilliseconds = 60_000;
const defaultBatchSize = 25;

export interface BillingReconciliationRuntimeConfiguration {
  readonly intervalMilliseconds: number;
  readonly batchSize: number;
}

export interface BillingReconciliationRuntimeDependencies {
  readonly schedule?: (callback: () => void, milliseconds: number) => { unref(): void };
  readonly clear?: (timer: { unref(): void }) => void;
  readonly reportError?: (message: string) => void;
}

type Timer = { unref(): void };
type ReconciliationWorker = Readonly<{ runBatch(limit?: number, ownerPrefix?: string): Promise<readonly unknown[]> }>;
type OperationRecoveryWorker = Readonly<{ runBatch(limit?: number, ownerPrefix?: string): Promise<readonly unknown[]> }>;

export function billingReconciliationRuntimeConfiguration(environment: NodeJS.ProcessEnv = process.env): BillingReconciliationRuntimeConfiguration {
  return Object.freeze({
    intervalMilliseconds: boundedInteger(environment.BILLING_RECONCILIATION_INTERVAL_MS, defaultIntervalMilliseconds, minimumIntervalMilliseconds, maximumIntervalMilliseconds, "BILLING_RECONCILIATION_INTERVAL_MS"),
    batchSize: boundedInteger(environment.BILLING_RECONCILIATION_BATCH_SIZE, defaultBatchSize, 1, defaultBatchSize, "BILLING_RECONCILIATION_BATCH_SIZE"),
  });
}

/** Wakes durable reconciliation work without making process scheduling authoritative. */
export class BillingReconciliationRuntime {
  private timer: Timer | null = null;
  private running: Promise<void> | null = null;
  private started = false;
  private emptyStreak = 0;
  private generation = 0;
  private readonly ownerPrefix = `billing-reconciliation-runtime-${randomUUID()}`;
  private readonly schedule: (callback: () => void, milliseconds: number) => Timer;
  private readonly clear: (timer: Timer) => void;
  private readonly reportError: (message: string) => void;

  public constructor(private readonly worker: ReconciliationWorker, private readonly configuration: BillingReconciliationRuntimeConfiguration, dependencies: BillingReconciliationRuntimeDependencies = {}, private readonly operationRecovery:OperationRecoveryWorker|null=null) {
    this.schedule = dependencies.schedule ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
    this.clear = dependencies.clear ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.reportError = dependencies.reportError ?? (() => operationalLogger.error("worker_cycle_failed", { worker: "billing_reconciliation", safeErrorCategory: "internal_failure" }));
  }

  public start(): void {
    if (this.started) return;
    this.generation += 1;
    this.started = true;
    registerRuntimeWorker("billing_reconciliation", { configured: true, required: true, staleAfterMilliseconds: 120_000 });
    runtimeWorkerStarted("billing_reconciliation");
    this.run();
  }

  public async stop(): Promise<void> {
    if (!this.started && !this.running) return;
    this.started = false;
    this.generation += 1;
    if (this.timer) { this.clear(this.timer); this.timer = null; }
    await this.running;
    runtimeWorkerStopped("billing_reconciliation");
  }

  private run(): void {
    if (!this.started || this.running) return;
    runtimeWorkerCycleStarted("billing_reconciliation");
    const runId = createRunId(), started = performance.now();
    const cycle = withRunContext(runId, async () => { const operations = this.operationRecovery ? await this.operationRecovery.runBatch(this.configuration.batchSize, `${this.ownerPrefix}-operations`) : []; const reconciliations = await this.worker.runBatch(this.configuration.batchSize, this.ownerPrefix); return operations.length + reconciliations.length; })
      .then((workCount) => { runtimeWorkerCycleSucceeded("billing_reconciliation"); if (workCount > 0) operationalLogger.info("worker_cycle_completed", { runId, worker: "billing_reconciliation", durationMs: Math.round(performance.now() - started), outcome: "completed", attempt: workCount }); this.scheduleNext(this.nextDelay(workCount > 0)); })
      .then(() => undefined)
      .catch(() => { runtimeWorkerCycleFailed("billing_reconciliation"); this.emptyStreak = 0; this.reportError("Billing reconciliation cycle failed."); this.scheduleNext(idleDelays[0]); })
      .finally(() => { if (this.running === cycle) this.running = null; });
    this.running = cycle;
  }
  private nextDelay(didWork: boolean): number { if (didWork) { this.emptyStreak = 0; return idleDelays[0]; } const index = Math.min(this.emptyStreak, idleDelays.length - 1); this.emptyStreak = Math.min(this.emptyStreak + 1, idleDelays.length - 1); return idleDelays[index]!; }
  private scheduleNext(delay: number): void { if (!this.started) return; const generation = this.generation; runtimeWorkerScheduled("billing_reconciliation", Date.now() + delay); this.timer = this.schedule(() => { if (this.started && this.generation === generation) this.run(); }, delay); this.timer.unref(); }
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  return parsed;
}
