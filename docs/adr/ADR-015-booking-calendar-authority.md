# ADR-015: Booking and External Calendar Authority

**Status:** Accepted
**Date:** 2026-09-28

## Context

Atlas already has a tenant-scoped local scheduling model. `scheduling_bookings` is the durable booking record, and local create, reschedule, and cancel are transactional with resource capacity, buffers, availability, holds, idempotency, and reschedule lineage. The current external-calendar foundation has resource bindings, external-event mappings, provider write operations, leases, and Google provider adapters.

This is not yet an operational calendar integration. There is no operator booking API or Agenda UI, no Google OAuth/calendar-selection workflow, no production reconciliation worker invocation, and no demonstrated handling of externally edited mapped events. Assistant booking tools call local booking commands directly rather than `SchedulingBookingRouter`; ordinary assistant runtime supplies neither write confirmation nor an idempotency key.

EPIC057 must support businesses without a website. WhatsApp, phone-entered operator work, Web Chat, and future channels must operate on one booking truth. Google Calendar is the first concrete external provider, but provider events must not become independent bookings.

## Evidence

- Canonical booking schema and local scheduling scope: `backend/src/config/migrations.ts:1199-1266,1281-1302`.
- Local transactional booking mutation and availability check: `backend/src/repositories/bookingRepository.ts:13-80`.
- Current local command service: `backend/src/scheduling/services/bookingCommandService.ts:8-28`.
- Router selects local or external path by resource binding: `backend/src/scheduling/services/schedulingBookingRouter.ts:28-95`.
- Current assistant tools bypass the router: `backend/src/composition.ts:323-330`; regression evidence: `backend/src/tests/epic041.scheduling-booking-router.test.ts:103-110`.
- Existing binding cardinality is one binding per resource and one `(integration_connection_id, external_calendar_id)` per binding: `backend/src/config/migrations.ts:1381-1387`. Generic integration connections are also unique per `(workspace_id, company_id, provider, kind)`: `backend/src/config/migrations.ts:1150-1158`.
- Existing FreeBusy refresh reads a binding and replaces only that resource's `external_observed` intervals: `backend/src/scheduling/services/externalBusyRefreshService.ts:11-18`.
- Existing external operation state/lease persistence exists but is not a complete self-service synchronization workflow: `backend/src/config/migrations.ts:1395-1409`; `backend/src/repositories/externalCalendarRepository.ts:24-47`.
- Google event writes use provider ETags and Atlas operation metadata: `backend/src/integrations/providers/googleCalendarEventsProvider.ts:12-28`.

## Decision

### 1. Canonical reservation authority

`scheduling_bookings` remains the sole canonical reservation record. Its IDs, lineage, local transactional capacity checks, timezone validation, tenant scope, and idempotency contract are preserved.

An external Google event is a projection of an Atlas booking only when it has a durable `scheduling_external_booking_events` mapping. An assistant memory, conversation message, tool trace, FreeBusy interval, or Google event is never a second booking record.

Every operator, WhatsApp, Web Chat, and future-channel create/reschedule/cancel command must enter one server-side command facade and pass through `SchedulingBookingRouter`. The facade owns actor/source/reason attribution, expected-version validation, idempotency, audit, and result projection. Controllers and frontend code do not duplicate scheduling rules.

### 2. First-pilot resource/calendar cardinality

P2 supports explicit one-to-one binding:

```text
one SchedulingResource <-> one selected Google Calendar
```

The resource can represent a padel court, professional, room, chair, workshop bay, or other operational capacity. A resource has at most one active binding. A selected calendar may bind to at most one resource for the Company.

The current schema prevents two ordinary Google calendar connections of the same provider/kind in one Company, and prevents a selected calendar from being repeated in that connection. P2 must make the same business rule independently verifiable at OAuth/binding time: persist or derive the authorized Google account subject, verify that the selected calendar belongs to that authorization, and reject an existing Company binding with the same stable provider-account subject plus external calendar ID. This is required even if future connection lifecycle work could otherwise create duplicate connection records. A calendar in another Company is not compared or exposed; Company/workspace isolation remains authoritative.

