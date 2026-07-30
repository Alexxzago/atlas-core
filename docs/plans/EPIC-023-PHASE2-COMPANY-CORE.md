# EPIC-023 - Company Core

**Phase:** 2 - Engineering Implementation Plan  
**Status:** Planned. No implementation is included in this document.  
**Architecture authority:** [Company Domain](../architecture/COMPANY-DOMAIN.md), ADR-002, ADR-004, ADR-005, and ADR-010.

## Executive Summary

Phase 2 implements only the Company Management bounded context: the Company aggregate, its generic identity/branding/configuration, administrative lifecycle, workspace-scoped persistence, authorized API, and Company domain events. It does not implement any dependent domain or calculate operational readiness from integrations.

The existing `companies` record and its `processing | ready | failed` status remain a legacy onboarding/result compatibility projection. Phase 2 adds the frozen Company lifecycle alongside it and must never map legacy `ready` directly to `operational`.

## Architecture Overview

```text
Authorized route
  -> controller (HTTP validation and response mapping)
  -> Company application service / use case
  -> Company aggregate and value objects
  -> CompanyRepository port
  -> SQLite repository and persistence mapper

Workspace authorization -> trusted WorkspaceContext -> Company ownership lookup
```

Workspace authorization determines whether an actor may issue a Company command. The Company aggregate validates state and invariants. Application services orchestrate use cases, persistence, event recording, and compatible response mapping. Controllers do not contain lifecycle policy, persistence, or authorization decisions.

## Implementation Strategy

1. Introduce Company-domain types and value objects without changing dependent contexts.
2. Replace mutable field-bag updates with aggregate commands for identity, branding, configuration, and lifecycle transitions.
3. Extend the repository port and SQLite mapper behind workspace-scoped access.
4. Add the lifecycle schema through an additive, resumable migration while preserving legacy onboarding status.
5. Add authorized HTTP endpoints and compatible read responses.
6. Record Company domain events as durable audit facts without event transport, webhooks, or event sourcing.
7. Validate all invariant, lifecycle, repository, migration, authorization, and HTTP behavior before changing consumers.

No Channels, Knowledge, Assistant, Conversations, Dashboard, Analytics, Automations, Integrations, or frontend code belongs to this phase.

## Aggregate Design

### Company aggregate root

The aggregate is identified by globally unique `CompanyId` and belongs to exactly one `WorkspaceId`. It owns:

- Identity: name, slug, description, website.
- Branding: public name, logo/brand asset references, approved color tokens.
- Operating configuration: timezone, locale, country, currency, date/phone formats, business hours.
- Lifecycle: `draft | configured | operational | attention_required | suspended | archived`.
- Audit/version metadata required for safe updates.

The aggregate does not load, mutate, or calculate state for Channels, Knowledge, Assistant Profiles, Conversations, Analytics, Automations, or Integrations.

### Commands and invariants

| Use case | Aggregate rule |
|---|---|
| `CreateCompany` | Creates a Company in `draft`; requires valid identity and workspace-scoped unique slug. |
| `UpdateCompanyIdentity` | Validates identity value objects; archived Companies reject mutation. Slug changes require explicit request and emit an identity update event. |
| `UpdateBranding` | Validates `Branding`; no binary asset upload or asset processing in this phase. |
| `UpdateConfiguration` | Validates operating locale and hours atomically. Reassesses whether mandatory Company configuration is complete. |
| `ActivateCompany` | Requires an `eligible` readiness assessment under a named policy version. Phase 2 has no dependency evidence provider, so it cannot activate a Company. |
| `EvaluateCompanyReadiness` | Defines the application boundary and records an `indeterminate` assessment when required evidence is unavailable. It performs no Channel, Knowledge, Assistant, or integration reads. |
| `SuspendCompany` | Permitted from `draft`, `configured`, `operational`, or `attention_required`; no child aggregate mutation. |
| `RestoreCompany` | Restores a suspended Company deterministically to `configured` when mandatory Company-core configuration is complete; otherwise restoration is rejected and the Company remains suspended. It never restores directly to `operational` or `attention_required` in Phase 2. |
| `ArchiveCompany` | Permitted from any non-archived state; preserves dependent data and history; further mutation is rejected. |
| `ListCompanies` / `GetCompany` | Read only through trusted workspace context; hidden cross-workspace resources behave as not found. |

