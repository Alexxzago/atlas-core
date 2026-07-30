# Company Domain

**Status:** Architecture frozen for EPIC-023 Phase 1  
**Scope:** Domain architecture only. This document creates no API, persistence, eventing, or UI implementation.

## Executive Summary

Company is Atlas's operational business unit. A Workspace is the tenant and administrative boundary; a Company is one real-world business operated within that boundary. A Company owns its business identity, operating configuration, branding, and the Company-scoped domains that serve its customers. It must remain generic across verticals.

The Company aggregate does not calculate the state of Channels, Knowledge, Assistant, Conversations, Analytics, Automations, or Integrations. Each bounded context owns its own facts and state machine. Company lifecycle state expresses administrative availability, while the Dashboard consumes composed presentation models from authoritative domain read models.

## Domain Philosophy

- A Workspace owns zero or more Companies. A Company belongs to exactly one Workspace.
- Company is the operational boundary for a single business, not a tenant, user, provider account, or channel.
- Business facts, configuration, and customer operations are Company-scoped unless explicitly designated Workspace-scoped.
- Company remains vertical-neutral. No real-estate, legal, medical, retail, or other vertical fields belong in its core model.
- Workspace authority is resolved through trusted `WorkspaceContext`; client selection never establishes access.
- A Company may have no Channels, Knowledge, Assistant Profiles, Conversations, Automations, Integrations, or Analytics records. Absence is not success or failure.
- Company-level readiness is an explicit policy outcome, never a frontend inference and never a replacement for the states owned by dependent domains.

## Bounded Contexts

| Context | Aggregate root / owner | Responsibility | Must not own |
|---|---|---|---|
| Workspace Administration | Workspace | Tenant isolation, memberships, roles, billing and workspace-wide policy | Company operations or customer data |
| Company Management | Company | Identity, branding, configuration, Company lifecycle, ownership anchors | Channel health, knowledge publication, assistant execution, conversation lifecycle |
| Channels | ChannelConnection | Provider-neutral connection configuration and channel lifecycle | Conversation history or Company knowledge |
| Knowledge | KnowledgeCatalog / publication boundary | Company factual knowledge, sources, revisions, publication | Assistant persona or provider secrets |
| Assistant | AssistantProfile | Assistant behavior configuration and readiness | Company identity or shared factual knowledge |
| Conversations | Conversation | Channel-neutral customer interaction and lifecycle; append-only messages | Provider-owned history or Company configuration |
| Automations | Automation | Company-scoped triggers, rules, and execution policy | Core Company lifecycle authority |
| Analytics | CompanyAnalytics read model | Derived Company operational measurements | Source-of-truth operation state |
| Integrations | IntegrationConnection | Company-scoped external-system linkage and lifecycle | Raw workspace secrets or domain facts |
| Dashboard | Presentation composition | Read-only Company operational presentation model | Business state, readiness policy, or mutations |

## Ownership Rules

### Workspace owns

- Tenant identity, memberships, authorization policy, workspace-wide billing, and workspace-level secret references.
- Authorization to issue Company lifecycle commands through explicit Workspace policy. Company Management validates and executes authorized lifecycle transitions.
- No Company-specific customer operations, business facts, assistant configuration, or channel state.

### Company owns

- Business identity, branding, local operating configuration, Company lifecycle, and Company-scoped module ownership.
- Ownership anchors for its Channel Connections, Knowledge, Assistant Profiles, Conversations, Automations, Integrations, and future Company modules. Independent aggregates and read models are linked by `CompanyId`; they are not loaded or maintained as Company object graphs.
- No Memberships, user identities, workspace-wide secrets, tenant-wide billing, or provider-specific raw credentials.

### Module ownership rules

- A Channel Connection belongs to one Company; provider credentials are references resolved through the Workspace secret boundary.
- Knowledge and its published factual view belong to one Company and are shared by that Company's channels and assistants.
- An Assistant Profile belongs to one Company and selects or consumes Company knowledge through explicit contracts.
- A Conversation belongs to one Company and may reference its originating Channel Connection. Messages belong to Conversation.
- Analytics is derived from Company domain facts, keyed by `CompanyId`, and cannot become the source of Company or operational state.
- Automations and Integrations are Company-scoped by default. A future workspace-wide integration requires an explicit separate aggregate and must be linked to Companies deliberately.

## Aggregate Diagram

```text
Workspace (tenant and administrative aggregate)
└── Company (operational aggregate)
    ├── Identity, Branding, Configuration value objects
    ├── ChannelConnection aggregates (0..*)
    ├── Knowledge aggregates / publications (0..*)
    ├── AssistantProfile aggregates (0..*)
    ├── Conversation aggregates (0..*)
    │   └── append-only Message entities
    ├── Automation aggregates (0..*)
    ├── IntegrationConnection aggregates (0..*)
    └── CompanyAnalytics read models keyed by CompanyId (0..*)

Dashboard <- composed presentation model from Company-domain read models
```