Shared calendars serving several resources are outside P2. P2 must not copy the busy intervals of one shared calendar to every resource. Supporting that topology later requires an approved, demonstrable event-to-resource classification contract, such as an immutable Atlas resource marker on Atlas-created events plus a customer-approved rule for external events. Free-text titles, attendee guesses, and calendar-wide fan-out are not valid classification.

### 3. External availability before local confirmation

For an unbound resource, the existing local transactional availability check is authoritative.

For a Google-bound create or reschedule, a command must perform a bounded provider preflight immediately before the canonical local commit. The destination preflight range covers the occupied interval, including configured buffers. It must be newer than a P2-configured maximum freshness age measured at command execution; the exact maximum is a P2 implementation parameter and must be recorded with the command/audit result.

FreeBusy is aggregated and contains no event IDs. It is not sufficient evidence for excluding a booking's own mapped event. P2 must extend the provider contract with an authorized, bounded event-list/read operation for the selected calendar and requested range. The provider evidence for a mapped booking consists of the durable mapping `(binding_id, external_event_id, remote_version)`, a current `getEvent` result for that exact event ID, and an appropriate range listing with stable event IDs and current versions. The account/calendar authorization must be able to read all event occupancy relevant to this policy. If the listing is incomplete, inaccessible, inconsistent with FreeBusy, or lacks a usable event ID/version, the command fails safe.

For create, every destination overlap reported by the range listing or FreeBusy is foreign occupancy and rejects the command. For reschedule, P2 resolves the source mapping first and verifies its current event ID, ETag, state, interval, and calendar binding. It then validates both source and destination occupied intervals. Only the exact verified mapped source event may be excluded from the source interval calculation. At the destination, that same event may be excluded only after the listing and FreeBusy evidence prove that every remaining overlapping busy event is absent; any other event, merged/ambiguous FreeBusy interval, inconsistent listing, or unknown occupancy rejects the reschedule. The source and destination checks include service buffers.

For cancel, no free-slot claim is made. Before a provider delete, the worker or command must verify the exact mapping/event ID and current ETag. If Google cannot be read, Atlas may still commit the local cancellation with a durable pending external cancellation operation, but it must not claim that the external event was cancelled or issue a blind delete. Recovery must re-read the mapped event before deletion; an absent or changed event becomes `conflict` for explicit operator resolution.

The command may commit locally only when both conditions hold:

1. FreeBusy and the bounded event evidence succeed for the selected binding with a valid active connection, are mutually consistent, and show no foreign external conflict for the applicable resource interval.
2. The existing local transaction revalidates service/resource availability, local holds, confirmed bookings, internal blocks, current stored external observations, capacity, buffers, lead time, horizon, and expected version.

Timeout, revoked/invalid token, unavailable provider, invalid response, stale preflight, incomplete event evidence, or inability to establish a reliable FreeBusy result fails closed before create/reschedule local commit. The result is `availability_unverified`; no slot is promised and no booking is confirmed.

Google and Atlas do not share an atomic transaction. A provider event can change after FreeBusy and before/after local commit. The preflight reduces this race but does not remove it. Durable projection, ETag handling, conflict status, and reconciliation are mandatory compensating controls.

### 4. Local transaction, durable outbox, and synchronization result

P2 separates `booking.status` from `calendarSync.status`. `booking.status` remains the canonical scheduling lifecycle (`confirmed` or `cancelled`, with existing reschedule lineage). `calendarSync.status` is an orthogonal projection for the current desired external representation of a canonical booking version:

| Public operational state | Meaning |
|---|---|
| `not_connected` | No selected active binding applies to this resource; no external projection is expected. |
| `pending` | A durable create, reschedule, or cancel projection operation exists for the current canonical booking version and has not yet been verified. |
| `synced` | The current desired representation is verified by its operation, mapping/event ID, remote ETag/version, remote state, and observed timestamp. For cancellation, verified remote deletion/cancelled state proves synchronization. |
| `failed` | The local booking remains canonical, but its current external projection reached a non-retryable failure or exhausted recovery policy. |
| `conflict` | The local booking remains canonical, but mapped remote state/version differs, is absent unexpectedly, or remote concurrency rejected the desired projection. |

