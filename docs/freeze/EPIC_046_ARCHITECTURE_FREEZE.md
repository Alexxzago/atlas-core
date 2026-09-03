# EPIC 046 Billing Architecture Freeze

**Status:** Frozen for PASS1
**Scope:** Billing architecture only. This document authorizes no code, migration, API, frontend, provider account, dependency, or deployment change.

## 1. Ownership And Scope

- Billing is Workspace-scoped. A Workspace has one Billing Account.
- Company remains an operational unit within a Workspace. It must not own a subscription, provider customer, payment method, invoice, checkout, or payment evidence.
- All Billing operator APIs are Workspace-scoped. There are no Company Billing endpoints.
- Workspace billing does not alter Company ownership of assistants, channels, integrations, knowledge, conversations, Voice, or Proactive Actions.

## 2. Separation Of Authorities

Three authorities are distinct:

1. The payment provider is authoritative for external facts: customer, checkout acceptance, provider subscription, invoice/payment outcome, and provider-side cancellation.
2. Atlas durably stores normalized provider evidence and owns the Atlas effective subscription state.
3. The local Billing entitlement snapshot is the only authority consulted by runtime enforcement.

Assistant runtime, Company mutation, Voice, Proactive Actions, WhatsApp, Knowledge, and Channels must not call Stripe or another payment provider during an operational request. Provider outage must not make the operational runtime unavailable.

## 3. Provider Boundary

- Billing core is provider-neutral and must not import Stripe types.
- The future `BillingProvider` port is implemented first by a Stripe adapter.
- The Stripe adapter may use native HTTPS/fetch. An SDK requires a demonstrated technical blocker and separate approval.
- Stripe secrets exist only in deployment environment or secret injection. They must not be committed, persisted in Atlas, audited, or logged.
- Missing Stripe configuration produces an unavailable adapter, not a fallback provider.
- Billing tests use a deterministic provider fake. Tests must not call Stripe.

## 4. Local Catalog

Atlas owns a versioned local catalog. A catalog entry conceptually contains:

- stable plan key;
- immutable catalog version;
- safe display metadata;
- `month` or `year` billing interval;
- ISO-4217 currency;
- amount in integer minor units when it has a paid price;
- versioned entitlement definition;
- optional provider price mapping;
- `active` or `retired` lifecycle.

Prices, limits, trials, and grace rules must not be hardcoded in business logic. EPIC046 provides no public catalog administration API and assumes no commercial values. Production checkout may use only explicitly configured active catalog entries.

## 5. Existing Workspace Rollout

Every existing Workspace receives:

- a present Billing Account;
- effective subscription state `unmanaged`;
- no provider customer;
- no provider subscription; and
- an entitlement snapshot compatible with its current operational behavior.

Migration must not require Stripe data, reduce current limits, suspend a Workspace, or change visible behavior. Paid-plan enforcement activates only for Workspaces explicitly onboarded to managed Billing. Frontend alone cannot make a Workspace managed.

## 6. Commercial Controls Precedence

`commercial_controls` remains an administrative operational control. It is not financial subscription state.

- An administrative `suspended` status always restricts operations, even when Billing is enabled.
- Billing cannot remove an administrative suspension.
- For companies, assistant profiles, and active channels, the effective ceiling is the most restrictive non-null limit from Billing entitlement and administrative commercial control.
- `NULL` means that source supplies no ceiling.
- Administrative controls must not silently expand a commercial entitlement.
- Unmanaged Workspace snapshots preserve current commercial-control behavior.

The future entitlement bridge is the only place that combines these sources. Individual modules must not interpret subscription state or Stripe evidence.

## 7. MVP Entitlements

EPIC046 enforces only capabilities that already have operational enforcement:

- maximum companies;
- maximum assistant profiles;
- maximum active channels; and
- a global billing mutation-eligibility decision where required.

Voice, Proactive Actions, Knowledge, messages, conversations, tools, AI tokens, storage, and seats/operators receive no new Billing gate in this epic.