Aggregate references use stable identifiers, not mutable object graphs. Cross-aggregate rules are coordinated by application services and policies; they are not enforced by loading all child aggregates into Company.

## Entities

### Company aggregate root

**Identity:** `CompanyId`, immutable and unique within Atlas.  
**Tenant owner:** exactly one `WorkspaceId`.  
**Responsibilities:** protect Company identity, configuration consistency, lifecycle transitions, and ownership references.  
**Forbidden responsibilities:** provider communication, database access, channel/knowledge/assistant state transitions, dashboard calculation, and authorization derived from client inputs.

### Company-owned entities

These are independent aggregate roots, not child entities loaded and saved through Company:

- `ChannelConnection`
- `KnowledgeSource`, `KnowledgeRevision`, and publication records
- `AssistantProfile`
- `Conversation`, containing append-only `Message` entities
- `Automation`
- `IntegrationConnection`

`BrandAsset` may begin as a Company entity when assets are only configuration metadata. It becomes an aggregate root only when it has independent lifecycle, access policy, processing, or reuse requirements.

## Value Objects

| Value object | Meaning and invariant |
|---|---|
| `CompanyId` | Opaque stable identifier; identifies, never authorizes. |
| `CompanyName` | Required display name, normalized for comparison; uniqueness policy is workspace-scoped and explicit. |
| `CompanySlug` | Stable URL-safe workspace-scoped identifier; changes require explicit redirect/audit policy. |
| `CompanyDescription` | Optional bounded business description, not assistant instruction text. |
| `WebsiteUrl` | Valid absolute public website reference. |
| `CompanyTimezone` | Valid IANA timezone used for business hours and Company-local operations. |
| `CompanyLocale` | Default Company business locale; separate from portal locale and assistant language. |
| `Branding` | Public name, logo/asset references, and approved color tokens; no raw binary asset ownership in the value. |
| `OperatingLocale` | Country/region, currency, date format, phone format, and measurement/display conventions. |
| `BusinessHours` | Structured weekly schedule with exceptions; no channel availability inference. |
| `CompanyLifecycleState` | Administrative Company state defined below. |

Country, currency, timezone, locale, date format, and phone format are configuration. They do not determine a business vertical or operational readiness.

`CompanyId` is a globally unique opaque technical identity so an aggregate can be referenced safely across bounded contexts and future data stores. `CompanyName` and `CompanySlug` are human-facing business identities and therefore have workspace-scoped uniqueness: different tenants may operate businesses with the same name or preferred slug without collision.

## Lifecycle

### Company lifecycle

```text
draft --complete required Company configuration--> configured
configured --activate through approved readiness policy--> operational
operational --authoritative dependency issue--> attention_required
attention_required --issue resolved and policy satisfied--> operational
draft | configured | operational | attention_required --suspend--> suspended
suspended --restore to prior eligible state through policy--> configured | operational | attention_required
draft | configured | operational | attention_required | suspended --archive--> archived
archived --explicit restore policy--> draft | configured | suspended
```

### Lifecycle definitions

- `draft`: Company exists but mandatory identity/configuration is incomplete.
- `configured`: mandatory identity/configuration is complete; the Company is administratively eligible for dependent setup.
- `operational`: the explicit Company readiness policy confirms the approved minimum operational dependencies.
- `attention_required`: an authoritative dependency or Company policy identifies an operational issue after configuration. It is not inferred from missing dashboard data.
- `suspended`: administrative pause. Customer-facing operational execution must not proceed, regardless of child states.
- `archived`: inactive and retained according to policy. New operations are forbidden. Restoration is explicit and auditable.

### Lifecycle invariants

1. A Company cannot be operational while suspended or archived.
2. Workspace authorization policy decides whether an actor may issue a lifecycle command; Company Management validates the command and executes a valid Company transition.
3. `operational` and `attention_required` are policy outcomes from authoritative Company and dependent-domain facts, not mutable UI labels.
4. Archive does not delete child history. Retention and deletion require separate policy.
5. A Company transfer between Workspaces is not an update; it requires a future explicit migration policy that preserves dependent ownership and audit history.

### Lifecycle compatibility and migration

Existing Company status values are legacy onboarding/result facts, not aliases for the frozen Company lifecycle. A future implementation must introduce the lifecycle without silently reinterpreting or losing those facts.

