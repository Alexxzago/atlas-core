# EPIC 012 — Independent Architecture Review

**Review subject:** `docs/plans/EPIC_012_ENGINEERING_PLAN.md`  
**Reviewer role:** Independent Lead Architect  
**Review date:** 2026-07-20  
**Review status:** Complete

## 1. Executive Summary

The Engineering Plan has the correct architectural center: Knowledge is Company-owned inside the Workspace tenant boundary; Assistant Profiles remain separate; external acquisition and AI extraction remain behind provider-neutral ports; ingestion does not silently publish; and Assistant Preview consumes only an explicit immutable publication. These decisions align strongly with ADR-001, ADR-002, ADR-003, ADR-004, ADR-008, ADR-010, and ADR-013.

However, the plan is not yet safe to implement verbatim. It leaves schema-defining and behavior-defining questions unresolved while simultaneously proposing persistence constraints and API contracts that depend on those answers. Most importantly, the proposed circular Company/Knowledge Version foreign-key graph and duplicate publication state create unnecessary integrity and deletion hazards; the compilation algorithm is not sufficiently specified to guarantee deterministic, factual output; URL acquisition security is described as a goal without an enforceable adapter contract; and the legacy backfill representation is undecided.

The plan also carries more lifecycle and audit machinery than the MVP needs in several places. Immutable source revisions and published versions are justified, but a separate publication event aggregate, a Company pointer, actor fields in multiple records, abandoned processing recovery, candidate persistence, and broad historical retention must be reduced to one consistent model. Complexity is acceptable only where it protects publication atomicity, tenant isolation, or existing knowledge.

The architecture is approved conditionally. No production implementation should begin until the mandatory decisions in this review are incorporated into an implementation baseline or an accepted follow-up ADR. A cosmetic plan update is not required by this review task, but the implementation specification must resolve every mandatory item.

## 2. Architecture Score

**7.4 / 10**

| Area | Classification | Assessment |
|---|---|---|
| Domain Model | APPROVED WITH CHANGES | Source, Revision, and Version boundaries are sound; Publication and pointer responsibilities overlap. |
| Lifecycle | APPROVED WITH CHANGES | Explicit publish and immutable terminal artifacts are correct; recovery and Company status semantics are unresolved. |
| Multi-tenancy | APPROVED WITH CHANGES | Ownership through Company is correct; actor context and every transactional query must be specified without changing `WorkspaceContext` authority. |
| Assistant vs Knowledge separation | APPROVED | Fully aligned with ADR-004, ADR-010, and ADR-013. |
| Provider neutrality | APPROVED WITH CHANGES | Ports are appropriate; URL safety and cancellation requirements must be capabilities of the port, not assumptions about Firecrawl. |
| Publication model | APPROVED WITH CHANGES | Explicit atomic publication is mandatory and correct; current-publication representation must be simplified. |
| Retrieval strategy | APPROVED | A bounded complete structured snapshot is appropriate for this epic and preserves the current execution contract. |
| URL ingestion | APPROVED WITH CHANGES | Single-page public URL scope is appropriate; enforceable SSRF/redirect/size guarantees are a release blocker. |
| PDF ingestion | APPROVED WITH CHANGES | Local bounded text extraction and no OCR are appropriate; parser selection and enforceable resource isolation are unresolved. |
| Persistence | APPROVED WITH CHANGES | Immutable history is justified; circular references, cascade behavior, duplicate digests, and legacy backfill must be redesigned. |
| API | APPROVED WITH CHANGES | Authenticated nested resources and stable errors are correct; request/response shape and candidate semantics need simplification. |
| Frontend | APPROVED WITH CHANGES | Dedicated state and stale-response protection are correct; permissions must come from an authoritative server representation. |
| Security | APPROVED WITH CHANGES | Threats are identified well; several controls are stated but not made testable or enforceable. |
| Concurrency | APPROVED WITH CHANGES | Publication CAS and database constraints are appropriate; synchronous job recovery is overdesigned and incompletely defined. |
| Testing | APPROVED | Coverage is unusually complete and correctly includes migration, tenancy, security, and regression behavior. |
| Performance | APPROVED WITH CHANGES | Bounded snapshot retrieval fits the MVP; concrete limits and synchronous request budgets must be frozen. |
| MVP scope | APPROVED WITH CHANGES | No vector/queue/OCR scope is disciplined, but the persistence/audit model should be reduced before implementation. |

