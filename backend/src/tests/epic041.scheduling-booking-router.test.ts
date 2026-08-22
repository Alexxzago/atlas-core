import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { ExternalBookingEventRepositoryPort } from "../scheduling/application/externalCalendarPorts.js";
import type { BookingRepositoryPort } from "../scheduling/application/bookingPorts.js";
import type { SchedulingRepositoryPort } from "../scheduling/application/ports.js";
import type { SchedulingBooking } from "../scheduling/domain/scheduling.js";
import { SchedulingBookingRouter, type ExternalBookingCancelPort, type ExternalBookingCreatePort, type ExternalBookingReschedulePort, type LocalBookingCommandPort } from "../scheduling/services/schedulingBookingRouter.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

const context = { workspaceId: 1, workspaceKey: "epic041" } as WorkspaceContext;
const serviceId = "ssv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const resourceId = "src_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const booking = Object.freeze({ id: "sbk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", workspaceId: 1, companyId: 1, serviceId, holdId: null, rescheduledFromBookingId: null, reference: "REFERENCE", startAt: "2026-08-21T01:00:00.000Z", endAt: "2026-08-21T01:30:00.000Z", occupiedStartAt: "2026-08-21T01:00:00.000Z", occupiedEndAt: "2026-08-21T01:30:00.000Z", state: "confirmed", createdAt: "2026-08-21T00:00:00.000Z", cancelledAt: null }) as SchedulingBooking;