For a Google-bound resource, the command sequence is:

```text
fresh preflight -> one local transaction: canonical booking + lineage/links/audit + durable outbox operation -> provider write/reconcile -> truthful sync state
```

For each synchronized create, reschedule, or cancel, the canonical `scheduling_bookings` change, its booking links/lineage/audit event, and the recoverable external operation must commit in the same SQLite transaction. A process crash may leave an operation `pending` or `uncertain`, but cannot leave a locally committed change without its durable external operation. Network calls occur only after that transaction commits. Reconciliation retries are idempotent using the durable operation key/fingerprint, provider correlation ID, mapped event ID, and ETag/version.

A post-commit Google failure never silently rolls back the canonical booking. It must not claim that the appointment exists in Google. The current external implementation reserves a hold, performs remote work, and finalizes the local booking afterward through `ExternalCalendarRepository.finalizeCreate/finalizeReschedule/finalizeCancel`; P2 must migrate that remote-first sequencing only for bound-resource commands to the local transaction plus durable outbox sequence above. The existing local-only command path remains the source of capacity rules and must not be duplicated.

Customer-facing confirmation copy:

| Result | Customer-facing copy |
|---|---|
| `booking.status=confirmed`, `calendarSync.status=not_connected` | "Your reservation is confirmed." |
| `booking.status=confirmed`, `calendarSync.status=pending` | "Your reservation is confirmed in Atlas. Calendar synchronization is still in progress." |
| `booking.status=cancelled`, `calendarSync.status=pending` | "Your reservation is cancelled in Atlas. Calendar cancellation is still in progress." |
| `calendarSync.status=synced` | State the matching confirmed, rescheduled, or cancelled outcome and verified calendar synchronization. |
| `calendarSync.status=failed` or `conflict` | Do not send an automatic success claim about Google. An operator-facing recovery action is required; customer communication follows business policy. |
| `availability_unverified` before commit | "We could not verify availability. No reservation was made." |

Agenda copy must compose both axes: `Confirmed in Atlas / Syncing calendar`, `Cancelled in Atlas / Calendar cancellation pending`, `Confirmed in Atlas / Calendar sync failed`, `Cancelled in Atlas / Calendar conflict`, and `No calendar connected`. It must expose the safe failure category, retry/reconcile availability, desired operation, and timestamp of the last provider evidence without exposing credentials or provider payloads.

### 5. External changes and explicit conflict resolution

An unrelated Google event is external occupancy only. It becomes an `external_observed` busy interval for its one bound resource and never creates, cancels, or changes an Atlas booking.

An external direct modification or deletion of a mapped Atlas event is a visible `conflict`. It does not automatically modify or cancel `scheduling_bookings`. This is not advertised as automatic bidirectional synchronization.

An authorized operator must choose one explicit, idempotent resolution using current local booking version and current remote ETag/version where applicable:

| Resolution | Effect |
|---|---|
| Restore Atlas | Reapply the current canonical booking to Google with remote concurrency validation. |
| Adopt Google | Read/validate the current mapped Google event, then execute an Atlas canonical reschedule or cancel command. It must pass normal local conflict checks and expected local version. |
| Cancel Atlas | Execute canonical Atlas cancellation, then durably project Google cancellation/reconciliation. |

If the remote event is absent, `adopt Google` is unavailable; the operator chooses restore Atlas or cancel Atlas. If local or remote versions changed after the detail was loaded, resolution returns a conflict, reloads state, and never overwrites either side blindly.

### 6. Channel authority

WhatsApp may read current scheduling state only through authorized server tools. A WhatsApp booking write requires an explicit, durable confirmation linked to the specific inbound message/conversation request and a source-owned idempotency key. The runtime must not infer confirmation, idempotency, booking status, or successful sync from conversation memory.

