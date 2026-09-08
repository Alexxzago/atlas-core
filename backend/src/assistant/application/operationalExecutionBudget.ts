import type { WorkspaceContext } from "../../types/workspaceContext.js";
import { abuseScope } from "../../abuse/sharedRateLimitRepository.js";
import { assistantActorLimit, assistantCompanyLimit, RateLimitService } from "../../abuse/rateLimitService.js";

export interface OperationalExecutionLease {
  release(): void;
}

export interface OperationalExecutionBudgetPort { acquire(context: WorkspaceContext, companyId?: number, actorId?: string): OperationalExecutionLease | null; }

interface WorkspaceBudget {
  readonly acceptedAt: number[];
  inFlight: boolean;
}

export class InMemoryOperationalExecutionBudget implements OperationalExecutionBudgetPort {
  private readonly budgets = new Map<number, WorkspaceBudget>();

  public acquire(context: WorkspaceContext, _companyId?: number, _actorId?: string): OperationalExecutionLease | null {
    const now = Date.now();
    const current = this.budgets.get(context.workspaceId) ?? { acceptedAt: [], inFlight: false };
    const acceptedAt = current.acceptedAt.filter((at) => now - at < 60_000);
    if (current.inFlight || acceptedAt.length >= 10) return null;
    const budget: WorkspaceBudget = { acceptedAt: [...acceptedAt, now], inFlight: true };
    this.budgets.set(context.workspaceId, budget);
    let released = false;
    return {
      release: (): void => {
        if (released) return;
        released = true;
        budget.inFlight = false;
      },
    };
  }
}

export class SharedOperationalExecutionBudget implements OperationalExecutionBudgetPort {
  public constructor(private readonly limits: RateLimitService) {}
  public acquire(context: WorkspaceContext, companyId = 0, actorId = "unknown"): OperationalExecutionLease | null {
    this.limits.enforce(abuseScope("workspace", context.workspaceId, "company", companyId, "actor", actorId), "actor", assistantActorLimit);
    this.limits.enforce(abuseScope("workspace", context.workspaceId, "company", companyId), "company", assistantCompanyLimit);
    return { release: (): void => undefined };
  }
}
