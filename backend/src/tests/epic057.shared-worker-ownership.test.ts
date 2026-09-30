import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runMigrations } from "../config/migrations.js";
import { createLibsqlDatabase, type SqlDatabase } from "../config/sqlDatabase.js";
import { SharedWorkerOwnershipRepository } from "../repositories/sharedWorkerOwnershipRepository.js";
import { GoogleCalendarOutboxRuntime } from "../scheduling/services/googleCalendarOutboxRuntime.js";

const flush = async (): Promise<void> => { await new Promise<void>(resolve => setImmediate(resolve)); await new Promise<void>(resolve => setImmediate(resolve)); };
const configuration = { enabled: true, requested: true, ownershipApproved: true, sharedLeaderAvailable: true, intervalMilliseconds: 1_000, scopeLimit: 1, concurrency: 1 } as const;

test("EPIC057 shared ownership serializes independent libsql runtimes, fences takeover, and stops on ownership outage", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-shared-worker-")), path = join(directory, "atlas.sqlite");
  let sync = new DatabaseSync(path), first: SqlDatabase | null = null, second: SqlDatabase | null = null;
  try {
    sync.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;"); runMigrations(sync); sync.close();
    first = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token"); second = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token");
    const a = new SharedWorkerOwnershipRepository(first), b = new SharedWorkerOwnershipRepository(second), now = "2026-09-29T12:00:00.000Z", later = "2026-09-29T12:00:30.000Z", expired = "2026-09-29T12:02:00.000Z";
    const claims = await Promise.all([a.acquire("google_calendar_outbox", "runtime-a", now, "2026-09-29T12:01:00.000Z"), b.acquire("google_calendar_outbox", "runtime-b", now, "2026-09-29T12:01:00.000Z")]);
    const winner = claims.find((value): value is NonNullable<typeof value> => value !== null), loser = claims.find(value => value === null);
    assert.ok(winner); assert.equal(loser, null); assert.equal(winner.fenceGeneration, 1);
    const owner = winner.owner === "runtime-a" ? a : b, contender = winner.owner === "runtime-a" ? b : a;
    const renewed = await owner.renew(winner, later, "2026-09-29T12:01:30.000Z"); assert.ok(renewed); assert.equal(await contender.acquire("google_calendar_outbox", "runtime-c", later, "2026-09-29T12:01:30.000Z"), null);
    await owner.release(renewed); const released = await contender.acquire("google_calendar_outbox", "runtime-c", later, "2026-09-29T12:01:30.000Z"); assert.equal(released?.fenceGeneration, 2);
    const takeover = await a.acquire("google_calendar_outbox", "runtime-d", expired, "2026-09-29T12:03:00.000Z"); assert.equal(takeover?.fenceGeneration, 3); assert.equal(await contender.renew(released!, expired, "2026-09-29T12:03:00.000Z"), null); await a.release(takeover!);

    let pending = true, providerWrites = 0; const timers: Array<{ callback: () => void; cleared: boolean; unref(): void }> = [];
    const scopes = { async listPendingScopes() { return pending ? [{ workspaceId: 1, workspaceKey: "one", companyId: 1 }] : []; } }, worker = { async runOnce() { providerWrites += 1; pending = false; } };
    const runtimeA = new GoogleCalendarOutboxRuntime(worker, scopes, a, configuration, { schedule: callback => { const timer = { callback, cleared: false, unref() {} }; timers.push(timer); return timer; }, clear: timer => { timer.cleared = true; }, now: () => expired });
    const runtimeB = new GoogleCalendarOutboxRuntime(worker, scopes, b, configuration, { schedule: callback => { const timer = { callback, cleared: false, unref() {} }; timers.push(timer); return timer; }, clear: timer => { timer.cleared = true; }, now: () => expired });
    runtimeA.start(); runtimeB.start(); await flush(); assert.equal(providerWrites, 1); await runtimeA.stop(); const retry = timers.find(timer => !timer.cleared); retry?.callback(); await flush(); assert.equal(providerWrites, 1); await runtimeB.stop();

    const outage = new GoogleCalendarOutboxRuntime(worker, scopes, { async acquire() { throw new Error("database unavailable"); }, async renew() { return null; }, async release() {} }, configuration, { schedule: callback => ({ callback, cleared: false, unref() {} }), clear() {}, now: () => expired });
    outage.start(); await flush(); assert.equal(outage.diagnostics().state, "stopped"); assert.equal(providerWrites, 1);
  } finally { if (sync.isOpen) sync.close(); if (first) await first.close(); if (second) await second.close(); try { rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {} }
});

test("EPIC057 provider-stage fencing rejects stale settlements after shared takeover", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-provider-fence-")), path = join(directory, "atlas.sqlite");
  let sync = new DatabaseSync(path), first: SqlDatabase | null = null, second: SqlDatabase | null = null;
  try {
    sync.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;"); runMigrations(sync); sync.close();
    first = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token"); second = createLibsqlDatabase(pathToFileURL(path).href, "local-test-token");
    for (const stage of ["create", "reschedule", "cancel", "restore"] as const) {
      let now = "2026-09-29T12:00:00.000Z", release!: () => void, reached!: () => void, firstCall = true, staleSettles = 0, successorSettles = 0;
      const paused = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { reached = resolve; });
      const calls: Array<{ readonly stage: string; readonly owner: string }> = [];
      const worker = { async runOnce(_context: unknown, _companyId: number, owner: string, _lease?: number, fence?: () => Promise<void>) { await fence!(); calls.push({ stage, owner }); if (firstCall) { firstCall = false; reached(); await paused; await fence!(); staleSettles += 1; } else successorSettles += 1; } };
      const scopes = { async listPendingScopes() { return [{ workspaceId: 1, workspaceKey: "one", companyId: 1 }]; } };
      const timers: Array<{ callback: () => void; cleared: boolean; unref(): void }> = [];
      const runtime = (database: SqlDatabase) => new GoogleCalendarOutboxRuntime(worker, scopes, new SharedWorkerOwnershipRepository(database), configuration, { schedule: callback => { const timer = { callback, cleared: false, unref() {} }; timers.push(timer); return timer; }, clear: timer => { timer.cleared = true; }, now: () => now });
      const stale = runtime(first), successor = runtime(second);
      stale.start(); await entered;
      now = "2026-09-29T12:01:01.000Z"; successor.start(); await flush();
      assert.equal(successorSettles, 1, `${stage} successor must settle after takeover`);
      release(); await flush();
      assert.equal(staleSettles, 0, `${stage} stale runtime must not settle after takeover`);
      assert.equal(calls.filter(call => call.owner.startsWith("google-calendar-outbox")).length, 2);
      assert.equal(stale.diagnostics().state, "stopped");
      await successor.stop(); await stale.stop();
    }
  } finally { if (sync.isOpen) sync.close(); if (first) await first.close(); if (second) await second.close(); try { rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {} }
});
