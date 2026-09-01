# EPIC 045 - Proactive Actions Architecture Freeze

**Status:** Frozen  
**Authority:** Implementation contract for EPIC 045 PASS 1  
**Base:** `v0.44.0-alpha`

## Product Scope

EPIC 045 adds one durable, operator-scheduled proactive assistant action. It does not add a second assistant runtime, a channel, a generic automation engine, or a new outbound pipeline.

Initial scope is exactly:

- One Company-owned `ProactiveAction` aggregate.
- WhatsApp only.
- An existing open WhatsApp-bound conversation is required.
- One-shot `runAt` execution only.
- One initial intent kind: `follow_up`.
- Existing `OperationalAssistantRuntime`, Conversation Intelligence, EPIC043 authority control, and WhatsApp outbound delivery are reused.
- Existing read-only tools may run under their normal capability and availability checks.
- Company-scoped proactive policy defaults to disabled.

The action is not a booking/scheduling record, a channel execution request, a provider event, an outbound delivery, or a generic rule. It owns future eligibility and action lifecycle; existing aggregates retain ownership of assistant execution, tools, conversation state, provider records, and delivery.

## Explicit Exclusions

EPIC 045 does not add:

- Templates or any message outside the WhatsApp customer-service window.
- Recurrence, cron, generic event/state rules, or a workflow builder.
- Campaigns, bulk broadcast, segmentation, or analytics dashboards.
- New conversations, a contact/recipient model, or arbitrary recipient addresses.
- Tool writes, sensitive writes, booking writes, user-approval inference, or generated idempotency keys for writes.
- Billing, non-essential production hardening, new channels, Voice STT/TTS, or frontend work.

## Durable Aggregate

`ProactiveAction` is a Company-owned aggregate with durable identity, Workspace and Company scope, one Conversation, one WhatsApp connection, one selected Assistant Profile, one assistant participant, one `runAt`, one authority-generation fence, lifecycle state, attempts, lease data, and immutable command/audit evidence.

It requires an existing WhatsApp conversation binding. This preserves the existing recipient authority, per-conversation outbound ordering, Conversation Intelligence scope, and EPIC043 authority model. EPIC045 never creates a conversation or stores a phone number, recipient address, provider credential, provider token, or arbitrary provider payload.

## Intent Contract

The selected persistence shape is a closed `intent_kind` column. EPIC045 does **not** persist `intent_json`.

The only permitted value is:

```text
follow_up
```

There is no prompt, instruction, arbitrary text, tool argument, hidden command payload, recipient override, or provider payload in a proactive action. The runtime derives bounded context from the existing conversation history, current Conversation Intelligence state, published knowledge, retrieval context, and permitted read-tool outputs.

The application extends the existing immutable assistant execution contract with an explicit proactive execution purpose and a code-owned `follow_up` interaction. Providers translate that approved contract; they do not receive action persistence objects, tenant authority, credentials, or free-form scheduled instructions.

## WhatsApp Customer-Service Window

EPIC045 initial outbound contract permits only free-form WhatsApp text inside the customer-service window.

- The window is `[last real customer inbound timestamp, last real customer inbound timestamp + 24 hours)`.
- The timestamp is derived from the latest durable inbound `conversation_message` sent by the WhatsApp customer participant for the same WhatsApp conversation binding.
- Assistant, operator, outbound, synthetic, replay-only, and scheduled messages never extend or reopen the window.
- EPIC045 never fabricates an inbound message to reopen it.
- There is no template fallback and no provider call when the window is closed.
- A real later customer inbound message updates the durable basis; it may extend/reopen eligibility for an action that has not yet become terminal.

The service window is revalidated at all four fences:

1. Action creation.
2. Start of leased execution.
3. Transactional outbound materialization after a long runtime.
4. Immediately before external send.

Creation is deterministic. If `runAt` is at or after the close time calculated from the latest currently durable real customer inbound, creation is rejected with the safe domain conflict `whatsapp_service_window_closed`. Atlas does not accept an action already known to be impossible under the free-form-only contract.

