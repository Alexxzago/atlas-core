# EPIC-057: Operational CRM and Scheduling

## Status

P0 architecture approved. P1 implementation authorized after the documentation-only commit. It is based on the published `b3d969b` / `v0.56.10-alpha` baseline and the current `epic/057-operational-crm-scheduling` worktree.

## P0 Outcome

EPIC057 establishes a channel-independent operational booking foundation. Atlas must work for businesses without a website. The first operational paths are human operator work and, after its own external gates, Meta Direct WhatsApp. Web Chat is an additional channel, not a product prerequisite.

The authority contract proposed in ADR-015 is the P0 review baseline. `scheduling_bookings` remains canonical. Google Calendar is a required P2 integration gate, not an optional marketing claim or a second booking system.

## Current Evidence and Gaps

| Capability | Current state | Evidence |
|---|---|---|
| Local booking atomicity | Implemented | `backend/src/repositories/bookingRepository.ts:13-80`. |
| Booking IDs/lineage/audit/idempotency | Implemented, audit attribution incomplete | `backend/src/config/migrations.ts:1255-1266,1281-1302`. |
| Resource/service/availability configuration | Implemented | `backend/src/config/migrations.ts:1199-1254`; `frontend/src/components/SchedulingAutomationsPanel.tsx:400-1151`. |
| Operator booking API and Agenda | Absent | `backend/src/routes/authorizedCompanies.ts:234-238` exposes configuration only; `frontend/src/routing/routes.ts:1-52` has no Agenda route. |
| Contact/request model | Absent | Conversation participant is local to a conversation: `backend/src/conversation/domain/conversation.ts:18-24`. |
| Google adapter and durable primitives | Partial | `backend/src/integrations/providers/googleCalendarEventsProvider.ts:12-28`; `backend/src/config/migrations.ts:1381-1437`. |
| Google self-service OAuth/calendar selection/reconciliation | Absent | No route/controller/UI/worker invocation found; adapter registration is environment-gated in `backend/src/composition.ts:305-320`. |
| FreeBusy scoped refresh | Partial | It writes intervals only for the one resource binding: `backend/src/scheduling/services/externalBusyRefreshService.ts:11-18`; it is not a pre-commit freshness contract. |
| One canonical command path | Partial | Router exists: `backend/src/scheduling/services/schedulingBookingRouter.ts:28-95`; assistant tools bypass it: `backend/src/composition.ts:323-330`. |
| WhatsApp infrastructure | Partial | Cloud API/connection lifecycle exists; normal assistant runtime sends null confirmation/idempotency: `backend/src/assistant/services/operationalAssistantRuntime.ts:73-79`. |
| Meta 24-hour/template policy | Partial/absent | Rejection is classified after provider response: `backend/src/whatsapp/providers/WhatsAppCloudApiProvider.ts:36-38`; templates/fallback are absent. |

## Frozen P0 Decisions

1. The first Google topology is one explicit selected calendar per resource and one resource per selected calendar. Shared-calendar multi-resource operation is outside P2. P2 additionally verifies the customer-authorized Google account subject plus selected calendar ID and rejects reuse within the same Company, even if future connection changes could duplicate a connection.
2. A Google-bound create/reschedule needs fresh successful FreeBusy plus event-ID/ETag evidence immediately before local commit and current transactional local validation. FreeBusy alone cannot exclude a mapped event. Any unavailable, stale, unauthorized, timed-out, incomplete, inconsistent, or untrusted read fails closed before confirmation.
3. Atlas booking state is canonical. Unrelated Google events are external occupancy. Direct changes/deletions of mapped events are operator-visible conflicts, not automatic bidirectional synchronization.
4. The displayed result separates `booking.status` from `calendarSync.status = not_connected | pending | synced | failed | conflict`. A pending cancellation remains `booking.status=cancelled`, never a confirmed-looking combined state.
5. For a bound command, canonical booking change, lineage/links/audit, and durable external operation commit in one local transaction. Post-commit Google failure preserves local canonical booking and creates a visible durable recovery condition. It never claims Google synchronization.
6. Operator APIs and assistant tools share one server-side facade through `SchedulingBookingRouter`.
7. WhatsApp write authority requires durable explicit confirmation tied to an inbound request and source-owned idempotency. Assistant memory is not authority.
8. P1 provides Agenda plus minimal contacts without a website. P4 adds generic requests/opportunities that may exist without a booking. No universal CRM, medical record, or global property schema is introduced.
9. Meta Direct is the only WhatsApp commercial model. No BSP, Atlas payment instrument, credit sharing, or silent out-of-window template fallback is allowed.

