import { randomUUID } from "node:crypto";
import { createRunId, operationalLogger, withRunContext } from "../../observability/operationalLogger.js";

const defaultIntervalMilliseconds = 5_000;
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
  private readonly ownerPrefix = `billing-reconciliation-runtime-${randomUUID()}`;
  private readonly schedule: (callback: () => void, milliseconds: number) => Timer;
  private readonly clear: (timer: Timer) => void;
  private readonly reportError: (message: string) => void;

  public constructor(private readonly worker: ReconciliationWorker, private readonly configuration: BillingReconciliationRuntimeConfiguration, dependencies: BillingReconciliationRuntimeDependencies = {}, private readonly operationRecovery:OperationRecoveryWorker|null=null) {
    this.schedule = dependencies.schedule ?? ((callback, milliseconds) => setInterval(callback, milliseconds));
    this.clear = dependencies.clear ?? ((timer) => clearInterval(timer as ReturnType<typeof setInterval>));
    this.reportError = dependencies.reportError ?? (() => operationalLogger.error("worker_cycle_failed", { worker: "billing_reconciliation", safeErrorCategory: "internal_failure" }));
  }

  public start(): void {
    if (this.started) return;
    this.started = true;
    this.timer = this.schedule(() => { this.run(); }, this.configuration.intervalMilliseconds);
    this.timer.unref();
    this.run();
  }

  public async stop(): Promise<void> {
    if (!this.started && !this.running) return;
    this.started = false;
    if (this.timer) { this.clear(this.timer); this.timer = null; }
    await this.running;
  }

  private run(): void {
    if (!this.started || this.running) return;
    const runId = createRunId(), started = performance.now(); operationalLogger.info("worker_cycle_started", { runId, worker: "billing_reconciliation" });
    const cycle = withRunContext(runId, () => (this.operationRecovery ? this.operationRecovery.runBatch(this.configuration.batchSize, `${this.ownerPrefix}-operations`).then(()=>this.worker.runBatch(this.configuration.batchSize, this.ownerPrefix)) : this.worker.runBatch(this.configuration.batchSize, this.ownerPrefix)))
      .then((results) => { operationalLogger.info("worker_cycle_completed", { runId, worker: "billing_reconciliation", durationMs: Math.round(performance.now() - started), outcome: "completed", attempt: results.length }); })
      .then(() => undefined)
      .catch(() => { this.reportError("Billing reconciliation cycle failed."); })
      .finally(() => { if (this.running === cycle) this.running = null; });
    this.running = cycle;
  }
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  return parsed;
}