If the action was valid at creation but execution or dispatch occurs after the window closes, it becomes terminal `suppressed` with safe reason `whatsapp_service_window_closed`. It creates no provider call, proactive visibility record, or Conversation Intelligence application.

## Assistant Assignment And Binding Fence

The action persists the selected `assistant_profile_id` at creation. Before execution and before outbound materialization, the active WhatsApp connection must still reference that exact profile.

- If the connection is reassigned to a different profile, the old action is terminally `suppressed` with safe reason `assistant_assignment_changed`.
- The action must not execute with the old profile.
- The action must not silently switch to the new profile.
- A new explicitly created action may use the new assignment.

The same checks revalidate Conversation ownership, open state, WhatsApp connection ownership and active state, conversation binding ownership, customer and assistant participant ownership, and that the persisted assistant participant remains the binding's assistant participant.

## State Machine

```text
scheduled -> ready | cancelled | suppressed
ready -> leased | cancelled | suppressed
leased -> retryable | awaiting_outbound | cancelled | suppressed | permanent_failure
retryable -> ready | cancelled | suppressed | permanent_failure
awaiting_outbound -> succeeded | cancelled | suppressed | permanent_failure | uncertain

succeeded | cancelled | suppressed | permanent_failure | uncertain -> terminal
```

- `scheduled`: accepted action whose `runAt` is not yet due.
- `ready`: due, durable, eligible queue state awaiting worker claim.
- `leased`: one worker owns runtime execution through a lease token and expiry.
- `retryable`: pre-materialization transient runtime/read-tool failure, with bounded retry/backoff.
- `awaiting_outbound`: exactly one outbound message and one outbound delivery reservation have been materialized; runtime never executes again for this action.
- `succeeded`: the provider accepted the external send. It does not mean delivered or read.
- `cancelled`: an authorized cancellation succeeded before external send-start.
- `suppressed`: a terminal safety outcome, including authority loss, service-window closure, assignment change, closed conversation, unavailable connection, disabled policy, or ineligible profile.
- `permanent_failure`: pre-send terminal runtime/read-tool failure or delivery permanent failure.
- `uncertain`: only after durable send-start when external outcome cannot be proven. It is terminal, conservatively not auto-resent, and has no semantic visibility.

Release of authority, a later real inbound, profile reassignment reversal, policy re-enable, or connection recovery never reactivates a terminal suppressed action. An operator creates a new action instead.

`ready` is deliberately durable. It separates time eligibility from a worker lease, makes due-but-unclaimed work observable and cancellable, and permits recovery without treating a stale lease as a new scheduling decision. The worker promotes due `scheduled` records to `ready` transactionally, then claims only `ready` or expired `leased` work. EPIC045 does not claim directly from `scheduled`.

## Authority And Cancellation Boundary

EPIC043 remains the authority source. The action snapshots `expected_authority_generation` at creation and requires an open conversation in `automated` state with equal generation:

1. At creation.
2. Before runtime execution.
3. During transactional response materialization.
4. Immediately before external send through the existing delivery authority fence.

Cancellation rules:

- Before materialization, an authorized operator may cancel an action if no external commitment exists.
- During `awaiting_outbound`, but before durable `send_started_at`, cancellation is one repository-owned transaction: action becomes `cancelled`, the same reserved delivery becomes terminal existing-vocabulary `suppressed`, its lease is cleared, and ordering is released. No second delivery is created.
- After durable send-start, cancellation returns a safe conflict/no-op outcome. Evidence is never deleted.
- If provider acceptance arrives after send-start, acceptance prevails: delivery is `accepted`, action is `succeeded`, and visibility is created atomically.
- If the post-send outcome is ambiguous, action and delivery are `uncertain`.

## Runtime And Tool Contract

The action enters the existing `OperationalAssistantRuntime`; no fake inbound message and no second runtime are introduced.

The runtime loads the current published knowledge, bounded conversation history, current Conversation Intelligence state, retrieval context, and safe attachments. It records the normal assistant execution evidence with proactive purpose and the action's conversation/channel/authority snapshot.

