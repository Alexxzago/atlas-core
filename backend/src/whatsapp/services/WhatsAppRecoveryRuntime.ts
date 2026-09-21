import { runtimeWorkerCycleFailed, runtimeWorkerCycleStarted, runtimeWorkerCycleSucceeded, runtimeWorkerStarted, runtimeWorkerStopped } from "../../config/runtimeReadiness.js";

type Timer = { unref(): void };
export interface WhatsAppRecoveryRuntimeDependencies { readonly schedule?: (callback: () => void, milliseconds: number) => Timer; readonly clear?: (timer: Timer) => void; readonly reportError?: () => void; }

/** Serializes durable WhatsApp recovery cycles and fences timer work during shutdown. */
export class WhatsAppRecoveryRuntime {
  private timer: Timer | null = null;
  private running: Promise<void> | null = null;
  private started = false;
  private readonly schedule: (callback: () => void, milliseconds: number) => Timer;
  private readonly clear: (timer: Timer) => void;
  private readonly reportError: () => void;
  public constructor(private readonly recover: () => Promise<void>, dependencies: WhatsAppRecoveryRuntimeDependencies = {}, private readonly intervalMilliseconds = 5_000) { this.schedule = dependencies.schedule ?? ((callback, milliseconds) => setInterval(callback, milliseconds)); this.clear = dependencies.clear ?? ((timer) => clearInterval(timer as ReturnType<typeof setInterval>)); this.reportError = dependencies.reportError ?? (() => undefined); }
  public start(): void { if (this.started) return; this.started = true; runtimeWorkerStarted("whatsapp_recovery"); this.timer = this.schedule(() => { void this.run(); }, this.intervalMilliseconds); this.timer.unref(); void this.run(); }
  public async stop(): Promise<void> { if (!this.started && !this.running) return; this.started = false; if (this.timer) { this.clear(this.timer); this.timer = null; } await this.running; runtimeWorkerStopped("whatsapp_recovery"); }
  private run(): Promise<void> { if (!this.started || this.running) return this.running ?? Promise.resolve(); runtimeWorkerCycleStarted("whatsapp_recovery"); const cycle = this.recover().then(() => { runtimeWorkerCycleSucceeded("whatsapp_recovery"); }).catch(() => { runtimeWorkerCycleFailed("whatsapp_recovery"); this.reportError(); }).finally(() => { if (this.running === cycle) this.running = null; }); this.running = cycle; return cycle; }
}