## 8. Usage Billing

Usage-based billing is out of scope. EPIC046 must not add UsageRecord/UsageBucket, token billing, message billing, Voice-second billing, Proactive billing, overages, credit balances, or billable usage calculations. Operational telemetry is not billing authority.

## 9. States

Provider evidence normalizes only to:

`checkout_pending | trialing | active | past_due | paused | canceled | unpaid | incomplete | incomplete_expired | unknown`

Atlas effective subscription states are:

`unmanaged | trial | active | canceling_at_period_end | grace | payment_required | paused | canceled | reconciliation_required`

Entitlement states are:

`enabled | grace_enabled | restricted | suspended | unavailable`

Provider strings are never domain states. `past_due` evidence does not directly gate runtime. Stale or ambiguous evidence must not degrade a newer confirmed entitlement; it requires reconciliation.

Provider `paused` evidence maps to effective `paused`, a restricted entitlement, and `mutationEligible=false`.

## 10. Trial, Grace, And Cancellation

- Trial is modelled only when catalog/configuration enables it. Its duration is not hardcoded, and `trial_ends_at` is durable.
- Local expiry/reconciliation evaluates trial end. Provider outage does not extend an already known expired trial indefinitely.
- Grace exists only when configured by a versioned policy/catalog rule. Its duration is not hardcoded.
- Provider outage alone preserves the last valid local entitlement until a known local expiry. Ambiguous evidence produces `reconciliation_required`.
- Customer cancellation is cancel-at-period-end only.
- `active` becomes `canceling_at_period_end` only after provider confirmation/evidence. Entitlements remain active through period end.
- Reactivation may be requested before cancellation becomes effective.
- A canceled subscription becomes active only through valid new provider evidence or a new subscription.
- An external provider/admin immediate cancellation can be normalized as evidence, but EPIC046 exposes no customer immediate-cancel endpoint.

## 11. Money

- Monetary amounts are integer minor units.
- Currency is explicit ISO-4217.
- JavaScript floating-point arithmetic is prohibited for money.
- Atlas does not convert currency or calculate tax.
- Company currency configuration does not determine Workspace Billing currency.

## 12. Durable Provider Operations

Checkout creation, cancel-at-period-end, and reactivation require a durable operation ledger with:

- operation ID;
- canonical request fingerprint;
- deterministic provider idempotency key;
- durable intent before provider I/O;
- durable request-start marker;
- CAS/version semantics;
- exact replay and divergent reuse conflict;
- uncertain and reconciliation outcomes.

An ambiguous outcome after request-start must not be retried with a new provider idempotency key. A retry for an idempotent operation reuses the same deterministic key. Durable provider evidence, including a webhook that arrives before the HTTP response, prevails over a contradictory late HTTP response.

Customer portal sessions are ephemeral navigation, not financial mutations. They do not require durable replay of a temporary URL, but require Workspace authorization, CSRF, Origin, and Fetch Metadata protection.

## 13. Webhooks And Ordering

The Stripe webhook route is outside browser-authorized routes and must:

- accept bounded raw bytes;
- verify the signature over exact bytes before JSON is trusted;
- deduplicate durably by provider event ID;
- persist only safe normalized metadata and a payload digest by default;
- avoid raw webhook-body persistence and logging;
- resolve Workspace only through local customer/subscription mappings;
- never trust provider metadata Workspace or Company IDs as tenant authority.

Duplicate valid events return `2xx` without reapplication. Invalid signatures or malformed payloads return `4xx`. A transient local failure before durable acceptance returns `5xx`. A valid event for an unknown provider object becomes safe ignored/reconciliation evidence and returns `2xx`.

Webhook order is not reliable. An isolated event timestamp cannot downgrade state. Use normalized object evidence/freshness when available; otherwise mark reconciliation. A stale webhook never degrades a newer confirmed entitlement.

## 14. Reconciliation