Tools are limited to `read` operation class:

- Capability assignment and dynamic tool availability are checked by the existing orchestrator.
- `write` and `sensitive_write` definitions are denied for proactive execution.
- No idempotency key is invented.
- A scheduled action is never user approval.
- Tool traces remain evidence and audit records, not replay/result ledgers.
- A read-tool timeout or retryable pre-materialization failure may use the bounded action retry policy.
- After outbound materialization, runtime never executes again.

## Worker, Lease, Retry, And Recovery

EPIC036 booking/scheduling domain is not a generic job scheduler and is not reused for proactive actions. EPIC045 reuses only established durable-operation patterns:

- Durable `run_at`.
- SQLite `BEGIN IMMEDIATE` claim/compare-and-set discipline.
- Lease owner, token, acquired time, and expiry.
- Bounded exponential retry/backoff.
- Expired-lease recovery.
- Existing bootstrap polling cadence, if retained, as a trigger only.

No `setTimeout` or process-local timer is a source of truth.

Crash handling:

- Before response materialization: expired lease recovery may retry subject to bounds.
- After materialization: state is `awaiting_outbound`; runtime is not rerun.
- After send-start: existing outbound recovery resolves to acceptance where evidence exists or marks `uncertain`; it never blindly resends.
- Recovery rechecks policy, service window, assignment, binding, and authority before any still-uncommitted work.

## Outbound Ordering And Acceptance Boundary

EPIC045 reuses only `outbound_deliveries.rowid` for per-conversation ordering. It introduces no second queue.