Phase 2 may transition `draft -> configured` when all mandatory Company-core configuration is valid. It must not transition to `operational` or `attention_required` without an authoritative, future dependency-evidence implementation. Restoration preserves the pre-suspension lifecycle state in audit history but always resumes as `configured`; a later dependent-context assessment alone may promote or mark attention.

## Value Objects

| Value object | Phase 2 validation and persistence decision |
|---|---|
| `CompanyId` | Opaque numeric identifier mapped from the existing primary key; never accepted as authorization. |
| `CompanyName` | Trimmed, bounded non-empty display name with deterministic normalized comparison form. The normalized name is unique within its Workspace; duplicate names are rejected rather than silently renamed. |
| `CompanySlug` | Lowercase URL-safe normalized value; unique within Workspace through a database constraint. Explicit changes only. |
| `CompanyDescription` | Optional trimmed bounded plain text; never assistant instructions. |
| `WebsiteUrl` | Normalized absolute HTTP(S) URL. Existing workspace-scoped website uniqueness remains unless separately revised. |
| `CompanyTimezone` | Required valid IANA timezone. |
| `CompanyLocale` | Required supported Company business locale, separate from portal locale and assistant language. |
| `Branding` | Optional public name, logo asset reference, and bounded semantic color token values. No external fetch, binary asset, or provider behavior. |
| `OperatingLocale` | Required ISO country and currency codes plus validated date and phone format identifiers. |
| `BusinessHours` | Required structured weekly schedule and optional exceptions stored as validated canonical JSON. It does not establish Channel availability. |

Mandatory configuration for `configured` is: valid timezone, Company locale, operating locale, and business hours, in addition to valid identity. Branding remains optional.

## Application Services

Create a focused `CompanyApplicationService` or equivalent use-case module behind the existing service boundary. It receives `WorkspaceContext`, authorized actor metadata where audit attribution is available, command input, repository ports, clock, and event recorder.

Use cases:

- `CreateCompany`
- `UpdateCompanyIdentity`
- `UpdateBranding`
- `UpdateConfiguration`
- `SuspendCompany`
- `RestoreCompany`
- `ArchiveCompany`
- `ActivateCompany`
- `EvaluateCompanyReadiness`
- `ListCompanies`
- `GetCompany`

`ActivateCompany` and `EvaluateCompanyReadiness` are deliberately constrained in Phase 2. The readiness policy contract is implemented as an internal Company Core boundary, but no dependent-context evidence adapters, product thresholds, scheduled evaluation, Dashboard projection, or public readiness endpoint is introduced. Required evidence unavailable in Phase 2 yields an ephemeral `indeterminate` result, no lifecycle promotion, no event, and no persisted assessment record.

## Repository Design

### Port

Replace the current field-oriented `CompanyRepositoryPort` with aggregate-oriented operations, all requiring `WorkspaceContext`:

- `findById(context, companyId)`
- `findBySlug(context, slug)`
- `findByWebsite(context, website)`
- `list(context, filters, page)`
- `createWithEvents(context, company, events)`
- `saveWithEvents(context, company, expectedVersion, events)`

`createWithEvents` and `saveWithEvents` execute the aggregate write and its complete event set in one repository-owned SQLite transaction. `saveWithEvents` enforces optimistic concurrency through a persisted aggregate version and returns a conflict outcome rather than overwriting a concurrent Company update. A failed event insert rolls back the Company write; a failed Company write records no event. No repository method accepts an unscoped Company ID, bypasses Workspace filtering, or performs dependent-domain reads.

### Persistence mapper

The SQLite repository maps rows to validated Company-domain values and back. Validation and lifecycle transition logic remain in the domain/application layer; SQL maps data and enforces structural constraints only. List and get queries select by `workspace_id` and `id` or `slug` together so cross-workspace existence remains undisclosed.

## Persistence Plan

### Schema evolution

Create a new additive migration following the established ordered/checksummed migration system. It must preserve primary keys, Workspace ownership, legacy `status`, existing Knowledge foreign keys, and existing API consumers.

Extend `companies` with:

- `slug TEXT NOT NULL`
- `name_normalized TEXT NOT NULL`
- `description TEXT NULL`
- `lifecycle_state TEXT NOT NULL`
- `timezone TEXT NULL`
- `locale TEXT NULL`
- `public_name TEXT NULL`
- `logo_asset_ref TEXT NULL`
- `brand_colors_json TEXT NOT NULL DEFAULT '{}'`
- `country_code TEXT NULL`
- `currency_code TEXT NULL`
- `date_format TEXT NULL`
- `phone_format TEXT NULL`
- `business_hours_json TEXT NOT NULL DEFAULT '{}'`
- `version INTEGER NOT NULL DEFAULT 1`
- `updated_at TEXT NOT NULL`
- `lifecycle_changed_at TEXT NOT NULL`
- `suspended_at TEXT NULL`
- `archived_at TEXT NULL`

The exact nullable/default sequence must allow existing rows to migrate without a false configuration claim. Initial lifecycle is `draft` for legacy records unless a future explicit migration can prove the required configuration and readiness policy outcome. Existing `status` remains unchanged as the onboarding/result projection.

Add a `company_events` table for durable Company audit facts:

- stable event ID and Company/Workspace references;
- event type, aggregate version, occurred-at timestamp, actor reference where available;
- minimal JSON payload containing only safe domain references and changed fields;
- no credentials, raw tokens, provider data, or personal customer content.

`companies` adds `UNIQUE(id, workspace_id)` solely to support a composite foreign key from `company_events(company_id, workspace_id)`. `company_events.workspace_id` also references `workspaces(id)`. Event inserts use the composite Company/Workspace foreign key and repository transaction to prove the event belongs to the same tenant as its aggregate; callers cannot independently supply either reference. Events include an `event_sequence` assigned by the aggregate; `UNIQUE(company_id, aggregate_version, event_sequence)` preserves ordered multiple facts, such as configuration update plus Company configured, from one aggregate version.

### Indexes and constraints

- `UNIQUE(workspace_id, slug)` for workspace-scoped slug identity.
- `UNIQUE(workspace_id, name_normalized)` for the frozen workspace-scoped CompanyName uniqueness policy.
- Keep `UNIQUE(workspace_id, website)` unless an approved product decision changes website cardinality.
- Index `(workspace_id, lifecycle_state, id DESC)` for Company listing and lifecycle filtering.
- Index `(workspace_id, id)` remains required for tenant-scoped ownership lookup.
- Unique index `company_events(company_id, aggregate_version, event_sequence)` and index `company_events(workspace_id, occurred_at DESC)` for audit reads.
- Check constraints for lifecycle state and non-negative aggregate version where compatible with SQLite migration strategy.

## Migration Plan

1. Preflight existing rows using the same normalized-name and normalized-slug algorithms. Abort before schema mutation if normalized names collide in a Workspace; operators must resolve source data through an explicit audited remediation, never automatic renaming. Resolve slug collisions deterministically with a stable ID suffix.
2. Add only nullable transitional columns or columns with SQLite-valid safe defaults. Do not add a populated-table `NOT NULL` column without a default.
3. Backfill deterministic slugs, normalized names, lifecycle `draft`, version/timestamps, and empty optional configuration values without asserting `configured` or `operational`.
4. Rebuild `companies` into a replacement table with final `NOT NULL`, check, unique, and composite-key constraints. Follow the existing migration discipline: temporarily manage foreign keys, copy by stable ID, recreate indexes, verify counts and dependent Knowledge references, then swap tables only after all checks succeed.
5. Create `company_events` only after the final Company composite key exists, with its Workspace and composite Company/Workspace foreign keys enabled and verified.
6. Verify row counts, preserved Company IDs, Workspace ownership, Knowledge foreign-key integrity, unique names/slugs, and unchanged legacy status values.
7. Deploy dual-read mapping: existing response fields remain available while new lifecycle/core fields are introduced explicitly.
8. Remove legacy fields only in a separately approved compatibility-retirement epic after all consumers migrate.

Migration must be transactional where SQLite permits, resumable/idempotent through the migrations table, tested against populated legacy data, and fail before partial ownership or uniqueness corruption.

## API Plan

All endpoints remain under the authorized Workspace route family and use the existing authenticated, same-origin CSRF, trusted workspace-resolution, and non-disclosure middleware.