## 3. Strengths

1. **Correct ownership model.** Workspace remains the tenant and Company remains the business owner. The plan does not duplicate `workspace_id` into Company-owned Knowledge records, matching ADR-002 and the established Assistant Profile pattern.

2. **Correct knowledge/assistant boundary.** Knowledge is not owned by an Assistant Profile, channel, model, prompt, or session. Publishing knowledge neither mutates nor implicitly selects an Assistant Profile.

3. **Safe runtime boundary.** Assistant Preview follows a single published reference and receives only the existing structured `AssistantExecutionKnowledge`. Draft content, raw text, provider metadata, and internal identifiers do not leak into ADR-013's execution contract.

4. **Explicit publication.** Ingestion and publication are separated. A failed refresh preserves the last known-good publication. This corrects the current onboarding behavior, which deletes usable knowledge before replacement succeeds.

5. **Provider neutrality.** URL acquisition, PDF extraction, and factual extraction are described as replaceable adapters. Services retain validation, lifecycle, merge, and publication policy.

6. **Appropriate non-vector retrieval.** Loading one bounded structured snapshot is the simplest viable strategy for the current `CompanyKnowledge` schema. It avoids premature RAG infrastructure without preventing a later retrieval ADR.

7. **Strong tenant/security posture.** New management operations are placed under authenticated Workspace routes, preserve generic-not-found concealment, require CSRF for mutation, and treat all source content as untrusted.

8. **Concurrency awareness.** The plan recognizes stale frontend requests, duplicate ingestion, publication races, and the need for database-enforced compare-and-swap rather than process-memory locks.

9. **Migration and regression discipline.** It calls for append-only migrations, production-shaped rehearsal, backups, foreign-key checks, logical snapshot comparison, and preservation of EPIC 004–011 behavior.

10. **Clear exclusions.** Vector search, OCR, crawling, queues, rich editing, channels, and unrelated SaaS capabilities remain out of scope.

## 4. Weaknesses

### 4.1 Duplicate and circular publication state

The plan proposes all of the following:

- `knowledge_versions.company_id -> companies.id`;
- `companies.published_knowledge_version_id -> knowledge_versions.id`;
- append-only `knowledge_publications` containing current and previous version references.

This creates a circular foreign-key graph and two representations of publication state: the Company pointer and publication history. It complicates table rebuilds, Company deletion, cascading history, backfill ordering, and integrity recovery without adding MVP value. A transaction can keep duplicated state consistent, but the architecture should avoid representing the same invariant twice.

### 4.2 Compilation is not implementable from the specification

“Normalize, deduplicate exact repeated facts, and reject conflicting scalar facts” is insufficient for the current nested schema. The plan does not define:

- whether exactly one revision per source may be selected;
- how Company identity fields interact with authoritative Company fields;
- equality normalization for services, locations, FAQ questions, and answers;
- whether differing FAQ answers are conflicts or separate entries;
- whether an empty field conflicts with a non-empty field;
- how source order affects output;
- whether AI is called per source or again for the aggregate;
- what conflict details are safe to return.

Without a complete pure merge contract, two implementations can produce different published facts from the same manifest.

### 4.3 URL security is aspirational at the critical boundary

Atlas-side DNS resolution does not prove what a remote Firecrawl service ultimately fetches. Atlas cannot independently enforce the remote provider's redirect destinations, DNS resolution, response size, or network reachability merely by validating the initial URL. The plan acknowledges this but still lists a Firecrawl flow as if it were implementable. The port must require auditable guarantees or the adapter must be rejected.

### 4.4 PDF resource control is overstated

An `AbortSignal` or Promise timeout does not necessarily interrupt CPU-bound parsing in the same Node process. A bounded byte size helps but does not bound decompression, page graph complexity, memory, or CPU time. The plan must distinguish request timeout from actual parser termination and define a safe MVP ceiling validated against adversarial fixtures. If the chosen parser cannot be interrupted, that residual risk must be explicitly accepted or parsing isolated.