- Proactive A before standard B: A blocks B while A is unresolved according to existing delivery ordering (`pending`, `leased`, `retryable`, and the action's reserved pre-send state).
- A `cancelled` action uses delivery `suppressed`; it releases B.
- A `suppressed`, `permanent_failure`, or `accepted` delivery releases B under existing ordering behavior.
- `uncertain` retains the existing unresolved ordering contract; EPIC045 adds no bypass.

Provider acceptance for a proactive delivery is one repository-owned transaction. It must atomically persist all of the following:

1. External provider message ID on the existing provider message record.
2. Outbound delivery state `accepted` and cleared lease.
3. Proactive action state `succeeded`.
4. Exactly one `proactive_action_visibility` record with `kind='externally_committed'`.

There must be no stable state with accepted delivery but awaiting action, accepted delivery without visibility, or visibility without provider acceptance.

The transaction contains no provider call. Semantic recovery runs after commit.

Delivery callbacks for `delivered` and `read` update only the existing delivery lifecycle. They do not change proactive `succeeded`, create another visibility record, or reapply Conversation Intelligence. Existing callback replay and monotonic ordering rules remain authoritative.

## Conversation Intelligence Semantics

Proactive generated output is not visible to Conversation Intelligence when it is generated, materialized, pending, leased, retryable, suppressed, permanently failed, or uncertain.

After the atomic acceptance/visibility transaction commits, proactive semantic recovery may apply the materialized assistant message. The existing Conversation Intelligence applied-message ledger guarantees exactly once.

If the process crashes after acceptance and visibility but before semantic recovery, restart recovery applies the message exactly once. No semantic result is applied when the service window closes before send or when no external commitment can be proven.

## Company Policy

One Company-scoped proactive policy is frozen:

```text
enabled: boolean, default false
version: positive integer
```

- Reads require `company:read`.
- Mutations require `company:manage`.
- Mutations use `expectedVersion`, stable `operationId`, canonical request fingerprint, durable replay, and optimistic CAS.
- Existing authenticated router conventions apply: CSRF, exact Origin, Fetch Metadata, `Cache-Control: no-store, private`, `Pragma: no-cache`, and generic `404` for authentication, authorization, session, origin, CSRF, or scope failure.

Quiet hours, frequency caps, per-assistant policy, and channel-specific policy are not part of EPIC045.

## Persistence Schema Freeze

PASS2 will add only these new tables:

```text
proactive_action_policies
proactive_actions
proactive_action_operations
proactive_action_audit_events
proactive_action_visibility
```

It will make one controlled change to:

```text
outbound_deliveries
```

### `proactive_action_policies`

One row per Company: `workspace_id`, `company_id`, `enabled`, positive `version`, `created_at`, `updated_at`.

- Primary key is `company_id`.
- Composite Company ownership is validated using `(workspace_id, company_id)`.
- Default is disabled.

### `proactive_actions`

Required fields:

```text
id
workspace_id, company_id
conversation_id
whatsapp_connection_id
assistant_profile_id
assistant_participant_id
intent_kind = follow_up
run_at
state
expected_authority_generation
attempt_count, next_attempt_at
lease_owner, lease_token, lease_acquired_at, lease_expires_at
safe_reason_code
assistant_execution_record_id nullable
outbound_message_id nullable
outbound_delivery_id nullable
version
completed_at, cancelled_at
created_at, updated_at
```

Requirements:

- No `intent_json`, prompt, arbitrary text, provider ID, phone number, recipient address, credential, or provider response.
- Composite Company FK plus scoped ownership triggers/FKs for Conversation, connection, profile, participant, message, execution record, and delivery.
- State and lease-shape checks; positive version and authority generation; non-negative attempts.
- `UNIQUE(outbound_message_id)` and `UNIQUE(outbound_delivery_id)`.
- Due index `(state, run_at, next_attempt_at, id)`.
- Lease recovery index `(state, lease_expires_at, id)`.
- Conversation read index `(workspace_id, company_id, conversation_id, run_at DESC)`.
- Materialized message/delivery and execution evidence are `ON DELETE RESTRICT`.

### `proactive_action_operations`

Durable replay ledger for `create` and `cancel` commands:

```text
id
workspace_id, company_id
proactive_action_id
operation = create | cancel
operation_id
request_fingerprint
outcome
actor_user_id
created_at
```

- `UNIQUE(workspace_id, company_id, operation, operation_id)`.
- Divergent reuse is conflict.
- Append-only update/delete rejection triggers.

### `proactive_action_audit_events`

Append-only, redacted audit evidence for lifecycle events such as create, claim, retry, suppression, cancellation, outbound reservation, acceptance, uncertainty, and completion.

It stores only scoped IDs, safe event/reason codes, optional actor/execution/tool-trace/delivery references, correlation ID, and timestamp. It contains no message content, prompt, recipient identity, provider body, token, credential, or secret.

### `proactive_action_visibility`

One append-only visibility row per proactive action, created only by the acceptance transaction:

```text
proactive_action_id unique
workspace_id, company_id
conversation_id
conversation_message_id
outbound_delivery_id
kind = externally_committed
committed_at, created_at
```

Scoped links must match the action and its delivery. No backfill is permitted.

### `outbound_deliveries` Linkage

`outbound_deliveries` gains nullable `proactive_action_id`.

- One proactive action has at most one outbound delivery.
- One proactive delivery belongs to exactly one action.
- Triggers validate matching scope, conversation, WhatsApp connection, and expected authority generation.
- Existing rows remain non-proactive.
- The migration must preserve existing `outbound_deliveries.rowid`, indexes, lifecycle triggers, foreign keys, and ordering behavior.

## PASS4 Architecture Amendment — Durable Proactive Runtime Result

### Root Cause And Authority

PASS4 is blocked by the current runtime boundary, not by a missing retry mechanism. `assistant_execution_records.result` durably stores a completed answer, but the persisted purpose currently permits only `preview` and `operational_execution`. The existing inbound recovery path deduplicates only after an outbound message exists; a crash after execution completion and before outbound materialization can otherwise invoke the model again.

This amendment is authoritative for PASS4B and later PASS4 implementation. It approves one minimal forward migration and does not permit editing historical migrations.

### Approved Purpose

The durable purpose vocabulary becomes:

```text
preview | operational_execution | proactive_execution
```

`proactive_execution` is distinct execution evidence. It must not reuse `operational_execution`, fabricate an inbound message, or change standard operational behavior. It is visible in execution evidence and safe proactive audit metadata.

Its immutable execution snapshot must use a new closed snapshot version and include only the existing scoped execution fields plus `proactiveActionId`. It contains no prompt, arbitrary instruction, recipient, credential, provider payload, or copied model result.

### Chosen Result Source And Ownership

The sole durable chosen-result source is `assistant_execution_records.result` from an `answered` or `safe_fallback` record with `purpose='proactive_execution'`. `proactive_actions` never stores a second copy of model text.

`proactive_actions.assistant_execution_record_id` remains the sole source of truth for selection. It is not legacy or advisory. PASS4B must add a partial unique index on that non-NULL column; one execution record can therefore be selected by at most one action and one action can select at most one execution record.

PASS4B must replace/strengthen the existing proactive-action execution scope triggers so a non-NULL selected record is accepted only when all of the following are true:

- action and record have the same Company and Workspace, derived through the Company ownership already present in the schema;
- record `purpose` is `proactive_execution`;
- record state is `answered` or `safe_fallback` and has a non-NULL durable result;
- record assistant profile equals the action snapshot profile;
- record immutable snapshot has the action conversation, WhatsApp connection, expected authority generation, and exact `proactiveActionId` equal to the action ID;
- no outbound message or delivery is required merely to select the result.

The action-to-record FK plus the partial unique index plus these scope triggers form the bidirectional identity proof: the action names exactly one record, and the record's immutable correlation names exactly that action. No new reverse column and no bridge table are approved. This avoids duplicate sources of truth while allowing one repository-owned transaction to select the result atomically.

### State Machine Amendment

The prior state machine cannot safely represent a chosen result without retaining a lease forever or exposing the action as `ready` for another inference. A single explicit pre-materialization state is approved:

```text
leased -> runtime_completed | retryable | cancelled | suppressed | permanent_failure
runtime_completed -> awaiting_outbound | cancelled | suppressed | permanent_failure
```

`runtime_completed` means exactly one chosen execution record is linked, its durable `result` is the only future PASS5 materialization source, no outbound exists yet, and the runtime lease has been cleared. It is not claimable for inference, is not retryable, and is not terminal only because PASS5 must still materialize/send or safely settle it. It requires a non-NULL `assistant_execution_record_id` and NULL outbound message/delivery IDs. Existing terminal-state rules remain unchanged.

Cancellation remains permitted before materialization from `runtime_completed`; it must never delete the selected execution evidence. PASS5 alone advances a selected result to `awaiting_outbound` after one outbound reservation is atomically materialized.

### Atomic Runtime Selection And Fences

After a model attempt completes, PASS4 performs one repository-owned transaction that:

1. verifies the action is `leased` with the matching owner/token and unexpired or durably renewed lease;
2. rechecks open conversation, automated authority, exact authority generation, active matching connection/profile, binding/participant ownership, and the real WhatsApp service window;
3. verifies the completed execution record against the ownership contract above;
4. updates the action once to `runtime_completed`, links the record, clears the lease, and appends only safe runtime-completed audit metadata.

Any failed fence selects nothing. The action is suppressed for domain safety fences, retryable only for a genuinely transient pre-selection runtime/read-tool failure, or permanently failed for safe non-retryable runtime failure. A selected result cannot be replaced, and the model must never be reinvoked automatically for that action.

### Crash And Recovery Semantics

1. Before an execution result is durable: bounded retry is allowed.
2. Execution record durable but selection transaction uncommitted: retry may perform another inference. This is accepted at-least-once inference because there is no customer-visible effect and no write tool.
3. Selection transaction committed: restart finds `runtime_completed`, reuses the linked record/result, makes no model call, and leaves materialization for PASS5. No second chosen result is possible.

### Purpose-Aware Read-Only Tool Exposure

For `proactive_execution`, tool declarations passed to the model must be filtered before the provider model call to only definitions explicitly classified `read`. `write`, `sensitive_write`, unknown, and unclassified tools are absent, fail closed, and receive no invented idempotency key or approval. The orchestrator's existing capability, availability, schema, timeout, redaction, and trace checks remain a second defense.

`operational_execution` and preview tool behavior are unchanged.

### Approved Future Migration 0064 Scope

PASS4B may create exactly `0064_proactive_runtime_boundary`. It may only:

- rebuild `assistant_execution_records` with its existing IDs, rows, columns, defaults, indexes, and references preserved while expanding the purpose CHECK for `proactive_execution`;
- rebuild `proactive_actions` only as necessary to add `runtime_completed` and its selected-result shape CHECK;
- add the partial unique selected-execution index and the strict scoped triggers required by this amendment;
- preserve Company teardown, foreign keys, upgrade/restart behavior, and all historical preview and operational execution evidence.

It may not add outbound changes, HTTP, visibility, tool tables, generic scheduling, templates, frontend, or a copied model-output column.

PASS4B migration verification must prove fresh install, `0063 -> 0064` upgrade, restart, execution-record ID preservation, existing preview/operational records unchanged, indexes/triggers/defaults retained, valid foreign keys, and Company teardown compatibility. If the table rebuild depends on `rowid` or an AUTOINCREMENT high-watermark, it must preserve them explicitly.

### Required PASS4B/PASS4 Tests

- Existing `preview` and `operational_execution` records remain accepted; proactive is accepted; unknown purpose is rejected.
- A valid same-action proactive record selects once; a second record for that action and the same record for another action are rejected.
- Preview, operational, foreign Company/Workspace, wrong conversation, wrong profile, wrong authority, wrong correlation, and non-successful records cannot be selected.
- Two SQLite completed-record races select exactly one; authority change or stale lease before selection selects none.
- A selected result survives restart and the runtime worker makes no provider model call for it.
- Proactive model declarations contain read tools only; write/sensitive-write declarations are absent; operational declarations remain unchanged.
- No fake inbound, outbound, visibility, or Conversation Intelligence application occurs before PASS5.

### Final Recommendation

**GO FOR PASS4B.**

PASS4 remains blocked until the approved forward migration establishes this durable purpose and chosen-result boundary.

## HTTP Contract Freeze

Protected routes are:

```text
GET /workspaces/:workspaceId/companies/:companyId/proactive-action-policy
PUT /workspaces/:workspaceId/companies/:companyId/proactive-action-policy
POST /workspaces/:workspaceId/companies/:companyId/conversations/:conversationId/proactive-actions
GET /workspaces/:workspaceId/companies/:companyId/proactive-actions
GET /workspaces/:workspaceId/companies/:companyId/proactive-actions/:actionId
POST /workspaces/:workspaceId/companies/:companyId/proactive-actions/:actionId/cancel
```

Policy PUT body is exact:

```json
{
  "expectedVersion": 1,
  "operationId": "proactive-policy-operation-id",
  "enabled": true
}
```

Create body is exact:

```json
{
  "operationId": "proactive-action-operation-id",
  "runAt": "2026-08-28T15:00:00.000Z",
  "intentKind": "follow_up"
}
```

Cancel body is exact:

```json
{
  "expectedVersion": 1,
  "operationId": "proactive-action-cancel-operation-id"
}
```

| Condition | Status | Response convention |
|---|---:|---|
| Policy/action read | 200 | Safe projection. |
| Policy update applied | 200 | Stored policy projection. |
| Create applied | 201 | Stored safe action projection. |
| Cancel applied | 200 | Stored safe action projection. |
| Matching replay | Original status | Original stored safe projection/outcome. |
| Stale version, divergent operation reuse, cancellation after send-start | 409 | Safe conflict outcome. |
| Disabled policy | 409 | `proactive_actions_disabled` safe conflict. |
| Known closed service window at `runAt` | 409 | `whatsapp_service_window_closed` safe conflict. |
| Invalid body, unknown field, invalid identifier/version/timestamp/intent | 400 | Existing validation convention. |
| Oversized JSON | 413 | Existing `knowledge_input_too_large` envelope. |
| Missing/foreign resource, invalid session/membership/permission/origin/Fetch Metadata/CSRF | 404 | Existing generic resource-not-found envelope. |

There is no manual retry endpoint.

## Test Matrix Freeze

PASS2+ must include at least:

### Service Window

- Create clearly outside the currently known window is rejected.
- Create inside the window is accepted.
- Worker delay past expiry suppresses the action.
- Latest real customer inbound extends/reopens an otherwise eligible pending action.
- Assistant, operator, and outbound messages do not extend the window.
- Closed window causes no provider call, visibility, or Intelligence application.

### Assignment And Scope

- Action created under profile A, then connection reassigned to B, is suppressed.
- The stale action runs with neither A nor B.
- A new explicit action can be created under B.
- Conversation, binding, participant, connection, profile, Company, and Workspace cross-scope cases are rejected without disclosure.

### Worker And State

- Fresh and upgrade migration.
- Restart and expired lease recovery.
- Two SQLite connections competing for one due claim.
- Bounded retry/backoff and terminal failure.
- No runtime re-entry after materialization.
- Terminal suppression never reactivates.

### Authority And Cancellation

- Cancellation before claim and during lease.
- Cancellation after reservation but before send-start atomically suppresses the same delivery and frees ordering.
- Cancellation after send-start conflicts safely.
- Concurrent cancellation/send-start with two SQLite connections.
- Takeover before runtime, during runtime, before send, and after send-start.

### Acceptance, Ordering, And Intelligence

- Proactive A before standard B preserves existing `rowid` ordering.
- Resolved A releases B; uncertain A follows existing blocking behavior.
- Acceptance transaction atomically writes external ID, accepted delivery, succeeded action, and exactly one visibility row.
- Crash windows around acceptance settlement cannot leave partial committed state.
- Crash after acceptance/visibility and before recovery applies CI exactly once.
- Delivered/read callbacks do not alter proactive success or repeat visibility/CI.
- Suppressed, failed, and uncertain actions never gain semantic visibility.

### Runtime And Tools

- Existing runtime consumes current knowledge, history, CI, retrieval, and safe attachments without fake inbound.
- Read capabilities and availability are rechecked.
- Missing capability, unavailable tool, timeout, retryable failure, and permanent failure are safe.
- Write and sensitive-write tools are denied.
- Existing inbound, booking, Conversation Intelligence, authority, outbound, WhatsApp, and Voice regressions remain unchanged.

## PASS2+ Sequence

1. **PASS2 - Persistence and policy:** migration, domain contracts, scoped repositories, policy replay/CAS, append-only audit, action lifecycle and outbound linkage integrity.
2. **PASS3 - Due worker and recovery:** durable scheduled-to-ready promotion, claims, leases, retry/recovery, cancellation before materialization, bootstrap polling integration.
3. **PASS4 - Runtime and read-only tools:** proactive execution purpose, explicit follow-up input, runtime fences, profile/binding/window revalidation, no-write tool gate.
4. **PASS5 - Outbound and semantic commitment:** atomic message/delivery reservation, authority/window send fence, atomic acceptance/visibility, proactive semantic recovery, ordering/callback coverage.
5. **PASS6 - Operator HTTP surface:** policy and action endpoints, safe projections, replay/CAS/scope/security coverage.
6. **PASS7 - Recovery and regression closure:** migration upgrade, crash windows, two-connection races, full suite/discovery/typecheck.

## Boundaries

- Controllers translate HTTP only.
- Services own policy, scheduling, eligibility, authority, and workflow rules.
- Repositories are the only SQLite boundary and own all transactions.
- Provider calls occur outside database transactions.
- WhatsApp outbound calls occur only through the existing delivery pipeline.
- Provider adapters never receive tenant authority, credentials from action payloads, or free-form scheduled prompts.
- PASS1 introduces documentation only: no product code, test code, migration, frontend, or Git action.

## Final Recommendation

**GO**

PASS2 may proceed only within this frozen contract.