| Method and route | Use case | Permission |
|---|---|---|
| `GET /workspaces/:workspaceId/companies` | List Companies | `company:read` |
| `POST /workspaces/:workspaceId/companies` | Create Company | `company:manage` |
| `GET /workspaces/:workspaceId/companies/:companyId` | Get Company | `company:read` |
| `PATCH /workspaces/:workspaceId/companies/:companyId/identity` | Update identity | `company:manage` |
| `PATCH /workspaces/:workspaceId/companies/:companyId/branding` | Update branding | `company:manage` |
| `PATCH /workspaces/:workspaceId/companies/:companyId/configuration` | Update configuration | `company:manage` |
| `POST /workspaces/:workspaceId/companies/:companyId/suspension` | Suspend Company | `company:manage` |
| `DELETE /workspaces/:workspaceId/companies/:companyId/suspension` | Restore Company | `company:manage` |
| `POST /workspaces/:workspaceId/companies/:companyId/archive` | Archive Company | `company:manage` |

No readiness-assessment endpoint is exposed in Phase 2; readiness evaluation is internal-only until authoritative dependency evidence exists.

### Hard-delete compatibility

The archive endpoint is the only Company Core lifecycle command for removal from active operations. The existing `DELETE /workspaces/:workspaceId/companies/:companyId` route remains a temporary legacy compatibility path and is not used by new Company Core clients or use cases.

1. Release the archive endpoint and migrate first-party callers to archive-first behavior before changing the legacy delete route.
2. Mark the legacy route deprecated in API documentation and response headers, publish its sunset date, and add telemetry for remaining callers.
3. Until the sunset date, preserve its existing hard-delete HTTP semantics; do not silently remap `DELETE` to archive.
4. At the sunset date, remove the legacy route or make it return an explicit deprecation outcome without mutation. A later versioned API may omit hard delete entirely.

Hard deletion is therefore a temporary backward-compatibility exception, not part of the Company aggregate command model. Any change to dependent-data deletion behavior requires a separate retention and compatibility decision.

Requests are strict allowlists per command. Responses expose safe Company DTOs with lifecycle state, version, and configuration/branding data; they never expose `workspaceId`, internal event payloads, authorization internals, raw provider values, or unvalidated readiness evidence. Invalid requests return `400`, uniqueness/concurrency conflicts return `409`, and inaccessible/not-found Company resources return the same `404` response.

## Events

Implement aggregate-collected domain events and persist them atomically with the Company mutation:

- `CompanyCreated`
- `CompanyIdentityUpdated`
- `CompanyBrandingUpdated`
- `CompanyConfigurationUpdated`
- `CompanyConfigured`
- `CompanyActivated`
- `CompanySuspended`
- `CompanyArchived`
- `CompanyRestored`
- `CompanyAttentionRequired` only when a future readiness assessment authoritatively produces that transition

`CompanyUpdated` may be emitted as an optional compatibility/audit envelope with a bounded changed-area discriminator (`identity`, `branding`, or `configuration`), but it never replaces the frozen specific domain events above. Phase 2 records events for audit and future read-model consumption only. It introduces no message broker, webhook, outbox publisher, integration execution, or event-sourced write model. Event dispatch and transport remain separately planned.

## Authorization

- The authorized router authenticates, enforces CSRF for mutations, resolves trusted Workspace context, and checks `company:read` or `company:manage` before the controller runs.
- The application service receives only trusted context and actor metadata; it never trusts workspace or actor identifiers from a request body.
- Repository queries bind every Company lookup and mutation to `workspace_id`.
- The aggregate validates command shape, immutable ownership, value objects, optimistic version, and allowed lifecycle transitions.
- Workspace policy authorizes; Company validates; the application service orchestrates.

## Testing Strategy

### Unit tests

- Value object normalization/rejection, including IANA timezone, locale, slug, colors, country/currency, formats, and business-hours structure.
- Aggregate creation, identity/branding/configuration mutation, lifecycle transitions, archive immutability, suspension/restore behavior, and version increments.
- Lifecycle rejection matrix for every invalid source/target state.
- Internal readiness-contract behavior: unavailable dependency evidence produces deterministic ephemeral `indeterminate`, no activation, and no persisted event or assessment.

