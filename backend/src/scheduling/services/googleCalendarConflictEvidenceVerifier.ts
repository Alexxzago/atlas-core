import { createHash } from "node:crypto";
import type { ExternalBusyProviderPort, ExternalCalendarEventProviderPort, ExternalCalendarReconciliationProviderPort } from "../application/externalCalendarPorts.js";
import type { ExternalCalendarBinding } from "../domain/externalCalendar.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export interface VerifiedGoogleCalendarConflictEvidence {
  readonly bindingId: string;
  readonly externalCalendarId: string;
  readonly externalEventId: string;
  readonly remoteVersion: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly timeZone: string;
  readonly observedAt: string;
  readonly fingerprint: string;
}

/** Produces adoption evidence only when three current Google reads agree on Atlas-owned event identity. */
export class GoogleCalendarConflictEvidenceVerifier {
  public constructor(private readonly busy: ExternalBusyProviderPort, private readonly events: ExternalCalendarEventProviderPort, private readonly reconciliation: ExternalCalendarReconciliationProviderPort, private readonly clock: { now(): string }) {}

  public async verify(context: WorkspaceContext, companyId: number, input: { readonly connectionId: string; readonly binding: ExternalCalendarBinding; readonly googleSubject: string; readonly externalEventId: string; readonly expectedRemoteVersion: string; readonly expectedOperationId: string; readonly startAt: string; readonly endAt: string }): Promise<VerifiedGoogleCalendarConflictEvidence | null> {
    if (!valid(context, companyId, input)) return null;
    const request = { context, companyId, connectionId: input.connectionId as never, binding: input.binding, startAt: input.startAt, endAt: input.endAt, signal: AbortSignal.timeout(8_000) };
    const [current, listed, busy, reconciled] = await Promise.all([
      this.events.getEvent({ ...request, externalEventId: input.externalEventId }),
      this.events.listEvents(request),
      this.busy.listBusyIntervals(request),
      this.reconciliation.reconcileEvents(request),
    ]);
    if (current.kind !== "success" || listed.kind !== "success" || busy.kind !== "success" || reconciled.kind !== "success") return null;
    const event = current.event;
    if (event.remoteState !== "active" || event.externalEventId !== input.externalEventId || event.remoteVersion !== input.expectedRemoteVersion || event.startAt !== input.startAt || event.endAt !== input.endAt || !event.timeZone || (event.createOperationId !== input.expectedOperationId && event.lastOperationId !== input.expectedOperationId)) return null;
    const matching = reconciled.events.filter(value => value.externalEventId === input.externalEventId);
    if (matching.length !== 1 || matching[0]!.remoteVersion !== event.remoteVersion || matching[0]!.startAt !== event.startAt || matching[0]!.endAt !== event.endAt || matching[0]!.timeZone !== event.timeZone || (matching[0]!.createOperationId !== input.expectedOperationId && matching[0]!.lastOperationId !== input.expectedOperationId)) return null;
    const listedOwn = listed.events.filter(value => value.externalEventId === input.externalEventId);
    if (listedOwn.length !== 1 || listedOwn[0]!.remoteVersion !== event.remoteVersion || listedOwn[0]!.startAt !== event.startAt || listedOwn[0]!.endAt !== event.endAt || listedOwn[0]!.timeZone !== event.timeZone || !sameCoverage(busy.intervals, listed.events, input.startAt, input.endAt)) return null;
    const observedAt = this.clock.now();
    return Object.freeze({ bindingId: input.binding.id, externalCalendarId: input.binding.externalCalendarId, externalEventId: event.externalEventId, remoteVersion: event.remoteVersion, startAt: event.startAt, endAt: event.endAt, timeZone: event.timeZone, observedAt, fingerprint: fingerprint(context, companyId, input, event) });
  }
}

function valid(context: WorkspaceContext, companyId: number, input: { readonly binding: ExternalCalendarBinding; readonly googleSubject: string; readonly externalEventId: string; readonly expectedRemoteVersion: string; readonly expectedOperationId: string; readonly startAt: string; readonly endAt: string }): boolean { return input.binding.workspaceId === context.workspaceId && input.binding.companyId === companyId && input.binding.externalCalendarId.trim().length > 0 && input.googleSubject.trim().length > 0 && input.externalEventId.trim().length > 0 && input.expectedRemoteVersion.trim().length > 0 && /^ewo_[a-f0-9]{32}$/.test(input.expectedOperationId) && input.startAt < input.endAt; }
function fingerprint(context: WorkspaceContext, companyId: number, input: { readonly binding: ExternalCalendarBinding; readonly googleSubject: string; readonly externalEventId: string; readonly expectedRemoteVersion: string; readonly expectedOperationId: string }, event: { readonly startAt: string; readonly endAt: string; readonly timeZone: string }): string { return createHash("sha256").update(JSON.stringify({ contract: "google-calendar-conflict-evidence-v1", workspaceId: context.workspaceId, companyId, bindingId: input.binding.id, calendarId: input.binding.externalCalendarId, googleSubject: input.googleSubject, eventId: input.externalEventId, etag: input.expectedRemoteVersion, operationId: input.expectedOperationId, startAt: event.startAt, endAt: event.endAt, timeZone: event.timeZone })).digest("hex"); }
function sameCoverage(busy: readonly { readonly startAt: string; readonly endAt: string }[], events: readonly { readonly startAt: string; readonly endAt: string }[], startAt: string, endAt: string): boolean { const normalized = (values: readonly { readonly startAt: string; readonly endAt: string }[]) => values.map(value => ({ startAt: value.startAt < startAt ? startAt : value.startAt, endAt: value.endAt > endAt ? endAt : value.endAt })).filter(value => value.startAt < value.endAt).sort((left, right) => left.startAt.localeCompare(right.startAt)); const left = normalized(busy), right = normalized(events); return left.length === right.length && left.every((value, index) => value.startAt === right[index]?.startAt && value.endAt === right[index]?.endAt); }
