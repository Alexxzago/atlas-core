# EPIC-023 - Company Domain

**Phase:** 1 - Engineering Plan and Domain Architecture Freeze  
**Status:** Planned and architecture frozen  
**Implementation status:** No implementation in this phase

## Executive Summary

EPIC-023 freezes Company as Atlas's generic operational business unit. It preserves Workspace as the multi-tenant administrative boundary and assigns each future operational capability to an explicit Company-scoped bounded context. The detailed contract is `docs/architecture/COMPANY-DOMAIN.md`.

This phase creates architecture documentation only. It does not change application source, tests, configuration, APIs, persistence, migrations, routes, frontend behavior, events, or provider integrations.

## Domain Philosophy

- Workspace owns tenant administration; Company owns one real-world business's operations.
- Company identity, branding, and operating configuration are generic and vertical-neutral.
- Channels, Knowledge, Assistant, Conversations, Automations, Analytics, and Integrations remain independent bounded contexts under Company ownership.
- Dashboard composes authoritative Company-domain presentation models and never calculates readiness.

## Bounded Contexts

The frozen map is:

```text
Workspace
└── Company
    ├── Channels
    ├── Knowledge
    ├── Assistant
    ├── Conversations
    ├── Automations
    ├── Integrations
    └── Analytics read models

Dashboard <- Company-domain presentation composition
```

Identity, membership, authorization, workspace secret references, and billing remain Workspace- or Identity-scoped and do not move into Company.

## Ownership Rules

- A Company belongs to exactly one Workspace.
- Company-scoped modules belong to exactly one Company and are accessed through trusted Workspace context plus Company ownership.
- No Company module duplicates Workspace authority or owns raw provider credentials.
- Cross-Company sharing and Workspace transfer require later explicit architecture decisions.

## Aggregate Diagram