function router(options: { readonly binding: "none" | "ready" | "unready"; readonly mapped?: boolean; readonly external?: "success" | "pending" } = { binding: "none" }) {
  const calls = { localCreate: 0, localReschedule: 0, localCancel: 0, externalCreate: 0, externalReschedule: 0, externalCancel: 0, createInput: null as Record<string, unknown> | null, rescheduleInput: null as Record<string, unknown> | null, cancelInput: null as Record<string, unknown> | null };
  const local: LocalBookingCommandPort = {
    create: async (_context, _company, input) => { calls.localCreate++; calls.createInput = input; return { ...booking, reference: input.reference }; },
    reschedule: async (_context, _company, input) => { calls.localReschedule++; calls.rescheduleInput = input; return { ...booking, reference: input.reference, startAt: input.newStartAt }; },
    cancel: async (_context, _company, input) => { calls.localCancel++; calls.cancelInput = input; return { ...booking, state: "cancelled", cancelledAt: "2026-08-21T00:00:00.000Z" }; },
  };
  const bindings = {
    getBindingByResource: async () => options.binding === "none" ? { kind: "not_found" as const } : { kind: "found" as const, binding: { resourceId } },
    resolveReadyBindingForResource: async () => options.binding === "ready" ? { kind: "ready" as const, binding: { bindingId: "ecb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", resourceId } } : { kind: "unavailable" as const },
  };
  const create: ExternalBookingCreatePort = { create: async (_context, _company, input) => { calls.externalCreate++; calls.createInput = input; return options.external === "pending" ? { kind: "pending_recovery" } : { kind: "created", booking: { ...booking, reference: input.reference } }; } };
  const reschedule: ExternalBookingReschedulePort = { reschedule: async (_context, _company, input) => { calls.externalReschedule++; calls.rescheduleInput = input; return options.external === "pending" ? { kind: "pending_recovery" } : { kind: "rescheduled", booking: { ...booking, reference: input.reference, startAt: input.startAt } }; } };
  const cancel: ExternalBookingCancelPort = { cancel: async (_context, _company, input) => { calls.externalCancel++; calls.cancelInput = input; return options.external === "pending" ? { kind: "pending_recovery" } : { kind: "cancelled", booking: { ...booking, state: "cancelled", cancelledAt: "2026-08-21T00:00:00.000Z" } }; } };
  const bookings = { findBooking: async () => booking } as unknown as BookingRepositoryPort;
  const mappings = { findByBooking: async () => options.mapped ? { bindingId: "ecb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } : null } as unknown as ExternalBookingEventRepositoryPort;
  const scheduling = { findService: async () => ({ id: serviceId, resourceId }), findResource: async () => ({ id: resourceId }) } as unknown as SchedulingRepositoryPort;
  return { router: new SchedulingBookingRouter(local, bindings as never, create, reschedule, cancel, bookings, mappings, scheduling), calls };
}

test("EPIC041 router sends CREATE locally only when no binding exists", async () => {
  const local = router({ binding: "none" });
  const result = await local.router.create(context, 1, { serviceId, startAt: "2026-08-21T01:00:00.000Z", reference: "LOCAL", idempotencyKey: "create-key", workerId: "worker" });
  assert.deepEqual(result, { kind: "success", booking: { ...booking, reference: "LOCAL" } });
  assert.equal(local.calls.localCreate, 1);
  assert.equal(local.calls.externalCreate, 0);
  assert.deepEqual(local.calls.createInput, { serviceId, startAt: "2026-08-21T01:00:00.000Z", reference: "LOCAL", idempotencyKey: "create-key", workerId: "worker" });

  const external = router({ binding: "ready" });
  const externalResult = await external.router.create(context, 1, { serviceId, startAt: "2026-08-21T01:00:00.000Z", reference: "EXTERNAL", idempotencyKey: "external-key", workerId: "worker" });
  assert.deepEqual(externalResult, { kind: "success", booking: { ...booking, reference: "EXTERNAL" } });
  assert.equal(external.calls.localCreate, 0);
  assert.equal(external.calls.externalCreate, 1);
  assert.deepEqual(external.calls.createInput, { resourceId, serviceId, startAt: "2026-08-21T01:00:00.000Z", reference: "EXTERNAL", idempotencyKey: "external-key", workerId: "worker" });
});

test("EPIC041 router fails CREATE closed for an unready binding without local fallback", async () => {
  const value = router({ binding: "unready" });
  assert.deepEqual(await value.router.create(context, 1, { serviceId, startAt: "2026-08-21T01:00:00.000Z", reference: "BLOCKED", idempotencyKey: "blocked-key", workerId: "worker" }), { kind: "unavailable" });
  assert.equal(value.calls.localCreate, 0);
  assert.equal(value.calls.externalCreate, 0);
});

test("EPIC041 router uses booking mappings, not resource bindings, for RESCHEDULE authority", async () => {
  const legacy = router({ binding: "ready", mapped: false });
  const localResult = await legacy.router.reschedule(context, 1, { bookingId: booking.id, startAt: "2026-08-21T02:00:00.000Z", reference: "LEGACY", idempotencyKey: "local-key", workerId: "worker" });
  assert.deepEqual(localResult, { kind: "success", booking: { ...booking, reference: "LEGACY", startAt: "2026-08-21T02:00:00.000Z" } });
  assert.equal(legacy.calls.localReschedule, 1);
  assert.equal(legacy.calls.externalReschedule, 0);

  const external = router({ binding: "ready", mapped: true });
  const externalResult = await external.router.reschedule(context, 1, { bookingId: booking.id, startAt: "2026-08-21T02:00:00.000Z", reference: "REMOTE", idempotencyKey: "remote-key", workerId: "worker" });
  assert.deepEqual(externalResult, { kind: "success", booking: { ...booking, reference: "REMOTE", startAt: "2026-08-21T02:00:00.000Z" } });
  assert.equal(external.calls.localReschedule, 0);
  assert.equal(external.calls.externalReschedule, 1);
  assert.deepEqual(external.calls.rescheduleInput, { bookingId: booking.id, startAt: "2026-08-21T02:00:00.000Z", reference: "REMOTE", idempotencyKey: "remote-key", workerId: "worker" });

  const blocked = router({ binding: "unready", mapped: true });
  assert.deepEqual(await blocked.router.reschedule(context, 1, { bookingId: booking.id, startAt: "2026-08-21T02:00:00.000Z", reference: "BLOCKED", idempotencyKey: "blocked-key", workerId: "worker" }), { kind: "unavailable" });
  assert.equal(blocked.calls.localReschedule, 0);
  assert.equal(blocked.calls.externalReschedule, 0);
});

test("EPIC041 router routes CANCEL by mapping and preserves pending recovery as non-success", async () => {
  const local = router({ binding: "ready", mapped: false });
  assert.equal((await local.router.cancel(context, 1, { bookingId: booking.id, idempotencyKey: "local-key", workerId: "worker" })).kind, "success");
  assert.equal(local.calls.localCancel, 1);
  assert.equal(local.calls.externalCancel, 0);

  const external = router({ binding: "ready", mapped: true });
  const externalResult = await external.router.cancel(context, 1, { bookingId: booking.id, idempotencyKey: "remote-key", workerId: "worker" });
  assert.deepEqual(externalResult, { kind: "success", booking: { ...booking, state: "cancelled", cancelledAt: "2026-08-21T00:00:00.000Z" } });
  assert.equal(external.calls.localCancel, 0);
  assert.equal(external.calls.externalCancel, 1);
  assert.deepEqual(external.calls.cancelInput, { bookingId: booking.id, idempotencyKey: "remote-key", workerId: "worker" });
  assert.doesNotMatch(JSON.stringify(externalResult), /calendar|etag|provider|externalEvent/i);

  const blocked = router({ binding: "unready", mapped: true });
  assert.deepEqual(await blocked.router.cancel(context, 1, { bookingId: booking.id, idempotencyKey: "blocked-key", workerId: "worker" }), { kind: "unavailable" });
  assert.equal(blocked.calls.localCancel, 0);
  assert.equal(blocked.calls.externalCancel, 0);

  const pending = router({ binding: "ready", mapped: true, external: "pending" });
  assert.deepEqual(await pending.router.cancel(context, 1, { bookingId: booking.id, idempotencyKey: "pending-key", workerId: "worker" }), { kind: "pending_recovery" });
});

test("EPIC041 router composes separately from assistant tools and retains confirmation/idempotency contracts", () => {
  const composition = readFileSync(resolve(process.cwd(), "src/composition.ts"), "utf8");
  const tools = readFileSync(resolve(process.cwd(), "src/scheduling/application/bookingToolDefinitions.ts"), "utf8");
  assert.match(composition, /new SchedulingBookingRouter\(bookingCommands, externalCalendarBindingService, externalBookingCreateService, externalBookingRescheduleService, externalBookingCancelService, bookingRepository, externalCalendarRepository, schedulingRepository\)/);
  assert.doesNotMatch(composition, /schedulingBookingToolDefinitions\([^)]*schedulingBookingRouter/);
  assert.match(tools, /confirmationPolicy: "user"/);
  assert.match(tools, /idempotencyPolicy: "source_owned_required"/);
});