1. Preserve each existing status and its history as a distinct onboarding/result projection until an approved retirement migration exists.
2. Do not map an existing successful or ready onboarding result directly to `operational`; operational requires a successful readiness assessment under this document's policy contract.
3. Derive the initial lifecycle state from an explicit Company configuration and readiness assessment, recording the policy version and reasons used for the result.
4. Maintain a compatibility read model for existing API and portal consumers until they deliberately migrate to Company lifecycle and source-owned domain states.
5. Make migration idempotent, auditable, tenant-scoped, and safe to resume. No migration may infer readiness from a missing dependent read model.

## State Machines

State enums are bounded-context-specific. Similar words do not imply interchangeable types.

### Company state

`draft | configured | operational | attention_required | suspended | archived`

Owned by Company Management. It controls administrative availability and the Company readiness policy outcome only.

### Channel Connection state

```text
unconfigured -> pending_configuration -> validating -> connected
pending_configuration -> unconfigured
validating -> attention_required
connected -> attention_required | disconnected | suspended
attention_required -> validating | disconnected | suspended
disconnected -> pending_configuration | suspended
suspended -> validating | disconnected
```

Owned by Channels. Channel-specific providers may have additional internal states, but they map explicitly to this provider-neutral operational contract. Connection state does not imply Company lifecycle state.

- `unconfigured`: no usable connection configuration exists.
- `pending_configuration`: setup has begun but required configuration is incomplete.
- `validating`: Atlas is evaluating supplied configuration or provider reachability.
- `connected`: the provider-neutral connection contract is currently satisfied.
- `attention_required`: configuration or validation needs operator action; no connected claim is made.
- `disconnected`: a previously attempted or connected integration is not available for use.
- `suspended`: local administrative use is paused without deleting configuration. Resume requires a fresh validation or leaves the connection disconnected.

Company suspension prevents customer-facing execution regardless of Channel Connection state. It does not mutate a Channel Connection's state; resuming a Company therefore never claims that a channel remains connected.

### Knowledge state

```text
empty -> collecting -> review_required -> published
collecting -> failed
review_required -> collecting | published
published -> collecting | review_required
failed -> collecting
```

Owned by Knowledge. Published knowledge remains authoritative until an explicit replacement publication succeeds. A failed refresh does not silently invalidate an existing published version.

### Assistant Profile state

`draft | ready | disabled | archived`

Owned by Assistant, consistent with ADR-010. A ready profile is not a claim that any channel is connected or that the Company is operational.

### Readiness policy contract

The Company Readiness Policy is a Company-domain service. It owns the Company-level assessment only; dependent contexts remain authoritative for their own facts and state machines.

**Inputs**

- A named, versioned `ReadinessPolicyDefinition`, including declared product capabilities and dependency categories. Product-specific thresholds, such as the number or type of required channels, are policy data rather than a change to this domain architecture.
- A validated Company identity/configuration snapshot and current Company lifecycle state.
- Explicit, versioned evidence snapshots from dependent contexts: published Knowledge availability, eligible Assistant Profiles, eligible Channel Connections, and any future declared dependency category.
- Evidence source identity, state, version or revision where applicable, and as-of time.

**Outputs**

- A `ReadinessAssessment` with `eligible`, `ineligible`, or `indeterminate` outcome.
- Stable reason codes, contributing evidence references, policy identifier/version, and evaluation time.
- At most one candidate Company lifecycle action: promote to `operational`, mark `attention_required`, or no lifecycle change. The policy cannot override `suspended` or `archived`.

**Evaluation semantics**

1. Evaluate server-side after a relevant authoritative Company or dependency fact changes, and on explicit authorized reassessment. Dashboard never evaluates the policy.
2. For identical policy and evidence versions, evaluation is deterministic and idempotent.
3. Missing, stale, inaccessible, or internally inconsistent required evidence produces `indeterminate`, not `eligible`; it cannot promote a Company to `operational`.
4. Only an `eligible` assessment may promote `configured` to `operational`.
5. An `ineligible` assessment may mark an operational Company `attention_required` only when the policy declares the degraded dependency relevant. The assessment must retain its reasons and evidence.
6. Company Management records and validates the resulting lifecycle transition. Child contexts are never rewritten to make a Company assessment succeed.

## Relationships