The aggregate diagram, aggregate ownership, and cross-aggregate coordination rules are frozen in [Company Domain](../architecture/COMPANY-DOMAIN.md#aggregate-diagram).

## Entities

The Company aggregate root owns Company identity, lifecycle, branding, and configuration. Channel Connections, Knowledge records, Assistant Profiles, Conversations, Automations, and Integration Connections are Company-owned independent aggregates. Analytics is a derived read model.

## Value Objects

The core Company model uses `CompanyId`, `CompanyName`, `CompanySlug`, `CompanyDescription`, `WebsiteUrl`, `CompanyTimezone`, `CompanyLocale`, `Branding`, `OperatingLocale`, `BusinessHours`, and `CompanyLifecycleState`. These values are generic and do not encode a business vertical.

## Lifecycle

The frozen Company lifecycle is:

```text
draft -> configured -> operational <-> attention_required
                         |
draft | configured | operational | attention_required -> suspended -> eligible restoration
all non-archived states -> archived -> explicit restoration policy
```

Company lifecycle is administrative and policy-owned. Workspace policy authorizes lifecycle commands; Company Management validates and executes them. It does not replace the state of a Channel, Knowledge, Assistant Profile, or Conversation. Existing Company status data remains a separate compatibility projection until an approved migration retires it.

## State Machines

- Company: `draft | configured | operational | attention_required | suspended | archived`
- Channels: complete provider-neutral connection lifecycle from unconfigured through connected, disconnected, and administratively suspended
- Knowledge: independent collection, review, publication, and failure lifecycle
- Assistant: `draft | ready | disabled | archived`

No unrelated status enum may be reused across these contexts. Company readiness is calculated by a versioned Company-domain policy from explicit authoritative dependency evidence, yielding `eligible`, `ineligible`, or `indeterminate`; product thresholds remain policy data, not Dashboard logic.

## Relationships

- Workspace to Company: one-to-many.
- Company to Channels, Knowledge, Assistant, Conversations, Automations, and Integrations: one-to-many.
- Company to Analytics: independently derived read models keyed by `CompanyId`.
- Dashboard to Company: read-only presentation composition.

## Domain Events

Future facts include `CompanyCreated`, `CompanyConfigured`, `CompanyActivated`, `CompanyAttentionRequired`, `CompanySuspended`, `CompanyArchived`, `ChannelConnected`, `KnowledgePublished`, `AssistantProfileReady`, and `ConversationStarted`. `Conversation` is the aggregate root; Messages are append-only Conversation entities. Events support audit, integrations, and read models; they do not introduce event sourcing.

## Dashboard Integration

Dashboard must consume presentation models sourced from each authoritative bounded context. It cannot infer Company readiness, transform missing data into a status, own business state, or access repositories/providers. Source context and unavailable/not-assessed states remain visible in the presentation model.

## Future Evolution

The domain supports new channels without Company redesign: WhatsApp, Instagram, Facebook, Telegram, Email, Voice, Web Chat, and future channels enter through provider-neutral Company-owned Channel Connections. Future modules must define ownership, aggregate root, state machine, invariants, events, and Dashboard read contract before implementation.

## Risks

- Overloading Company with vertical-specific fields.
- Reusing status enums across contexts and creating false readiness claims.
- Allowing Dashboard or analytics to become authoritative state.
- Duplicating Workspace ownership on Company-owned records.
- Leaking provider credentials or provider-specific behavior into Company.

The frozen architecture document defines guardrails for each risk.

## Implementation Strategy

Implementation is intentionally deferred. Future implementation epics must:

1. Preserve accepted Workspace, Knowledge, Conversation, and Assistant ADRs.
2. Introduce one bounded context at a time behind explicit repository/service/controller boundaries.
3. Define command authorization through trusted Workspace context and Company ownership.
4. Add source-owned state transitions and events before Dashboard summaries consume them.
5. Add migrations, APIs, frontend presentation, and tests only in the implementation epic that owns the context.
6. Reopen architecture review before changing a frozen ownership rule, state machine, or aggregate boundary.

## Acceptance Criteria

1. Company is defined as a generic operational unit under exactly one Workspace.
2. Workspace, Company, and every listed operational domain have unambiguous ownership.
3. Core Company identity, branding, and configuration are separated from vertical-specific extensions.
4. Company, Channels, Knowledge, and Assistant have independent state models.
5. Company lifecycle and readiness policy are distinct from dependent-context status.
6. Readiness assessments are deterministic, versioned, evidence-based, and produce eligible, ineligible, or indeterminate outcomes without freezing product thresholds.
7. Existing Company status data is preserved as a compatibility projection and is never silently mapped to operational readiness.
8. Dashboard is explicitly read-only and never authoritative for business state.
9. Channel extensibility does not require redesigning Company or Conversations.
10. Future domain events, aggregate roots, value objects, invariants, relationships, risks, and implementation sequence are documented.
11. No application source, tests, configuration, APIs, or persistence are changed in this phase.

## Definition of Done

- `docs/architecture/COMPANY-DOMAIN.md` freezes the Company domain contract.
- `docs/plans/EPIC-023-COMPANY-DOMAIN.md` records the planning scope, acceptance criteria, and implementation direction.
- The documentation aligns with ADR-002, ADR-004, ADR-005, ADR-010, and the Workspace/Identity domain model.
- No implementation artifacts are produced.

## Estimated Implementation Phases

| Phase | Scope | Estimate |
|---|---|---|
| 2 | Company identity, branding, configuration value objects, lifecycle commands, authorization, persistence, and audit facts | 1-2 epics |
| 3 | Company readiness policy and Company read model, without Dashboard inference | 1 epic |
| 4 | Provider-neutral Channels aggregate and first WhatsApp connection lifecycle | 1-2 epics |
| 5 | Knowledge publication integration and Assistant readiness read contracts | 1 epic |
| 6 | Company-scoped Conversations and channel-neutral routing | 1-2 epics |
| 7 | Dashboard operational composition from authoritative read models | 1 epic |
| 8 | Automations, Integrations, Analytics, and additional channels | Incremental, separately planned epics |

Estimates describe sequencing only. Each implementation phase requires its own approved architecture and delivery plan.
