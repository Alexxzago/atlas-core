import type { ExternalBusyProviderPort, ExternalCalendarEventProviderPort } from "../application/externalCalendarPorts.js";
import type { ExternalCalendarBinding } from "../domain/externalCalendar.js";
import type { SchedulingBooking } from "../domain/scheduling.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export type CalendarAvailabilityPreflightResult = { readonly kind: "available" } | { readonly kind: "availability_unverified" };

/** Requires mutually consistent, complete provider evidence before a bound local command commits. */
export class CalendarAvailabilityPreflightService {
  public constructor(private readonly busy: ExternalBusyProviderPort, private readonly events: ExternalCalendarEventProviderPort) {}

  public async create(context: WorkspaceContext, companyId: number, connectionId: string, binding: ExternalCalendarBinding, interval: Interval): Promise<CalendarAvailabilityPreflightResult> {
    const evidence = await this.evidence(context, companyId, connectionId, binding, interval);
    return evidence && evidence.events.every(event => !overlaps(event, interval)) ? { kind: "available" } : { kind: "availability_unverified" };
  }

  public async reschedule(context: WorkspaceContext, companyId: number, connectionId: string, binding: ExternalCalendarBinding, source: SchedulingBooking, mapping: { readonly externalEventId: string; readonly remoteVersion: string | null }, destination: Interval): Promise<CalendarAvailabilityPreflightResult> {
    if (!mapping.remoteVersion) return { kind: "availability_unverified" };
    const sourceInterval = { startAt: source.occupiedStartAt, endAt: source.occupiedEndAt };
    const [remote, sourceEvidence, destinationEvidence] = await Promise.all([
      this.events.getEvent({ context, companyId, connectionId: connectionId as never, binding, externalEventId: mapping.externalEventId, signal: new AbortController().signal }),
      this.evidence(context, companyId, connectionId, binding, sourceInterval),
      this.evidence(context, companyId, connectionId, binding, destination),
    ]);
    if (remote.kind !== "success" || remote.event.remoteState !== "active" || remote.event.remoteVersion !== mapping.remoteVersion || remote.event.startAt !== source.startAt || remote.event.endAt !== source.endAt || !sourceEvidence || !destinationEvidence) return { kind: "availability_unverified" };
    const sourceOwn = sourceEvidence.events.filter(event => event.externalEventId === mapping.externalEventId);
    if (sourceOwn.length !== 1 || sourceOwn[0]!.remoteVersion !== mapping.remoteVersion || sourceEvidence.events.some(event => event.externalEventId !== mapping.externalEventId && overlaps(event, sourceInterval))) return { kind: "availability_unverified" };
    return destinationEvidence.events.some(event => event.externalEventId !== mapping.externalEventId && overlaps(event, destination)) ? { kind: "availability_unverified" } : { kind: "available" };
  }

  private async evidence(context: WorkspaceContext, companyId: number, connectionId: string, binding: ExternalCalendarBinding, interval: Interval): Promise<{ readonly events: readonly Event[] } | null> {
    const [busy, listed] = await Promise.all([
      this.busy.listBusyIntervals({ context, companyId, connectionId: connectionId as never, binding, ...interval, signal: new AbortController().signal }),
      this.events.listEvents({ context, companyId, connectionId: connectionId as never, binding, ...interval, signal: new AbortController().signal }),
    ]);
    if (busy.kind !== "success" || listed.kind !== "success" || listed.events.some(event => !event.externalEventId || !event.remoteVersion || !overlaps(event, interval))) return null;
    const busyCoverage = coverage(busy.intervals.filter(value => overlaps(value, interval)), interval);
    const eventCoverage = coverage(listed.events.filter(value => overlaps(value, interval)), interval);
    return sameCoverage(busyCoverage, eventCoverage) ? { events: listed.events } : null;
  }
}

export interface Interval { readonly startAt: string; readonly endAt: string; }
interface Event { readonly externalEventId: string; readonly remoteVersion: string; readonly startAt: string; readonly endAt: string; }
function overlaps(value: Interval, interval: Interval): boolean { return value.startAt < interval.endAt && value.endAt > interval.startAt; }
function coverage(values: readonly Interval[], range: Interval): readonly Interval[] {
  const sorted = values.map(value => ({ startAt: value.startAt < range.startAt ? range.startAt : value.startAt, endAt: value.endAt > range.endAt ? range.endAt : value.endAt })).filter(value => value.startAt < value.endAt).sort((left, right) => left.startAt.localeCompare(right.startAt));
  const result: { startAt: string; endAt: string }[] = [];
  for (const value of sorted) { const previous = result[result.length - 1]; if (previous && value.startAt <= previous.endAt) previous.endAt = value.endAt > previous.endAt ? value.endAt : previous.endAt; else result.push({ ...value }); }
  return result;
}
function sameCoverage(left: readonly Interval[], right: readonly Interval[]): boolean { return left.length === right.length && left.every((value, index) => value.startAt === right[index]?.startAt && value.endAt === right[index]?.endAt); }