| Relationship | Cardinality and rule |
|---|---|
| Workspace to Company | One Workspace owns zero or more Companies; one Company belongs to exactly one Workspace. |
| Company to Channels | One Company owns zero or more Channel Connections; a connection never spans Companies. |
| Company to Knowledge | One Company owns zero or more sources/revisions and its publication boundary. Shared knowledge requires an explicit future governed reference. |
| Company to Assistant | One Company owns zero or more Assistant Profiles. No implicit default profile. |
| Company to Conversations | One Company owns zero or more Conversations; each conversation may reference one origin channel. |
| Company to Analytics | Analytics read models are independently derived, scoped by `CompanyId`, and consume Company domain events/facts. |
| Company to Automations | One Company owns zero or more Automations; automations invoke domain commands through services, never bypass invariants. |
| Company to Integrations | One Company owns zero or more Integration Connections. Workspace secrets are referenced, never copied into Company. |
| Dashboard to Company | Dashboard reads Company-domain presentation models. It owns no Company state and issues only authorized navigation or command intent. |

## Domain Events

Events are append-oriented facts for audit, read models, integrations, and future asynchronous work. They do not require event sourcing and must exclude raw credentials, tokens, and unnecessary personal data.

### Company Management

- `CompanyCreated`
- `CompanyIdentityUpdated`
- `CompanyBrandingUpdated`
- `CompanyConfigurationUpdated`
- `CompanyConfigured`
- `CompanyActivated`
- `CompanyAttentionRequired`
- `CompanySuspended`
- `CompanyRestored`
- `CompanyArchived`

### Dependent contexts

- Channels: `ChannelConnectionCreated`, `ChannelConnected`, `ChannelValidationFailed`, `ChannelDisconnected`, `ChannelAttentionRequired`
- Knowledge: `KnowledgeSourceAdded`, `KnowledgeImportCompleted`, `KnowledgeImportFailed`, `KnowledgePublished`, `KnowledgePublicationSuperseded`
- Assistant: `AssistantProfileCreated`, `AssistantProfileReady`, `AssistantProfileDisabled`, `AssistantProfileArchived`
- Conversations: `ConversationStarted`, `MessageReceived`, `MessageSent`, `ConversationHandedOff`, `ConversationClosed`
- Automations: `AutomationCreated`, `AutomationEnabled`, `AutomationDisabled`, `AutomationExecuted`, `AutomationFailed`
- Integrations: `IntegrationConnected`, `IntegrationDisconnected`, `IntegrationAttentionRequired`

## Dashboard Integration

Dashboard is a read-side composition boundary. It receives a Company-scoped presentation model built by an application/query layer from authoritative context read models. It may display Company identity, Company lifecycle, and explicitly supplied Channel, Knowledge, Assistant, Conversation, Analytics, Automation, and Integration summaries.

Dashboard must not:

- infer readiness from missing or partial client data;
- convert one context's status enum into another context's state;
- mutate Company or dependent state;
- call providers or repositories;
- expose a cross-workspace Company; or
- treat an unavailable read model as a failing Company.

Each summary must preserve source context, freshness/as-of metadata where relevant, and `not_assessed` or `unavailable` when authoritative data does not exist. Dashboard action recommendations are presentation policy, not authoritative operational state.

## Future Evolution

### Channels

WhatsApp, Instagram, Facebook, Telegram, Email, Voice, Web Chat, and future channels attach as `ChannelConnection` types under Company. Provider-specific identifiers and delivery mechanics remain adapter metadata. They do not change the Company aggregate or Conversation ownership.

### Extensible modules

Future Company modules must declare: Company ownership, aggregate root, bounded-context state machine, value objects, invariants, events, read model contract, and Dashboard summary contract. Examples include appointments, CRM sync, lead routing, catalog, compliance, document processing, and industry extensions.

### Deliberately postponed decisions

- Exact operational-readiness dependency policy by product tier or release.
- Company deletion, retention, legal hold, and restoration windows.
- Workspace-to-Company transfer workflow.
- Shared/group branding, shared knowledge, or cross-Company routing.
- Workspace-wide versus Company-scoped integration products.
- Published immutable Assistant Profile revisions and channel-to-profile routing policy.
- Event transport, outbox mechanics, and analytics warehouse design.

## Risks

| Risk | Guardrail |
|---|---|
| Company becomes a dumping ground for all business fields | Keep vertical-specific capability in explicit future modules/value objects. |
| Dashboard becomes an unofficial readiness engine | Require source-owned state and a Company-domain readiness policy. |
| Status enum reuse creates false equivalence | Maintain distinct context-owned state types and explicit mappings only in read models. |
| Workspace and Company ownership are duplicated | Store/enforce Workspace ownership through Company for Company-owned aggregates unless a separate security boundary is justified. |
| Provider details leak into core Company | Keep provider identifiers and credentials in Channels/Integrations and secret-boundary adapters. |
| Analytics changes operational truth | Treat analytics as derived read models, never command authority. |
| Future channel additions redesign Company | Require provider-neutral `ChannelConnection` contracts and channel-neutral Conversations. |