## State Matrix

| Local result | Calendar result | Agenda state | Customer message |
|---|---|---|---|
| `confirmed` or `cancelled` | No selected active binding | `not_connected` | State only the local booking outcome; do not imply external calendar. |
| `confirmed` | Durable create/reschedule awaiting/reconciling | `pending` | "Confirmed in Atlas; calendar synchronization is in progress." |
| `cancelled` | Durable cancellation awaiting/reconciling | `pending` | "Cancelled in Atlas; calendar cancellation is in progress." |
| `confirmed` or `cancelled` | Current operation plus mapping/event ID, remote version/state and timestamp verified | `synced` | State the matching local outcome and verified calendar synchronization. |
| `confirmed` or `cancelled` | Terminal provider failure | `failed` | Do not claim calendar success; operator recovery required. |
| `confirmed` or `cancelled` | Mapped remote event differs/is absent or ETag conflict | `conflict` | Do not claim calendar success; operator resolution required. |
| No local mutation | FreeBusy/event evidence unavailable, stale, revoked, incomplete, inconsistent or conflicting | No new booking | "Availability could not be verified. No reservation was made." |

Remote conflict resolutions are explicit, idempotent commands with current local expected version and remote version where applicable:

- `restore_atlas`: reapply canonical Atlas state to Google.
- `adopt_google`: validate current remote event, then execute canonical Atlas reschedule/cancel rules.
- `cancel_atlas`: execute canonical Atlas cancellation, then project/reconcile externally.

## P1: Agenda, Human Operations, Minimal Contacts

### Objective

Deliver a local Atlas operational workflow usable by a padel venue, appointment center, salon, workshop, or real-estate agency without requiring a website, Meta approval, Google OAuth, or a vertical catalog.

### Included

- Company-scoped Agenda, initially day-oriented.
- Search by booking reference, exact identifier, and contact name.
- Booking detail with service, resource, local timezone, duration, origin, status and audit/history.
- Manual create, reschedule, cancel, source/reason, idempotency and stale-write protection.
- Minimal generic contacts with exact identifiers and consent provenance.
- Canonical command facade through `SchedulingBookingRouter` for operator API and future assistant use.
- Existing scheduling availability/capacity/buffer/timezone rules reused server-side.

### P1 command contracts

P1 is local-only. It exposes no Google/Meta synchronization endpoint, field, badge, or customer copy.

| Operation | Minimum server contract |
|---|---|
| Create | Authenticated `company:manage` actor; tenant-scoped service/resource/start/reference/contact input; `origin` restricted to `phone` or `operator`; required `idempotencyKey`; server derives actor and tenant; returns canonical booking/detail. |
| Search | Authenticated `company:read` actor; tenant-scoped reference, exact normalized identifier, or bounded name query; returns no records outside current Company. |
| Detail | Authenticated `company:read` actor; tenant-scoped booking ID; returns canonical booking, resource/service/timezone, minimal contact link, origin and append-only audit projection. |
| Reschedule | Authenticated `company:manage` actor; tenant-scoped booking ID, new start, `expectedVersion`, required `idempotencyKey`, `origin=phone|operator`, and bounded reason; uses the canonical facade/local transaction. |
| Cancel | Authenticated `company:manage` actor; tenant-scoped booking ID, `expectedVersion`, required `idempotencyKey`, `origin=phone|operator`, and bounded reason; uses the canonical facade/local transaction. |

For every P1 mutation, an identical operation/idempotency key and request fingerprint replays the original result; the same key with a different payload returns an idempotency conflict. A changed booking version/state, slot conflict, or tenant mismatch returns a controlled conflict/not-found response and never a silent success. The server records authenticated actor, source, reason, operation key/fingerprint reference, prior/current version, timestamp, and result in append-only audit. The frontend supplies intent only and never determines availability, authorization, audit, or result state.

Minimal contacts use exact normalized identifiers with consent provenance. Name is search/display only; P1 forbids automatic merge by name.

### Excluded

- Google OAuth/sync implementation.
- WhatsApp booking implementation.
- Web Chat booking implementation.
- Requests/opportunities beyond a minimal future-compatible link boundary.
- Shared calendar support.
- Medical/clinical fields and property schema.

### P1 exit criteria