Reconciliation is a durable worker covering uncertain operations, unmatched or ambiguous provider events, `reconciliation_required`, local trial/grace expirations, and restart recovery.

Durable work requires database rows, lease owner/token, attempt count, next retry time, and safe failure category. A process scheduler may wake it but cannot be the authority. `setTimeout` is not durable scheduling.

## 15. Provider Mapping And Retention

- A Billing Account has at most one active provider-customer mapping per provider.
- Provider customer ID and provider subscription ID are unique per provider.
- One effective Atlas subscription exists per Billing Account; historical rows are retained when needed for state history.
- Dedicated invoice/payment evidence tables are not approved for the initial cut. Persist only normalized evidence necessary for subscription truth, payment transitions, reconciliation, and safe support.
- If Stripe correctness proves dedicated invoice/payment tables necessary, stop and request an architecture amendment before adding a migration.
- EPIC046 adds no Workspace deletion feature or automatic provider cancellation.
- Company deletion does not affect Workspace Billing.
- A managed Workspace with active, canceling, grace, payment-required, or reconciliation billing must not silently cascade-delete while external provider state exists. Deletion fails closed until a future deprovisioning/retention contract exists.
- An unmanaged Billing Account may follow existing teardown only when tests prove it safe.

## 16. Authorization And API Boundary

Use existing `workspace:manage` for every EPIC046 Billing read and mutation. No Billing permission family is introduced.

Workspace API surface:

- `GET /workspaces/:workspaceId/billing/summary`
- `GET /workspaces/:workspaceId/billing/entitlements`
- `POST /workspaces/:workspaceId/billing/checkout-sessions`
- `POST /workspaces/:workspaceId/billing/portal-sessions`
- `POST /workspaces/:workspaceId/billing/subscription/cancel`
- `POST /workspaces/:workspaceId/billing/subscription/reactivate`

Provider-facing API:

- `POST /webhooks/billing/stripe`

Excluded APIs include Company billing, immediate cancel, refunds, payment-method handling, public reconciliation/retry, invoice administration, manual provider settlement, and public plan administration.

Checkout selects only an active local catalog entry. Requests must not accept arbitrary provider price IDs, currency, amount, customer mappings, Workspace mappings, or redirect origins. Checkout URL creation alone never activates a local subscription.

## 17. Entitlement Boundary

`BillingEntitlementService` is the single service through which modules obtain typed entitlement decisions. Modules must not inspect subscription state, provider status, catalog price, or webhook data.

The service supplies the Billing base ceiling and combines it with the administrative commercial-control ceiling/status according to this freeze. Exact persistence representation belongs to PASS2.

## 18. Planned Migration Sequence

- `0066`: Billing Account and local catalog foundations.
- `0067`: Subscription, entitlement snapshot, existing-Workspace rollout, and commercial-control enforcement bridge.
- `0068`: Billing operations, provider events, and durable reconciliation work.

No `0069` is authorized. Dedicated invoice/payment evidence requires an approved amendment.

## 19. Planned PASS Sequence

1. PASS1: this Architecture Freeze only.
2. PASS2: persistence foundations, `0066`/`0067`, rollout, catalog, subscription, entitlements, and no provider I/O.
3. PASS3: BillingEntitlementService and existing-limit enforcement bridge with unmanaged compatibility.
4. PASS4: BillingProvider port, deterministic fake, Stripe HTTP adapter, and durable checkout/cancel/reactivate operations.
5. PASS5: `0068`, raw signed webhook, provider-event ledger, reconciliation worker, and recovery races.
6. PASS6: operator API, summary, entitlements, checkout, portal, cancellation, reactivation, authorization, and safe projections.
7. PASS7: full migration chain, recovery, privacy/security, rollout, full tests, typecheck, and release readiness.

No frontend work is authorized in EPIC046.

## 20. Explicitly Out Of Scope