### 4.5 Schema decisions remain open

The public source kinds are fixed, yet legacy migration may require `legacy`. Snapshot digest uniqueness is proposed, but the review asks whether identical snapshots with different manifests create new versions. PDF transport/parser, publication roles, Company readiness, and candidate persistence are also unresolved. These are not implementation details; they change constraints, permissions, routes, or domain semantics.

### 4.6 Actor authority is vague

The plan suggests extending “route/controller context” with a principal but does not preserve the exact ADR-008 distinction. `WorkspaceContext` should continue containing only trusted tenant authority. A separate immutable `ActorContext` or application command metadata should carry the authenticated User ID. Client-provided actor IDs must never enter audit records.

### 4.7 Deletion and retention invariants are incomplete

Company deletion currently exists. Proposed `ON DELETE CASCADE` from Company combined with `ON DELETE RESTRICT` through source revisions, manifests, versions, publications, and Users may make Company deletion fail or leave ambiguous retention behavior. “Archive instead of delete” does not answer what an existing Company delete endpoint must do or how user erasure/status lifecycle affects audit attribution.

### 4.8 Synchronous ingestion and abandoned-state recovery conflict

The plan chooses synchronous HTTP ingestion but models pending/processing recovery similar to a job system. It does not define which request is allowed to mark an old attempt failed, how clock authority works, or whether a timed-out request may later commit success. Persisted attempts are useful, but job leasing and recovery should not be approximated casually.

### 4.9 Frontend authorization source is missing

The current Workspace summary exposes `role`, not a permission set. The plan asks the UI to show read-only/publish controls based on new permissions without deciding whether the frontend derives permissions from role or receives server-derived capabilities. Duplicating permission logic in React risks drift.

### 4.10 Operational limits are deferred too late

Publication, manual input, URL response, PDF pages/bytes, normalized text, model context, and HTTP duration all depend on concrete limits. Those limits affect schema checks, errors, UI validation, tests, hosting viability, and cost. They must be frozen before implementation rather than discovered at release.

## 5. Mandatory Changes

The following changes are prerequisites for implementation approval.

### M1. Replace the circular/duplicated publication representation

Use one authoritative current-publication model. Recommended design:

- `knowledge_versions` owns immutable Company snapshots;
- `knowledge_version_sources` owns the immutable manifest;
- `company_knowledge_publications` has `company_id` as its primary key and one `knowledge_version_id`, actor, and timestamp, representing the current publication;
- optional append-only history is a separate `knowledge_publication_events` table only if a concrete audit requirement justifies it.

Do not add `companies.published_knowledge_version_id`. This avoids rebuilding `companies`, removes the circular foreign key, preserves Company as owner without making it the storage location for a Knowledge lifecycle pointer, and allows an atomic upsert/CAS inside a repository transaction. If history is retained, define one invariant and transaction that makes the current row authoritative.

### M2. Freeze a complete deterministic compilation contract

Before implementation, define and test a pure function from an ordered manifest of ready source revisions to `CompanyKnowledge`. It must specify:

- at most one revision per source in a version;
- exact ordering and Unicode/case/whitespace normalization;
- authoritative source for Company name, website, phone, and email;
- array and FAQ identity/deduplication rules;
- empty-value behavior;
- conflict classification and safe conflict response;
- hard field/item/snapshot limits;
- no aggregate AI merge that could invent or silently resolve facts.

Recommended rule: Company identity fields come from the current tenant-scoped Company record; source extraction contributes business facts and FAQs only. Non-empty conflicting FAQ answers or scalar business facts block publication until the manifest/source content is changed.

### M3. Resolve all schema- and contract-defining open questions

Before migrations, domain types, or routes are written, freeze:

- legacy backfill representation;
- identical snapshot/different manifest identity semantics;
- whether candidates exist independently of publication;
- PDF transport and parser;
- permission mapping;
- Company readiness semantics;
- raw-input retention policy;
- concrete size/count/time limits.

Recommended MVP choices: no persistent candidate separate from publish; direct migration version with a system-generated `manual_text` source marked by non-public `origin = migration`; a new version identity is based on its manifest plus compiled snapshot; raw PDF bytes are not retained; PDF uses route-local raw binary transport; Owner/Administrator publish; Company is operationally ready only when a current publication exists.