- Two padel courts can be configured as resources with 60/90-minute services, availability, buffer and capacity.
- Two simultaneous attempts for the last valid slot result in exactly one canonical booking.
- A phone operator finds any local booking, reschedules or cancels it, and sees the canonical result/history.
- A company with no website can configure and operate Agenda.
- Exact identifier matching never auto-merges based on name.
- Cross-tenant reads/writes remain concealed/blocked.

## P2: Google Calendar Self-Service and Reconciliation

### Objective

Connect a customer-owned Google account and selected calendar to one resource, use fresh external availability before confirmation, and truthfully project canonical bookings to Google with durable recovery.

### Required behavior

- OAuth authorization flow, callback integrity, calendar listing/selection, binding and revocation handling.
- Existing `IntegrationConnection`, binding, provider adapter, ETag and durable operation tables reused.
- FreeBusy plus bounded event-list/read preflight immediately before local create/reschedule commit; mapped-event ID/ETag evidence is required to exclude an affected event.
- One local transaction commits booking/lineage/links/audit and durable outbox operation; verified provider evidence is required for `synced`.
- Recovery worker survives restart and reconciles pending/uncertain operations by lease.
- Unrelated remote events become occupancy for their one bound resource only.
- Mapped-event external edit/deletion becomes `conflict` and needs explicit operator resolution.
- Agenda exposes provider state without credentials or raw provider data.

### P2 exit criteria

- Customer connects/revokes Google OAuth and chooses one calendar.
- Selected calendar binds to one resource only.
- External occupancy blocks relevant slots but does not contaminate other resources.
- Create/reschedule/cancel reach Google only after canonical command and durable operation creation.
- Timeout, provider error, conflict, restart and recovery produce truthful `pending`, `failed`, or `conflict` states.
- No reservation is declared synchronized without verified provider evidence.

## P3: Meta Direct WhatsApp Booking

### Objective

Support WhatsApp inbound availability, explicit confirmation, canonical booking, Agenda visibility, and Google projection when the resource is bound.

### Required behavior

- Reuse existing Meta Direct connection/webhook/conversation infrastructure where verified.
- Add durable confirmation receipt tied to a specific inbound message/conversation command and idempotency key.
- Route assistant writes through the same canonical command facade as P1 operators.
- Read current booking state from the server projection for subsequent questions.
- Respect 24-hour service-window policy; no unimplemented template fallback is silently used.
- Distinguish fixture/test verification from customer-authorized Meta Direct LIVE operation.

### P3 exit criteria

- Controlled connection or fixture covers inbound request, fresh availability, explicit confirmation, duplicate retry, one canonical booking, Agenda display, and truthful Google sync state.
- No LIVE Meta claim exists until customer-owned WABA/number/billing, required Meta permissions/review, and production webhook gates are verified.

## P4: Generic Requests/Opportunities and Web Chat Parity

### Objective

Add bounded generic requests/opportunities and multichannel operational history. A request can exist without a reservation.

Web Chat uses the same contact, confirmation, command, sync-status, audit, and current-state-read path as WhatsApp. A real-estate property relation, if separately approved, is a vertical extension attached to a request and is never required by the generic core.

## Demonstrable Scenarios

### Two simultaneous padel courts

1. Company configures Court A and Court B as separate `SchedulingResource` records.
2. Each court has its own selected Google calendar in P2; no shared calendar is supported.
3. The business configures 60- and 90-minute services, local working windows, buffers and capacity.
4. Two customers request the final available Court A slot concurrently.
5. For a Google-bound Court A, each command performs fresh Court A FreeBusy plus bounded event-ID/ETag evidence preflight. FreeBusy/event evidence for Court B is irrelevant.
6. The local transaction accepts one request and rejects the other using current scheduling capacity/hold/booking checks.
7. The accepted booking has `booking.status=confirmed` and `calendarSync.status=pending` until Google provider evidence persists the operation, mapped event/version/state, and observed timestamp; it becomes `synced` only then.
8. A provider timeout after local commit leaves the Court A booking confirmed locally and visibly pending recovery. It does not affect Court B and does not claim a Google event.

### Telephone reschedule with Google connected