- frontend Billing;
- Company subscriptions;
- usage billing and all AI/Voice/Proactive/message metering;
- tax, accounting, Argentine fiscal invoices, refunds, chargebacks, disputes, coupons, promotions, reseller billing, marketplace payouts, and split payments;
- payment-method, PAN, or CVC storage;
- multi-provider routing or currency conversion;
- public catalog administration;
- automated Workspace deletion/provider deprovisioning.

## 21. Architecture Invariants

- Workspace billing only.
- Provider-neutral core; Stripe is the first adapter.
- Provider evidence never becomes runtime authority.
- Local entitlement snapshot is enforcement authority.
- Existing Workspaces remain operational after migration.
- `commercial_controls` is administrative suspension/ceiling, not subscription state.
- No usage billing or frontend.
- All external financial mutations persist intent before I/O and reuse deterministic idempotency keys.
- Webhooks verify before trust, deduplicate durably, and cannot regress confirmed state blindly.
- Reconciliation is durable.
- No raw payment secrets, card data, or raw provider payload logging/persistence by default.
- Managed Billing cannot be silently destroyed by Workspace teardown.

## PASS4F4 Amendment

- Canonical provider GET evidence is applied only by durable reconciliation; webhook payloads remain hints.
- A current durable lease token, claim version, and wake generation are required when applying evidence.
- Subscription, entitlement projection, and reconciliation settlement are one SQLite transaction.
- Provider failed or uncertain reads preserve the current local entitlement and retry. Provider `not_found` applies normalized `unknown` / `reconciliation_required`, never `canceled`.
- A webhook received while work is leased increments its wake generation. The completing worker requeues rather than completing stale work, guaranteeing a successor canonical read.

## PASS4F5 Amendment

This amendment freezes the PASS6 operator-HTTP evidence required before PASS7. It authorizes tests only and changes no Billing behavior, schema, migration, provider contract, or API surface.

1. Every operator route in Section 16 SHALL require the existing authenticated `workspace:manage` decision for the route Workspace. Authentication, authorization, and cross-tenant failures SHALL be indistinguishable `404` responses. Billing routes SHALL set `Cache-Control: no-store, private` and `Pragma: no-cache` before dispatch.
2. `GET /workspaces/:workspaceId/billing/summary` SHALL expose only rollout mode and the safe subscription state/plan projection. `GET /workspaces/:workspaceId/billing/entitlements` SHALL expose only the entitlement projection. Neither response may disclose provider customer IDs, subscription IDs, operation IDs, idempotency keys, payer identity, provider evidence, raw payloads, or payment data.
3. Summary and entitlements SHALL faithfully project unmanaged, managed, paused/restricted, administrative-suspended, minimum-boundary, and zero-ceiling snapshots without changing entitlement authority or activating Billing. A checkout URL, portal URL, cancel/reactivate request, and an HTTP outcome alone SHALL NOT activate the local subscription or entitlement snapshot.
4. Browser-authorized POST routes SHALL require an exact JSON body, a valid Origin/Fetch-Metadata/CSRF decision, and, for durable checkout/cancel/reactivate mutations, a bounded printable `Idempotency-Key`. Invalid keys and divergent JSON bodies SHALL fail before provider dispatch. Exact replay SHALL reuse the durable operation; divergent reuse of the same key SHALL return conflict.
5. Checkout SHALL select only the trusted active catalog entry. Stripe checkout SHALL not require a payer identity. Mercado Pago checkout SHALL use only the selected active verified Workspace payer identity and SHALL reject a missing, stale, foreign, suspended, or unverified selection without fallback. Requests cannot supply provider prices, payer identity, money, customer mapping, Workspace mapping, or redirect targets.
6. Portal is an ephemeral safe navigation request: it SHALL require the browser and Workspace protections in clause 4, SHALL require a managed mapped customer and supported provider, and SHALL neither create a durable operation nor expose provider references. Cancel and reactivate SHALL use the durable subscription operation contract and SHALL reject an absent or ineligible local subscription without provider dispatch.
7. HTTP outcome mapping is fixed: `succeeded` is `200`; `conflict`, `invalid`, and `unsupported` are `409`; `in_progress` and `uncertain` are `202`; `failed` and `unavailable` are `503`; malformed HTTP input is `400`. Safe result bodies SHALL not reveal provider errors or operation internals.
8. `POST /webhooks/billing/stripe` and `POST /webhooks/billing/mercadopago` SHALL remain independent of browser session, CSRF, Origin, Fetch Metadata, and Workspace operator authorization. They SHALL accept only bounded raw JSON bytes and delegate signature verification over those exact bytes. A valid webhook may enqueue reconciliation evidence but SHALL NOT activate, cancel, or otherwise directly alter subscription or entitlement authority.
9. PASS4F5 tests SHALL be explicit diagnostic tests, not one combined scenario, covering each clause above. They SHALL use deterministic fakes only, assert provider-call counts and local authority before/after external HTTP outcomes, and assert safe response key sets where privacy is required.