### Repository and migration tests

- Workspace-scoped list/get/find-by-slug/find-by-website behavior and non-disclosure.
- Normalized name and slug uniqueness within a Workspace, with allowed duplicate names/slugs across Workspaces.
- Optimistic concurrency conflict behavior.
- Row mapping round trips for all value objects and lifecycle audit fields.
- Populated legacy migration preserving Company IDs, Workspace IDs, website uniqueness, Knowledge references, legacy statuses, counts, and deterministic collision-safe slugs.
- Event persistence is atomic with aggregate persistence and cannot record an event for a failed mutation.

### Application and controller tests

- Every use case validates authorization-independent aggregate rules and records the correct event set.
- Controller request allowlists, response DTO redaction, `400`, `404`, and `409` mapping.
- Authenticated route permission, CSRF, origin, tenant-context, and cross-workspace non-disclosure behavior.
- Existing Company endpoints remain compatible until an explicitly tested deprecation/remapping decision is accepted.

## Acceptance Criteria

1. Company Core implements only the frozen Company aggregate and no dependent operational domain.
2. Every Company is owned by exactly one Workspace and every repository operation is tenant-scoped.
3. All specified value objects are validated and persistable without vertical-specific fields.
4. Company lifecycle transitions and invariants match `COMPANY-DOMAIN.md`.
5. Legacy onboarding status remains intact and cannot cause an automatic operational lifecycle state.
6. Workspace authorization, application orchestration, and aggregate validation remain separate.
7. Slugs are deterministic, workspace-unique, and safe for future routes.
8. Archive is non-destructive; Company history and dependent ownership are retained.
9. Company events are atomically recorded with mutations, tenant-consistent through foreign keys, and not transported externally.
10. Cross-workspace Company access is indistinguishable from not found.
11. The migration is additive, verified against populated data, and preserves existing Company/Knowledge relationships.
12. No Channels, Knowledge changes, Assistant changes, Conversations, Dashboard, Analytics, Automations, Integrations, or frontend work is introduced.

## Definition of Done

- Domain types, aggregate, value objects, lifecycle policy, and readiness boundary are implemented behind focused modules.
- Repository port, SQLite implementation, mapper, migration, indexes, constraints, and event audit storage are implemented and tested.
- Authorized REST commands and safe read DTOs are implemented with no client-controlled tenant authority.
- All unit, repository, application, controller, authorization, lifecycle, and migration tests pass.
- Existing Company consumers remain compatible or have an approved, tested migration path.
- No dependent bounded context is modified.
- Architecture documentation remains the source of truth; any deviation requires architecture review before implementation.

## Implementation Phases

| Step | Deliverable | Dependency |
|---|---|---|
| 2.1 | Domain value objects, aggregate, lifecycle transition matrix, readiness boundary | Frozen Phase 1 architecture |
| 2.2 | Repository port, mapper, additive migration, indexes, event audit schema | 2.1 |
| 2.3 | Application use cases, transaction boundaries, event recording | 2.2 |
| 2.4 | Controllers, authorized route wiring, DTOs, legacy endpoint compatibility | 2.3 |
| 2.5 | Full test matrix, migration rehearsal, authorization/non-disclosure verification | 2.1-2.4 |
| 2.6 | Documentation reconciliation and implementation closeout review | 2.5 |

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Legacy status is mistaken for lifecycle readiness | Preserve it as a separate projection; initialize lifecycle conservatively to `draft`. |
| Configuration migration falsely marks Companies ready | Use nullable/default configuration and require explicit post-migration validation. |
| Slug backfill collisions break tenants | Use deterministic normalized-name plus stable-ID suffix resolution and verify uniqueness before commit. |
| Aggregate changes bypass Workspace authority | Require trusted `WorkspaceContext` at route, service, and repository boundaries. |
| Generic core becomes vertical-specific | Reject vertical fields; add future modules only through separate bounded-context design. |
| Core scope expands into dependent domains | Treat readiness evidence adapters, Channels, Knowledge, Assistant, Dashboard, and analytics as explicit non-goals. |
| Event storage becomes premature distributed architecture | Persist local audit facts only; defer transport/outbox implementation. |
| Concurrent updates overwrite configuration | Enforce aggregate version comparison in repository writes. |