### M4. Make URL acquisition security an enforceable provider contract

Define `PublicUrlContentProvider` so an adapter is acceptable only if it can enforce or attest:

- HTTP(S)-only input;
- no credentials;
- public destinations for the initial URL and every redirect;
- redirect count;
- DNS/IP policy at actual fetch time;
- response byte/content-type/time limits;
- exactly one page, not a crawl.

Atlas prevalidation remains defense in depth, not proof of remote behavior. If Firecrawl cannot satisfy and test this contract, it must not be used for EPIC 012 URL ingestion; select another replaceable adapter or block that source type rather than weaken the control.

### M5. Specify PDF containment based on actual parser behavior

Complete the parser spike before implementation freeze. Record Node 24 ESM compatibility, license, maintenance/CVE status, byte/page/text ceilings, encrypted/scanned behavior, and whether parsing can be terminated. Do not claim cancellation when the library cannot provide it. If in-process parsing cannot meet an accepted CPU/memory risk envelope, use a bounded worker thread/process adapter or reject problematic inputs; do not add an external paid service by default.

### M6. Preserve trusted tenant and actor contexts separately

Keep ADR-008 `WorkspaceContext` unchanged. Introduce a separate immutable server-created `ActorContext` containing authenticated User ID and derived permissions/membership identity as needed. Routes authenticate and authorize, controllers translate input, services receive trusted contexts, and repositories persist actor IDs only from those contexts. No body/query/header actor field is accepted.

### M7. Define deletion and retention behavior end to end

Specify foreign-key actions and service behavior for:

- Company deletion with sources, revisions, manifests, versions, current publication, and optional history;
- archived sources referenced by published versions;
- User disable/delete with audit actor references;
- retention of normalized text and structured facts;
- exports/backups required by ADR-011.

Company-owned Knowledge should normally cascade as one aggregate graph when the authorized Company deletion use case runs. Audit actor references should preserve attribution without preventing legitimate Company deletion; immutable string actor snapshots or nullable foreign keys may be safer than `RESTRICT` to Users. Add an actual Company-delete regression test.

### M8. Simplify and define synchronous ingestion state

For this epic, one request may create an attempt, process it, and mark it ready/failed. Define a transaction boundary before and after provider I/O, never hold a SQLite transaction across external calls, and use a compare-and-swap terminal update so a late completion cannot overwrite a recovered/failed attempt. Recovery of abandoned attempts must be a deterministic service policy using the existing Clock abstraction. Do not imply durable background execution, leases, or automatic resumption.

### M9. Provide server-derived frontend capabilities

Do not independently reproduce the backend role-to-permission table in components. Either include a typed capability set in the authenticated Workspace representation or expose a server-derived authorization summary. The UI uses it only for affordances; every route still authorizes independently.

### M10. Define legacy endpoint transition without dual semantics

Choose one release behavior:

- adapt legacy onboarding to the new URL-source-and-publish use case while preserving its response contract; or
- deprecate and remove it in a separately approved compatibility change.

There must be one write path and one published read path. The old repository must not remain a mutable second source of truth. `/scrape` must not become an alternate unauthenticated ingestion route.

## 6. Recommended Changes

1. Rename the current-publication repository port to express the business projection, for example `PublishedCompanyKnowledgeReader`, rather than binding services to a storage concept.

2. Keep `KnowledgeSource`, `KnowledgeSourceRevision`, and `KnowledgeVersion` in a bounded `knowledge` module. Avoid adding new general-purpose types to `backend/src/types` unless they are truly cross-module contracts.

3. Collapse four proposed Knowledge services into three use-case-focused services if responsibilities remain clear: source commands/ingestion, publication, and queries. Avoid a service per noun.

4. Create source and attempt synchronously, but return a single stable DTO whose status is accurate. Do not use `201` to imply completed ingestion if provider processing is later made asynchronous.

5. Keep normalized text out of list responses. If review details are needed, add a separate permission-protected endpoint with strict response limits and `no-store` headers.

6. Store both a content digest and a compiler/schema version on revisions/versions. Deterministic outputs are only comparable when normalization, extraction schema, and compiler semantics are identified.