## PASS4F6 Amendment

1. Process scheduling may only wake durable reconciliation work. The lifecycle runtime SHALL use bounded environment configuration, serialize local batches, and never become reconciliation authority.
2. Runtime `start` and `stop` SHALL be idempotent. Stop SHALL prevent future wake-ups and wait for an in-flight batch before normal database shutdown.
3. A reconciliation cycle failure SHALL be contained, safely reported without provider or webhook data, and leave later cycles available. Webhook acceptance remains independent from scheduler execution.
4. PASS4F6 tests SHALL cover configuration bounds, non-overlap, idempotent lifecycle and safe failure recovery, plus webhook acceptance through a paused reconciliation result and the operator HTTP projection.

## PASS4F7 Amendment

1. This amendment authorizes no schema, migration, provider-contract, frontend, administration, or cross-user identity-browsing change.
2. `GET /workspaces/:workspaceId/billing/catalog` SHALL require the existing authenticated `workspace:manage` decision and expose only active local entries as `id`, stable plan key, catalog version, display name, interval, currency, and integer minor-unit amount. It SHALL not expose retired entries, provider kind or price mappings, entitlement definitions, or administrative controls.
3. `GET /workspaces/:workspaceId/billing/payer-selection`, `PUT /workspaces/:workspaceId/billing/payer-selection`, and `DELETE /workspaces/:workspaceId/billing/payer-selection` SHALL require the same Workspace authorization and browser protections. The GET projection may disclose only whether the caller is selected.
4. PUT and DELETE SHALL require an exact body containing no version field. PUT selects only the authenticated session's exact verified, active Workspace identity. It accepts no identity ID, user ID, email, payer details, or cross-user selector. DELETE clears only a selection owned by that exact caller. Both return safe status only and never disclose payer identity or another user's selection.
5. Catalog discovery and payer selection do not activate Billing, mutate subscription or entitlement authority, invoke a provider, create a durable provider operation, or broaden checkout input. Mercado Pago checkout continues to require the selected verified caller-owned payer identity.
6. All PASS4F7 billing routes SHALL retain indistinguishable `404` authentication, authorization, and cross-tenant failure behavior plus `Cache-Control: no-store, private` and `Pragma: no-cache`. Focused tests SHALL cover retired catalog exclusion, caller-only payer selection/clear, malformed and stale requests before mutation, privacy-safe projections, and Mercado Pago catalog-to-payer-to-checkout E2E with no cross-user browsing.

## PASS4F7A Amendment

