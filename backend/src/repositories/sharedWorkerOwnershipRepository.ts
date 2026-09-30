import type { SqlDatabase } from "../config/sqlDatabase.js";

export interface SharedWorkerOwnershipLease { readonly worker: string; readonly owner: string; readonly expiresAt: string; readonly fenceGeneration: number; }

/** Durable, process-independent leadership lease for a single optional worker. */
export class SharedWorkerOwnershipRepository {
  public constructor(private readonly database: SqlDatabase) {}

  public async acquire(worker: string, owner: string, now: string, expiresAt: string): Promise<SharedWorkerOwnershipLease | null> {
    valid(worker, owner, now, expiresAt);
    for (let attempt = 0; ; attempt += 1) try {
      return await this.database.transaction(async database => {
        await database.execute("INSERT INTO shared_worker_ownership(worker_name,owner,expires_at,fence_generation,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(worker_name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at,fence_generation=shared_worker_ownership.fence_generation+1,updated_at=excluded.updated_at WHERE shared_worker_ownership.expires_at<=excluded.updated_at", [worker, owner, expiresAt, now]);
        const row = (await database.query<Row>("SELECT worker_name,owner,expires_at,fence_generation FROM shared_worker_ownership WHERE worker_name=? AND owner=? AND expires_at>?", [worker, owner, now]))[0];
        return row ? lease(row) : null;
      });
    } catch (error: unknown) { if (!busy(error) || attempt === 10) throw error; await new Promise<void>(resolve => setTimeout(resolve, 25)); }
  }

  public async renew(current: SharedWorkerOwnershipLease, now: string, expiresAt: string): Promise<SharedWorkerOwnershipLease | null> {
    valid(current.worker, current.owner, now, expiresAt);
    const changed = await this.database.execute("UPDATE shared_worker_ownership SET expires_at=?,updated_at=? WHERE worker_name=? AND owner=? AND fence_generation=? AND expires_at>?", [expiresAt, now, current.worker, current.owner, current.fenceGeneration, now]);
    return Number(changed.rowsAffected) === 1 ? Object.freeze({ ...current, expiresAt }) : null;
  }

  public async release(current: SharedWorkerOwnershipLease): Promise<void> {
    await this.database.execute("UPDATE shared_worker_ownership SET expires_at='1970-01-01T00:00:00.000Z',updated_at='1970-01-01T00:00:00.000Z' WHERE worker_name=? AND owner=? AND fence_generation=?", [current.worker, current.owner, current.fenceGeneration]);
  }
}

interface Row extends Record<string, unknown> { readonly worker_name: string; readonly owner: string; readonly expires_at: string; readonly fence_generation: number; }
function lease(row: Row): SharedWorkerOwnershipLease { return Object.freeze({ worker: row.worker_name, owner: row.owner, expiresAt: row.expires_at, fenceGeneration: Number(row.fence_generation) }); }
function valid(worker: string, owner: string, now: string, expiresAt: string): void { if (!/^[a-z][a-z0-9_]{1,99}$/.test(worker) || !/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !Number.isFinite(Date.parse(now)) || Date.parse(expiresAt) <= Date.parse(now)) throw new Error("Shared worker ownership input is invalid."); }
function busy(error: unknown): boolean { return error instanceof Error && /database is locked|SQLITE_BUSY/i.test(error.message); }
