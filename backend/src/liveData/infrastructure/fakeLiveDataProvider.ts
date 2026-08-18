import type { LiveDataProviderPort } from "../application/ports.js";
import type { LiveDataProviderOutcome } from "../application/ports.js";

/** Local deterministic adapter. It deliberately has no network or credential behavior. */
export class FakeLiveDataProvider implements LiveDataProviderPort {
  private readonly values = new Map<string, LiveDataProviderOutcome>();
  public setResult(kind: string, query: string, value: LiveDataProviderOutcome): void { this.values.set(this.key(kind, query), Object.freeze({ ...value })); }
  public async read(_context: { readonly workspaceId: number }, _companyId: number, input: { readonly kind: string; readonly query: string }, _signal: AbortSignal): Promise<LiveDataProviderOutcome> {
    const value = this.values.get(this.key(input.kind, input.query));
    if (!value) return Object.freeze({ status: "not_found", expiresAt: new Date(0).toISOString() });
    return value;
  }
  private key(kind: string, query: string): string { return `${kind}\n${query.trim()}`; }
}