7. Prefer opaque public IDs for all new Knowledge resources, but do not expose sequential revision numbers as authority.

8. Treat parser/provider failure messages as non-persistent sensitive details; persist only enumerated codes and bounded operational metadata.

9. Make publication conflict review useful: return conflicting field identifiers and involved source IDs, not raw content or other tenant data.

10. Add an explicit maximum total published JSON byte size and validate it both before persistence and after deserialization to detect corruption.

11. Measure synchronous URL/PDF/extraction latency against the actual free hosting/request timeout before accepting the no-queue design.

12. Write one new ADR for the immutable source/version/publication model because ADR-004 approves the direction but does not define these operational semantics. The ADR should resolve the mandatory decisions rather than restating the plan.

## 7. Rejected Ideas

The following ideas are rejected for EPIC 012:

1. **Circular Company-to-Version and Version-to-Company foreign keys.** They add migration/deletion complexity and duplicate the current-publication invariant.

2. **Two mutable sources of publication truth.** A Company pointer and a separately queryable “current” publication record must not compete.

3. **AI-controlled aggregate merging or conflict resolution.** AI may extract candidate facts but cannot choose which conflicting fact becomes published authority.

4. **Atlas-only DNS validation as proof of Firecrawl fetch safety.** Validation of the initial URL does not constrain a remote provider's eventual destination.

5. **Unbounded or nominally timed-out in-process PDF parsing.** A Promise timeout without actual interruption is not resource containment.

6. **Frontend-derived authorization as the only capability source.** Client role mapping can improve display but cannot be the canonical permission model.

7. **Dual writes to `company_knowledge` and the versioned model.** Temporary read compatibility is acceptable; indefinite dual authority is not.

8. **Deleting the current publication when a refresh begins.** Existing known-good knowledge remains live until a replacement is explicitly published.

9. **Vector search, embeddings, mandatory chunking, or a vector database.** The bounded structured snapshot is sufficient for this epic.

10. **OCR, crawling, background queues, and durable raw-PDF storage.** None is necessary to prove the Company Knowledge foundation.

11. **Knowledge ownership by Assistant Profile or channel.** This violates accepted ownership and portability decisions.

12. **Provider or controller ownership of publication policy.** Publication is an application/domain rule.

## 8. Risks

| Risk | Severity | Required mitigation |
|---|---:|---|
| Cross-tenant knowledge disclosure | Critical | Mandatory trusted context, Company-scoped joins, generic `404`, repository and HTTP isolation tests. |
| Publishing invented or arbitrarily merged facts | Critical | Pure deterministic compiler, validated extraction schema, conflict blocking, no AI conflict resolution. |
| URL SSRF/redirect abuse | Critical | Enforceable actual-fetch adapter contract and adversarial tests; reject noncompliant adapter. |
| Loss of current knowledge during refresh/migration | Critical | Atomic current-publication change, preserved old publication, backup/restore rehearsal, logical snapshot comparison. |
| Publication state inconsistency | High | One authoritative current-publication row and one transactional CAS invariant. |
| PDF CPU/memory denial of service | High | Reviewed parser, hard byte/page/text limits, actual termination/isolation or explicit accepted envelope. |
| Prompt injection/data poisoning | High | Provider-owned grounding prompt, labeled untrusted input, strict structured validation, human publication. |
| SQLite write contention | Medium | Short transactions, no provider I/O inside transactions, busy behavior tests, CAS conflict responses. |
| Company deletion blocked by FK graph | High | Explicit aggregate deletion policy and schema-level cascade tests. |
| Historical content/privacy retention | High | Retention/export/deletion policy for normalized source text; never retain raw PDF implicitly. |
| Long synchronous HTTP requests | Medium–High | Measured hosting timeout budget, provider/parser limits, accurate terminal state, later queue decision if evidence requires it. |
| Legacy/new path divergence | High | One write use case and one published read projection; retire mutable legacy authority. |
| Model/context cost growth | Medium | Concrete publication limits, serialized-size check, observability, later retrieval ADR when thresholds are exceeded. |
| Dependency vulnerability/license issue | Medium–High | PDF parser spike, exact lock, security/license review, isolated adapter. |
| Permission/UI drift | Medium | Server-derived capability set and server-side authorization on every request. |