1. An employee receives a call and searches Agenda by reference, exact phone/WhatsApp identifier, or contact name.
2. Detail displays the canonical booking, resource, source, local timezone, current sync state, and latest local/remote versions.
3. Operator selects a new server-returned slot and supplies `phone` source, reason, idempotency key and expected booking version.
4. The bound-resource command verifies the source mapped event ID/ETag, validates source and destination occupied intervals with fresh FreeBusy plus bounded event evidence, then one local transaction creates canonical lineage/audit and durable external operation. The replacement is `booking.status=confirmed`, `calendarSync.status=pending`; the predecessor is `booking.status=cancelled` with its corresponding projection state.
5. Google patch/delete/create behavior is recorded through durable operations and ETag conditions.
6. On verified provider success, detail is `synced`; on timeout/error it is pending/failed; on direct remote edit it is `conflict`.
7. A later assistant query reads current canonical booking state, not prior conversation memory.

## External Gates

| Gate | Scope | Release effect |
|---|---|---|
| Google OAuth client/configuration | P2 | Without verified customer authorization, no Google-connected claim. |
| Google calendar selection and binding | P2 | No external occupancy/sync without explicit selected calendar per resource. |
| Google revocation/recovery verification | P2 | No production sync claim until failure/restart behavior is demonstrated. |
| Meta Direct app/WABA/number/billing eligibility | P3 | Fixture success does not permit LIVE declaration. |
| Customer-owned Meta billing/payment | P3 | Atlas neither supplies nor shares messaging funding. |
| Meta permissions/review and production webhook | P3 | Required before customer LIVE operation. |
| WhatsApp 24-hour policy | P3 | No out-of-window message fallback unless separately implemented and approved. |

## P1 Blockers And Pending Decisions

No external Google or Meta approval blocks P1 local Agenda/human operations.

The following are P2/P3 blockers and must not be guessed during implementation:

| Decision or evidence gap | Location/symbol | Required decision |
|---|---|---|
| Local-first transaction-plus-outbox semantics differ from current remote-first external finalization | `backend/src/repositories/externalCalendarRepository.ts:34-37`; `SchedulingBookingRouter` | Approve P2 migration/service redesign before coding; no crash gap between local booking and durable operation is permitted. |
| FreeBusy has no event IDs, and freshness/event-evidence preflight is not modeled | `backend/src/scheduling/services/externalBusyRefreshService.ts:11-18`; `backend/src/scheduling/application/externalCalendarPorts.ts:7-14` | Approve bounded list/read provider contract, freshness/audit representation, source/destination reschedule algorithm, and fail-closed behavior. |
| Google OAuth callback/list-calendar workflow does not exist | `backend/src/integrations/`; `backend/src/routes/authorizedCompanies.ts` | Approve customer-owned OAuth configuration and callback security contract. |
| No worker invokes external operation recovery in production | `backend/src/composition.ts:314-330` | Approve worker lifecycle, lease owner, schedule and observability contract. |
| Binding uniqueness is connection-scoped; current generic connection uniqueness prevents ordinary duplicates but does not itself preserve a verified Google account subject | `backend/src/config/migrations.ts:1150-1158,1381-1387`; `ExternalCalendarBindingService.createBinding` | Approve P2 account-subject/calendar-ID verification and Company-scoped duplicate-binding rejection. |
| Current booking schema has no explicit version/actor/source/reason fields | `backend/src/scheduling/domain/scheduling.ts:14`; `migrations.ts:1255-1266` | Approve P1 migration boundary for stale writes and operational audit. |
| Normal assistant writes lack durable confirmation/idempotency and bypass router | `backend/src/assistant/services/operationalAssistantRuntime.ts:73-79`; `composition.ts:330` | Approve P3 channel-confirmation receipt contract. |
| Meta customer billing/review/LIVE access is external | `backend/src/whatsapp/providers/WhatsAppCloudApiProvider.ts` | Verify per customer; never infer from code or fixture. |

## Explicitly Out Of Scope

- Telephony integration, recording, IVR, or call transcription.
- Clinical records, diagnoses, health data, or medical workflow.
- Universal CRM fields, campaign tooling, analytics, ERP connectors, or sales automation.
- Shared-calendar multi-resource synchronization.
- Outlook, Apple Calendar, or unsupported provider claims.
- Global real-estate property tables.
- BSP, Atlas-financed WhatsApp messaging, shared credits, or silent out-of-window templates.
- Product redesign outside HOTFIX054-approved components and visual language.

## Review Gate

Stop after P0 approval. P1 may begin only after ADR-015 and this plan are approved together, including the P1 migration/audit boundary and the later P2 local-first synchronization redesign.