1. This amendment replaces the PASS4F7 payer-selection API only. It authorizes no schema, migration, provider-contract, frontend, administration, or cross-user identity-browsing change.
2. `GET /workspaces/:workspaceId/billing/payer-identity-options` SHALL require the existing authenticated `workspace:manage` decision and expose only the caller's own usable identities as `identityId` and email. A usable identity is owned by the caller's user, has verified bounded email fields, and has an active membership in the route Workspace. It SHALL not disclose another user's identity or the selected payer identity.
3. `PUT /workspaces/:workspaceId/billing/payer-identity` and `DELETE /workspaces/:workspaceId/billing/payer-identity` SHALL require the same Workspace authorization and browser protections. Each SHALL require the exact JSON body `{ "identityId": string }`. PUT may select only an identity returned by the caller's usable-identity options. DELETE may clear only the exact selected identity when it is owned by the caller. Both enforce Billing Account version compare-and-set server-side and return safe status only.
4. The removed `payer-selection` routes SHALL not remain registered. These routes retain indistinguishable `404` authentication, authorization, and cross-tenant failure behavior plus `Cache-Control: no-store, private` and `Pragma: no-cache`.
5. Identity options and payer-identity mutation do not activate Billing, mutate subscription or entitlement authority, invoke a provider, create a durable provider operation, or broaden checkout input. Mercado Pago checkout continues to require the selected verified active Workspace payer identity.
6. PASS4F7A tests SHALL explicitly cover removed routes, a caller's second usable identity, identity verification and membership lifecycle, cross-user isolation, malformed requests, strict `identityId` bodies, and Mercado Pago catalog-to-payer-to-checkout E2E.

## PASS4F7B Amendment

1. This amendment replaces the public payer-identity account-version contract only. It authorizes no schema, migration, provider-contract, frontend, administration, or cross-user identity-browsing change.
2. `GET /workspaces/:workspaceId/billing/payer-identity-options` SHALL expose only the caller's usable `identityId` and email options. It SHALL not expose a Billing Account version.
3. `PUT /workspaces/:workspaceId/billing/payer-identity` and `DELETE /workspaces/:workspaceId/billing/payer-identity` SHALL each require the exact JSON body `{ "identityId": string }`. Bodies containing a version field or any other field SHALL fail validation.
4. The application service SHALL load the Billing Account version internally and pass it once to the existing payer-identity compare-and-set service. It SHALL not retry a compare-and-set conflict. The existing safe status behavior and all authorization, browser-protection, ownership, verification, and membership requirements remain unchanged.
5. PASS4F7B tests SHALL cover strict rejection of the former account-version body and a deterministic version race that returns conflict without retrying the compare-and-set.

## Final Remediation A Amendment

1. Successful checkout creates a durable trusted checkout enrollment, not entitlement authority. The enrollment binds the Billing Account, trusted local catalog entry, and exact provider checkout object.
2. Verified Stripe `checkout.session.completed` binds the exact Checkout Session to exact Subscription and optional customer IDs. Mercado Pago's preapproval ID is both checkout and subscription ID and may schedule canonical reconciliation immediately. No provider metadata supplies Workspace authority.
3. Only canonical provider GET reconciliation may create and apply the first managed local subscription and entitlement. Webhook payloads never directly grant entitlement.
4. Provider idempotency keys are deterministically scoped by Billing Account, operation kind, and operation ID so equal operation IDs across Workspaces cannot collide at provider scope.
5. An applied migration checksum mismatch is fatal. The migration runner never rewrites applied migration history, checksums, or schema variants.
6. A provider `not_found` for an existing trusted local subscription applies `unknown` / `reconciliation_required`. A provider `not_found` for an unconsumed ready checkout enrollment creates no local subscription, leaves the enrollment ready, and retries durable reconciliation with normal bounded backoff.

## Final Remediation E Amendment

1. `uncertain` and stale `request_started` Billing operations are background-recoverable through `billing_operations`, which is the durable recovery queue and authority. Caller replay never redispatches an uncertain operation.
2. Stripe checkout recovery may replay only the exact persisted POST with its original provider idempotency key within 23 hours of request start. Stripe checkout uses an opaque Atlas `client_reference_id` only for exact verified webhook correlation.
3. Mercado Pago uncertain checkout never re-POSTs `/preapproval`. Its recovery is read-only and requires an exact opaque `external_reference` plus trusted local plan mapping.
4. Cancel/reactivate recovery uses the exact durable local subscription target and canonical provider evidence. Operation recovery never projects entitlement; normal reconciliation remains subscription authority.