## 9. Final Architecture Decisions

The following decisions are frozen by this review, subject to the mandatory refinements above:

1. **APPROVED — Modular monolith.** Knowledge remains an internal bounded module in the existing backend deployment.

2. **APPROVED — Ownership.** Workspace is the tenant boundary; Company owns all Knowledge resources. Workspace ownership is derived through Company.

3. **APPROVED — Assistant separation.** Assistant Profiles consume but never own or publish Knowledge. All profiles for a Company share its current publication.

4. **APPROVED — Provider neutrality.** Acquisition, PDF parsing, fact extraction, and assistant generation remain replaceable infrastructure adapters behind application contracts.

5. **APPROVED WITH CHANGES — Source/revision model.** Sources are mutable identities; terminal revisions are immutable. The implementation must freeze retry/recovery and one-revision-per-source publication rules.

6. **APPROVED — Explicit publication.** Successful ingestion creates no runtime authority. Only an explicit authorized publication makes facts executable.

7. **APPROVED WITH CHANGES — Publication persistence.** Use one authoritative current-publication relation; reject the proposed Company pointer plus duplicate current history state.

8. **APPROVED — Immutable versions.** A published Knowledge Version is never edited. Corrections create new revisions and a new version.

9. **APPROVED WITH CHANGES — Compilation.** Compilation is deterministic application logic and blocks conflicts. Exact rules must be frozen before code.

10. **APPROVED — Retrieval.** Load the complete bounded structured current publication. No vector infrastructure is permitted in this epic.

11. **APPROVED — Execution integration.** Preserve `AssistantExecutionRequest`; pass published structured knowledge explicitly; keep the legacy FAQ shortcut out of Preview.

12. **APPROVED WITH CHANGES — URL source.** One public page only. The actual-fetch adapter must meet the security capability contract.

13. **APPROVED WITH CHANGES — PDF source.** Local text extraction, bounded input, no OCR, and no raw-PDF retention are accepted after parser/resource review.

14. **APPROVED — Manual source.** Manual text is normalized untrusted input, extracted into the common schema, revisioned, and explicitly published.

15. **APPROVED WITH CHANGES — Authorization.** Dedicated read/ingest/publish/archive permissions are justified. Server-derived mapping and separate actor context are mandatory.

16. **APPROVED WITH CHANGES — API.** Authenticated nested Workspace/Company routes are correct. Final shapes follow the simplified persistence/lifecycle decisions.

17. **APPROVED WITH CHANGES — Frontend.** Use dedicated Knowledge state, authoritative capabilities, abort/generation protection, accessible lifecycle states, and explicit publication review.

18. **APPROVED WITH CHANGES — Synchronous MVP ingestion.** Accepted only with measured request budgets, short transactions, deterministic late-completion behavior, and no claim of durable background execution.

19. **APPROVED WITH CHANGES — Migration.** Append-only backfill must preserve logical knowledge exactly, avoid circular Company rebuild, choose one legacy representation, and prove Company deletion/integrity behavior.

20. **REJECTED — Dual source of truth.** The old mutable knowledge row cannot remain a concurrent writer after cutover.

## 10. Architecture Freeze Recommendation

Do not freeze the current Engineering Plan as the direct implementation contract. Freeze EPIC 012 only after all ten mandatory changes are resolved in an accepted Knowledge Publication ADR or a formally approved implementation specification.

The architecture may then proceed without another broad review if the resolution satisfies these gates:

- one non-circular authoritative current-publication model;
- deterministic merge/conflict rules with concrete bounds;
- actual-fetch URL security contract;
- reviewed and containable PDF parser;
- separate trusted tenant and actor contexts;
- defined deletion, retention, migration, and legacy cutover behavior;
- server-derived capabilities;
- measured synchronous execution budget;
- complete regression and migration tests.

Implementation must stop and return to Architecture Review if any adapter cannot meet the frozen security contracts, if the migration cannot preserve existing snapshots exactly, or if whole-snapshot limits are insufficient for the first validated customers.

APPROVED AFTER REQUIRED CHANGES
