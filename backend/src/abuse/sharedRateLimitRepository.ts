import { createHash } from "node:crypto";
import type { SynchronousDatabase } from "../config/synchronousDatabase.js";

export interface RateLimitPolicy { readonly action: string; readonly maximum: number; readonly windowMilliseconds: number; }
export interface RateLimitResult { readonly allowed: boolean; readonly retryAfterSeconds: number; }

export class SharedRateLimitRepository {
  public constructor(private readonly database: SynchronousDatabase) {}

  public consume(scope: string, policy: RateLimitPolicy, now: string): RateLimitResult {
    const at = Date.parse(now);
    if (!Number.isFinite(at)) throw new Error("Rate-limit clock is invalid.");
    const start = Math.floor(at / policy.windowMilliseconds) * policy.windowMilliseconds;
    const expires = new Date(start + policy.windowMilliseconds).toISOString();
    const scopeKey = digest(scope), actionKey = digest(policy.action);
    // This bounded delete uses the expiry index and avoids a table scan on every request.
    this.database.prepare("DELETE FROM shared_rate_limit_windows WHERE rowid IN (SELECT rowid FROM shared_rate_limit_windows WHERE expires_at<=? ORDER BY expires_at LIMIT 32)").run(now);
    const changed = this.database.prepare(`INSERT INTO shared_rate_limit_windows(scope_key,action_key,window_start,count,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(scope_key,action_key,window_start) DO UPDATE SET count=count+1 WHERE count<? RETURNING count`).get(scopeKey, actionKey, new Date(start).toISOString(), 1, expires, policy.maximum) as { count: number } | undefined;
    return { allowed: changed !== undefined, retryAfterSeconds: Math.max(1, Math.ceil((start + policy.windowMilliseconds - at) / 1_000)) };
  }
}

export function abuseScope(...parts: Array<string | number>): string { return parts.join(":"); }
export function normalizedIdentityScope(value: string): string { return createHash("sha256").update(value.trim().toLowerCase()).digest("hex"); }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