Web Chat, when connected in P4, uses the same facade and confirmation contract. A website is not a prerequisite for Agenda, contacts, Google Calendar, or WhatsApp operations.

### 7. Generic commercial boundary

P1 delivers Agenda and minimal contacts for any company, including a company without a website. P4 may add generic requests/opportunities that can exist without a reservation. Atlas is not positioned as a universal sales CRM.

Padel courts, consulting rooms, salon chairs, workshop bays, and real-estate visits use the same resource/service/booking core. Clinical data and real-estate property attributes do not belong in global booking, contact, or request tables.

### 8. External gates

Google P2 requires customer-owned OAuth authorization, explicit calendar selection, revocation handling, provider evidence, durable recovery, and an operational reconciliation path.

WhatsApp P3 is Meta Direct only: no BSP, no Atlas card/credit for customer messaging, no credit sharing, and no Atlas-financed messages. A fixture or test-recipient flow does not authorize a LIVE claim. Customer-owned Meta Business, WABA, phone number, billing/payment eligibility, required permissions/review, and production webhook validation are external gates. Outside the 24-hour service window, no template or fallback is sent silently.

## State and Failure Matrix

| Trigger | Local booking | Sync state | Required behavior |
|---|---|---|---|
| Unbound resource command succeeds | Confirmed/cancelled | `not_connected` | Return local canonical outcome. |
| Bound create/reschedule preflight succeeds; local transaction succeeds | Confirmed | `pending` | Commit booking, lineage/links/audit, and durable operation together; do not claim Google success. |
| Bound cancellation local transaction succeeds | Cancelled | `pending` | Commit cancellation/audit and durable cancellation operation together; do not claim Google cancellation. |
| Provider write/delete verified | Confirmed/cancelled | `synced` | Persist operation, mapping/event ID, remote version/state, and verified timestamp for the current booking version. |
| Provider timeout/unavailable after local commit | Confirmed/cancelled | `pending` | Mark recoverable/uncertain and reconcile. |
| Provider non-retryable failure after local commit | Confirmed/cancelled | `failed` | Preserve local booking; expose recovery/operator action. |
| FreeBusy/event evidence fails or is stale before create/reschedule commit | Unchanged | No new sync state | Return `availability_unverified`; no confirmation. |
| Mapped event edited/deleted remotely | Unchanged | `conflict` | Require explicit restore/adopt/cancel resolution. |
| Restore/adopt/cancel loses local or remote version | Unchanged | `conflict` | Return controlled stale conflict; reload state. |
| Recovery worker restarts | Unchanged | Pending/reconciling state retained | Claim durable work by lease; reconcile idempotently. |

## Consequences

P2 cannot be treated as a simple calendar export. It requires a local-first durable outbox-like operation model, fresh external availability preflight, provider reconciliation, visible failures, and explicit external-edit resolution.

The existing external tables and adapters are reusable, but their current sequencing and incomplete invocation are insufficient for this decision. No provider-specific behavior is added to the generic local scheduling rules; provider interaction remains behind ports/adapters.

## Alternatives Considered

- Treat Google events as canonical appointments: rejected because it fragments channel-independent authority and loses local transactional capacity controls.
- Confirm slots when FreeBusy is unavailable: rejected because a Google-bound resource cannot honestly claim availability without current external evidence.
- Roll back local booking after an uncertain post-commit provider failure: rejected because Google outcomes can be indeterminate and local operational truth must remain durable and visible.
- Automatically adopt direct Google edits: rejected because it could bypass local availability, actor authority, audit, and tenant-safe canonical commands.
- Bind one shared calendar to every resource: rejected because current FreeBusy data cannot classify events safely by resource.
- Implement a property-centric or clinical booking model: rejected because EPIC057 serves generic service businesses and must avoid sensitive medical data by default.

## Conditions For Revisiting

Revisit resource/calendar cardinality only when an approved, testable shared-calendar classification contract exists. Revisit local-first synchronization only when a provider offers a demonstrably stronger transactional guarantee without weakening Atlas canonical authority, tenant isolation, auditability, or truthful customer communication.
