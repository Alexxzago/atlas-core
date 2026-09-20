import { createHash } from "node:crypto";
import type { SqlDatabase } from "../config/sqlDatabase.js";

export interface RateLimitPolicy { readonly action: string; readonly maximum: number; readonly windowMilliseconds: number; }
export interface RateLimitResult { readonly allowed: boolean; readonly retryAfterSeconds: number; }

export class SharedRateLimitRepository {
  public constructor(private readonly database: SqlDatabase) {}

  public async consume(scope: string, policy: RateLimitPolicy, now: string): Promise<RateLimitResult> {
    const at = Date.parse(now);
    if (!Number.isFinite(at)) throw new Error("Rate-limit clock is invalid.");
    const start = Math.floor(at / policy.windowMilliseconds) * policy.windowMilliseconds;
    const expires = new Date(start + policy.windowMilliseconds).toISOString();
    const scopeKey = digest(scope), actionKey = digest(policy.action);
    // This bounded delete uses the expiry index and avoids a table scan on every request.
    await this.database.execute("DELETE FROM shared_rate_limit_windows WHERE rowid IN (SELECT rowid FROM shared_rate_limit_windows WHERE expires_at<=? ORDER BY expires_at LIMIT 32)", [now]);
    const changed = await this.database.query<{ count: number }>(`INSERT INTO shared_rate_limit_windows(scope_key,action_key,window_start,count,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(scope_key,action_key,window_start) DO UPDATE SET count=count+1 WHERE count<? RETURNING count`, [scopeKey, actionKey, new Date(start).toISOString(), 1, expires, policy.maximum]);
    return { allowed: changed.length !== 0, retryAfterSeconds: Math.max(1, Math.ceil((start + policy.windowMilliseconds - at) / 1_000)) };
  }
}

export function abuseScope(...parts: Array<string | number>): string { return parts.join(":"); }
export function normalizedIdentityScope(value: string): string { return createHash("sha256").update(value.trim().toLowerCase()).digest("hex"); }
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
