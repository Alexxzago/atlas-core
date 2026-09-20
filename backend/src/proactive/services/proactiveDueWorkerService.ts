import type { ProactiveActionLease } from "../domain/proactiveAction.js";
import type { ProactiveActionRepositoryPort } from "../application/ports.js";
import type { ProactiveRuntimeService } from "./proactiveRuntimeService.js";

const leaseMilliseconds = 60_000;

/** PASS3 only prepares durable work; PASS4 owns runtime execution of validated leases. */
export class ProactiveDueWorkerService {
  public constructor(private readonly actions: ProactiveActionRepositoryPort, private readonly clock: { now(): string }, private readonly runtime?: ProactiveRuntimeService) {}

  public async recoverAvailable(limit = 25): Promise<void> {
    await this.actions.promoteDue(this.clock.now(), limit);
  }

  public async claimDue(owner: string, limit = 25): Promise<readonly ProactiveActionLease[]> {
    const now = this.clock.now(), expiresAt = new Date(Date.parse(now) + leaseMilliseconds).toISOString();
    await this.actions.promoteDue(now, limit);
    const leases = await this.actions.claimDue(owner, now, expiresAt, limit);
    return Object.freeze((await Promise.all(leases.map(async lease => (await this.actions.validateClaim(lease, now)) === "valid" ? lease : null))).filter((lease): lease is ProactiveActionLease => lease !== null));
  }

  public async executeAvailable(owner: string, limit = 25): Promise<void> {
    if (!this.runtime) return;
    await this.actions.materializeCompleted(this.clock.now(), limit);
    for (const lease of await this.claimDue(owner, limit)) await this.runtime.execute(lease);
    await this.actions.materializeCompleted(this.clock.now(), limit);
  }
}
