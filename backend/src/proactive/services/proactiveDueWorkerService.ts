import type { ProactiveActionLease } from "../domain/proactiveAction.js";
import type { ProactiveActionRepositoryPort } from "../application/ports.js";
import type { ProactiveRuntimeService } from "./proactiveRuntimeService.js";

const leaseMilliseconds = 60_000;

/** PASS3 only prepares durable work; PASS4 owns runtime execution of validated leases. */
export class ProactiveDueWorkerService {
  public constructor(private readonly actions: ProactiveActionRepositoryPort, private readonly clock: { now(): string }, private readonly runtime?: ProactiveRuntimeService) {}

  public recoverAvailable(limit = 25): void {
    this.actions.promoteDue(this.clock.now(), limit);
  }

  public claimDue(owner: string, limit = 25): readonly ProactiveActionLease[] {
    const now = this.clock.now(), expiresAt = new Date(Date.parse(now) + leaseMilliseconds).toISOString();
    this.actions.promoteDue(now, limit);
    return Object.freeze(this.actions.claimDue(owner, now, expiresAt, limit).filter((lease) => this.actions.validateClaim(lease, now) === "valid"));
  }

  public async executeAvailable(owner: string, limit = 25): Promise<void> {
    if (!this.runtime) return;
    this.actions.materializeCompleted(this.clock.now(), limit);
    for (const lease of this.claimDue(owner, limit)) await this.runtime.execute(lease);
    this.actions.materializeCompleted(this.clock.now(), limit);
  }
}
