# EPIC 013 - Pre-Implementation Review

**Status:** Complete  
**Review scope:** Current repository implementation only  
**Code changes:** None

## 1. Current module responsibilities

### Application

`backend/src/application/ports/repositories.ts` defines the cross-module Company and published-Knowledge repository contracts. It is intentionally small and contains no use cases or implementations. `KnowledgeRepositoryPort` is read-only and exposes the published projection only.

- Dependencies: shared domain types and `WorkspaceContext`.
- Public entry points: `CompanyRepositoryPort` and `KnowledgeRepositoryPort`.
- Maturity: stable shared contracts, but not a complete application layer. Identity, Workspace, Assistant, and Knowledge define additional application ports inside their own modules.

### Assistant

`backend/src/assistant/` owns Assistant Profile domain validation, lifecycle policy, persistence port, profile service, immutable execution request, and administrative Preview use case. `backend/src/agents/atlas.ts` is the current execution facade over an `AnswerGenerator`.

- Dependencies: Company and published-Knowledge ports, Assistant Profile port/domain, and the concrete `AtlasAgent`.
- Public entry points: `AssistantProfileService`, `AssistantPreviewService`, Assistant Profile controllers, Preview controller, and `AssistantExecutionRequest`.
- Maturity: profile administration and authenticated Preview are implemented. Operational assistant execution is not implemented as an authenticated, channel-neutral capability.

### Identity

`backend/src/identity/` owns User lifecycle, credential enrollment, registration, email verification, authentication, opaque Sessions, CSRF rotation/bootstrap, origin policy, password hashing, clocks, and delivery ports.

- Dependencies: identity transaction/ports, security providers, clock, verification delivery, and HTTP controllers/routes.
- Public entry points: `RegistrationService`, `VerifyEmailService`, `ResendEmailVerificationService`, `AuthenticationService`, `/identity` routes, and identity controller factories.
- Maturity: implemented and used by Workspace and authorized routes. It has independent domain/application/infrastructure separation.

### Knowledge

`backend/src/knowledge/` owns Company Knowledge source/revision/version/publication lifecycle, deterministic compilation, input policy, provider ports, and URL/PDF infrastructure adapters. `CompanyKnowledgeRepository` owns the SQLite implementation.

- Dependencies: Company repository port, trusted `WorkspaceContext`, separate `ActorContext`, Knowledge ports, clock, and injected acquisition/extraction adapters.
- Public entry points: `KnowledgeService`, Knowledge domain/compiler types, controller factory, authenticated nested Knowledge routes, `CompanyKnowledgeRepository`, `SecurePublicUrlProvider`, and `WorkerPdfTextExtractor`.
- Maturity: the most complete domain module. Its source-to-publication path, concurrency controls, migration cutover, and published runtime projection are implemented.

### Workspace

`backend/src/workspace/` owns Workspace administration, Memberships, invitations, role-to-capability derivation, authorization decisions, and trusted Workspace resolution.

- Dependencies: Workspace administration transaction/repository ports, invitation/clock providers, User repository, Identity authentication service, and Workspace repository.
- Public entry points: `WorkspaceAdministrationService`, `AuthorizationService`, `WorkspaceResolver`, Workspace controllers/routes, membership domain policy, and `WorkspaceContext`.
- Maturity: implemented tenant and authorization foundation. It is the authority boundary for authenticated Company, Assistant, and Knowledge operations.

### Providers and infrastructure adapters

`backend/src/providers/` contains the Gemini and Firecrawl adapters plus Gemini prompts. Infrastructure adapters belonging to specific domains are located in `identity/infrastructure`, `workspace/infrastructure`, and `knowledge/infrastructure`.

- Dependencies: external SDKs, environment configuration, and domain/application port types.
- Public entry points: `geminiProvider`, `GeminiKnowledgeFactExtractor`, `firecrawlProvider`, request-origin policy, delivery adapters, `SecurePublicUrlProvider`, and `WorkerPdfTextExtractor`.
- Maturity: adapters are generally injected through ports. Gemini remains a combined generation/extraction adapter, while Firecrawl remains only on legacy scrape wiring.

### Controllers and routes

Controllers translate HTTP input/output and map domain/application failures. Routes mount either compatibility endpoints or authenticated Workspace-scoped endpoints.

- Dependencies: services/controller factories and Express only.
- Public entry points: `backend/src/routes/*.ts`, especially `authorizedCompanies.ts`, `identity.ts`, and `workspaces.ts`.
- Maturity: authenticated management routes consistently establish identity, Workspace, actor, capability, CSRF, Origin, and Fetch Metadata before protected handlers. Legacy local routes remain separately mounted.

### Repositories

`backend/src/repositories/` owns SQLite persistence for Company, Workspace, Membership, User, Identity, Assistant Profile, and Company Knowledge data, plus transaction implementations.

- Dependencies: `node:sqlite`, repository ports, and application/domain types.
- Public entry points: repository instances or classes composed in `composition.ts`.
- Maturity: Company-owned queries are Workspace-scoped. Knowledge publication is transaction-owned by `CompanyKnowledgeRepository`. `markdownDebugRepository.ts` is a filesystem adapter despite its repository location.

### Legacy/general services

`backend/src/services/` contains Company CRUD, compatibility published-Knowledge read, Chat, onboarding, scrape, Markdown cleaning, and legacy knowledge validation/building.

- Dependencies: application ports, legacy provider interfaces, and the frozen Knowledge service for onboarding.
- Public entry points: `CompanyService`, `ChatService`, `OnboardingService`, `ScrapeService`, and compatibility `KnowledgeService`.
- Maturity: Company CRUD is active. Chat, scrape, and parts of onboarding are compatibility paths. The operational Knowledge lifecycle is correctly in `backend/src/knowledge/`, not this directory.

### Composition and application assembly

`backend/src/composition.ts` is the composition root. It constructs adapters/services and exports route instances. `backend/src/app.ts` mounts global routes, compatibility local-mode routes, identity, Workspace, and authorized Company routes.

- Dependencies: every composed module.
- Public entry points: exported Express routers and the default app.
- Maturity: all production wiring is centralized, but it visibly contains both current authenticated flows and legacy trusted-local flows.

## 2. Assistant module

### Current architecture

Assistant Profiles are Company-owned persisted aggregates with `draft`, `ready`, `disabled`, and `archived` states. `AssistantProfileService` validates DTOs, normalizes fields, applies readiness/lifecycle policies, and delegates persistence through `AssistantProfileRepositoryPort` (`backend/src/assistant/services/assistantProfileService.ts`).

`AssistantPreviewService` is the only authenticated execution use case. It resolves a Company and explicit Profile in trusted Workspace scope, requires a ready Company and executable Profile, loads published Knowledge, constructs an immutable request, and calls the agent (`backend/src/assistant/services/assistantPreviewService.ts:26-60`).

`AssistantExecutionRequest` is deliberately minimal: `purpose`, behavior, published structured knowledge, and message. Its currently permitted purposes are only `preview` and `legacy_chat` (`backend/src/assistant/application/assistantExecution.ts:22-27`). `AtlasAgent` freezes the request and delegates provider execution. Legacy chat retains an exact-FAQ shortcut before provider execution (`backend/src/agents/atlas.ts:10-38`).

### Implemented files

- `assistant/domain/assistantProfile.ts`: Profile value types and reconstruction.
- `assistant/domain/assistantProfilePolicies.ts`: readiness and lifecycle rules.
- `assistant/application/ports.ts`: Assistant Profile repository contract.
- `assistant/application/assistantExecution.ts`: provider-neutral execution contract/result types.
- `assistant/services/assistantProfileService.ts`: Profile commands and queries.
- `assistant/services/assistantPreviewService.ts`: authenticated Preview orchestration.
- `repositories/assistantProfileRepository.ts`: SQLite persistence.
- `controllers/assistantProfileController.ts` and `assistantPreviewController.ts`: HTTP translation.
- `routes/authorizedCompanies.ts`: authenticated Profile and Preview route registration.

### Missing or incomplete ideas

- No authenticated operational chat endpoint uses the existing `chat:use` permission. That capability is derived in `workspace/domain/membership.ts`, but no authorized route consumes it.
- No channel-neutral operational execution use case exists. The only runtime consumer besides Preview is the trusted-local legacy chat route.
- No Profile selection/routing policy exists for operational execution. Preview takes an explicit Profile ID; legacy chat uses a hardcoded behavior object and does not select a Profile.
- No channel adapter, Conversation, message persistence, handoff state, or channel identity model exists.
- The authenticated portal exposes Preview but does not expose the legacy `ChatPanel`; that panel belongs to the trusted-local Company workspace UI.

### Obsolete or compatibility code

- `legacy_chat` in `AssistantExecutionRequest` and the hardcoded behavior in `AtlasAgent.answer` are compatibility behavior, not the Profile-based model.
- `ChatService`, `chatController.ts`, and `routes/chat.ts` depend on trusted default Workspace composition and are mounted only when `ATLAS_TRUSTED_LOCAL_MODE=true` outside production (`app.ts:16-17`).

### Architectural fit

Preview follows the intended boundaries for persistence and provider execution: it uses repository ports, passes Knowledge explicitly, and delegates translation to the provider through the agent. However, `AssistantPreviewService` and `ChatService` depend on concrete `AtlasAgent` rather than an execution port. The assistant module therefore fits the architecture for administrative Preview but is incomplete for the intended operational/channel-facing architecture.

## 3. Knowledge module

### Lifecycle and publication

Knowledge has a mutable source identity, immutable source revisions, immutable Company Knowledge Versions, and one current-publication row per Company. `KnowledgeService` reserves a pending revision in a short transaction, performs URL/PDF/extraction work outside SQLite, then terminally completes or fails only that pending revision. It publishes exact ready revision IDs through the deterministic compiler and repository compare-and-swap transaction (`knowledge/services/knowledgeServices.ts:16-20`).

The compiler derives Company identity from the Company record, canonicalizes and sorts arrays, removes exact duplicates, rejects conflicting hours and FAQ answers, validates bounds, and hashes the canonical manifest/snapshot (`knowledge/domain/compiler.ts:8-44`). A ready revision is not executable until explicit publication.

`CompanyKnowledgeRepository.publish` is the sole production publication writer. It rechecks state in a `BEGIN IMMEDIATE` transaction, allocates a Company-local version, writes version/manifest/current-publication state, applies expected-current CAS, and preserves idempotency/historical digest rules.

### Runtime usage

The compatibility `KnowledgeRepository` is read-only and delegates to `CompanyKnowledgeRepository.loadPublished`. Chat and Preview receive this published projection; they cannot load latest sources or revisions. Preview always traverses the execution contract. Legacy Chat retains only its exact-FAQ optimization before invoking the provider.

### Extension points

- `PublicUrlContentProvider` for actual-fetch-constrained public URL acquisition.
- `PdfTextExtractor` for bounded PDF text extraction.
- `KnowledgeFactExtractor` for provider-neutral fact extraction.
- `KnowledgeRepositoryPort` for source, revision, publication, and published-read persistence.
- The bounded published structured snapshot is the existing execution integration point.

No retrieval, embeddings, vector store, queue, scheduled refresh, source sharing, Assistant-owned selection, or raw-file storage extension exists today.

## 4. Workspace

Workspace is the tenant and administrative authority boundary. Authenticated nested routes establish authority in this order: Session authentication, User lookup, Workspace membership/permission decision, trusted Workspace resolution, and separate ActorContext construction (`routes/authorizedCompanies.ts:63-86`). Client input supplies a workspace public ID for routing but does not establish authority.

Repositories derive Company-owned scope from `companies.workspace_id = ?` plus Company identity. Knowledge never stores a duplicate workspace ID. Assistant Profile repository operations and Knowledge repository operations use the same Company-through-Workspace scoping.

Workspace capabilities are server-derived from membership role. All roles can read Knowledge; Owner and Administrator publish/archive; Operator ingests; Viewer is read-only. The frontend receives capabilities as affordances, while routes remain authoritative.

Knowledge management APIs require the authenticated nested Workspace/Company route, capability check, and mutation protections. Assistant Preview follows the same nested authorization route. By contrast, compatibility chat/onboarding/Company routes use a default trusted Workspace and are only mounted in trusted-local mode. `/scrape` remains mounted globally and has no Workspace authority.

## 5. Provider layer

### Current adapters

- `providers/gemini.ts`: Gemini answer generation, legacy extraction support, and `GeminiKnowledgeFactExtractor`. It turns the execution request into a provider prompt and receives Knowledge explicitly.
- `providers/firecrawl.ts`: Firecrawl website scraping for the legacy scrape service and legacy-onboarding constructor path.
- `knowledge/infrastructure/publicUrlProvider.ts`: direct Node HTTP(S) one-page acquisition with public-address, redirect, type, size, timeout, and abort controls. This is the active EPIC 012 URL ingestion path, not Firecrawl.
- `knowledge/infrastructure/pdfTextExtractor.ts`: bounded `pdfjs-dist` worker parser with structural rejection before worker construction.
- Identity and Workspace infrastructure: cryptography, clocks, origin policy, verification delivery, and invitation delivery adapters.

### Replaceability and coupling

The new Knowledge and identity/workspace adapters are behind focused ports. Gemini implements multiple responsibilities, but callers use `AnswerGenerator` or `KnowledgeFactExtractor` contracts. The execution request contains no provider choice, credential, repository, tenant authority, or prompt.

Legacy coupling remains in `OnboardingService`: composition still injects Firecrawl, Gemini, Markdown cleaning, and a file debug store even though the active frozen onboarding flow delegates to `KnowledgeService`. This broadens the compatibility constructor and obscures the active dependency graph. Firecrawl is not an EPIC 012 URL provider.

## 6. Dependency direction

### Verified conformance

- Controllers delegate to services/use cases and do not access SQLite directly.
- SQLite access is centralized in repositories and transaction adapters.
- Knowledge providers/parsers do external I/O and do not receive repositories, trusted tenant context, or actor authority.
- Knowledge lifecycle policy is in the Knowledge service/domain, not in its controller or provider.
- Workspace authorization is established before protected resource handling, including raw PDF parsing.

### Violations and boundary weaknesses

1. `identity/services/registrationService.ts` imports `NormalizedEmailAlreadyExistsError` from the concrete `repositories/userRepository.ts`. A service depends on a repository implementation/error type instead of an application port error contract.
2. `assistant/services/assistantPreviewService.ts` and `services/chatService.ts` depend on concrete `AtlasAgent`. The agent has no execution port, so those services are coupled to a concrete orchestration implementation.
3. `repositories/markdownDebugRepository.ts` writes files rather than persisting application state. It is an infrastructure adapter placed in the repositories directory and is still composed into onboarding.
4. Authentication/Origin/CSRF handling is repeated across `authorizedCompanies.ts`, `workspaceAdministrationController.ts`, and identity controllers. This is a boundary duplication rather than direct layer inversion, but it creates security-policy drift risk.
5. The legacy trusted-local route tree bypasses the authenticated Workspace route tree by design. It must not be extended as a production authority path.

## 7. Duplicated business logic and responsibilities

- Legacy onboarding still has legacy scraping/extraction/debug dependencies alongside the active combined Knowledge ingest-and-publish flow. The active path must be distinguished from dead compatibility collaborators before any new operational flow reuses onboarding.
- URL normalization exists in Company/onboarding validation and in Knowledge safe URL acquisition. These are not equivalent concerns: Company website validation is business input validation; Knowledge URL validation is SSRF protection. They must not be casually unified without preserving the stricter acquisition contract.
- Authenticated route protection and response policy are implemented in multiple places. Inconsistent future changes could alter CSRF, Origin, cache, or concealment behavior.
- Two UI surfaces overlap on Company operations: the authenticated Workspace portal and the trusted-local Company workspace. Chat and onboarding presentation remain in the latter, while Knowledge/Profile management lives in the former.

## 8. Technical debt relevant to EPIC 013

1. There is no authenticated operational assistant entry point. The existing `chat:use` capability, published Knowledge reader, Profile model, and provider execution contract do not form a public runtime use case.
2. Runtime Profile selection is unspecified and unimplemented. A default Profile must not be inferred because current Profile behavior deliberately requires explicit selection.
3. Legacy chat contains behavior policy and an exact-FAQ path outside Profile-based execution. Reusing it for an authenticated runtime would silently introduce an implicit Profile policy.
4. `OnboardingService` retains inactive legacy dependencies in composition. Extending it without first tracing the active branch risks reintroducing a second Knowledge ingestion/write path.
5. Globally mounted `/scrape` invokes Firecrawl outside authenticated Workspace scope and outside the current published-Knowledge lifecycle. It is not a safe foundation for new Company-aware operations.
6. The root package test command is a placeholder; verification must run separately from `backend/` and `frontend/`.

## 9. EPIC 013 recommendation

The source does not define EPIC 013 product requirements, so this review cannot assert a definitive feature scope. If EPIC 013 is intended to introduce authenticated Company-aware operational assistant execution, the smallest evidence-based scope is an authorized runtime use case that reuses the published Knowledge reader and immutable execution contract without changing Knowledge publication semantics.

### Likely files to modify

- `backend/src/routes/authorizedCompanies.ts`: consume `chat:use` in a nested Company route only.
- `backend/src/controllers/chatController.ts`: add a controller factory that receives trusted Workspace/Actor context instead of local default context.
- `backend/src/services/chatService.ts`: reshape or replace legacy-only orchestration only after explicit Profile-selection requirements exist.
- `backend/src/agents/atlas.ts`: remove legacy behavior assumptions only if the new use case can provide an explicit execution behavior safely.
- `backend/src/composition.ts` and `backend/src/app.ts`: compose the authorized route without broadening trusted-local compatibility behavior.
- `frontend/src/api/atlasApi.ts` and `frontend/src/components/AuthenticatedCompanyPortal.tsx`: integrate only an authenticated runtime endpoint.
- Focused backend and frontend tests for authorization, tenant concealment, published-only grounding, Profile execution eligibility, and stale client requests.

### Files to create only when requirements require them

- An Assistant execution port implemented by `AtlasAgent`, if EPIC 013 needs services to avoid concrete-agent coupling.
- A Profile selection/routing policy/service, but only after the product specifies whether a caller selects a Profile or a new explicit routing rule is accepted.
- A bounded authenticated operational-chat component/state module, if the frontend scope includes customer interaction.

### Files that must remain untouched unless requirements prove otherwise

- `backend/src/knowledge/domain/*`, `knowledge/services/*`, `knowledge/infrastructure/*`, and Knowledge migrations: current publication lifecycle and security controls are not a runtime-routing concern.
- `backend/src/repositories/companyKnowledgeRepository.ts`: preserve the single publication writer and published reader invariants.
- Workspace tenant resolver, membership policy, and Identity Session/CSRF primitives: reuse rather than reimplement them.
- `assistant/application/assistantExecution.ts`: preserve its provider-neutral/minimal shape unless a validated execution capability cannot be represented by existing structured fields.

## 10. Risks for an EPIC 013 audit

1. Adding a runtime route outside authenticated Workspace/Company nesting would violate tenant isolation and make `chat:use` meaningless.
2. Allowing a body, query, or frontend state value to establish Workspace, actor, Company ownership, or Profile authority would violate the trusted-context boundary.
3. Reading source revisions, latest revisions, or unpublished drafts at runtime would violate published-only Knowledge behavior.
4. Selecting a default Profile implicitly, or continuing legacy hardcoded behavior under a Profile-branded route, would contradict the explicit Profile lifecycle and execution model.
5. Allowing providers or agents to load Knowledge, choose tenants, or choose Profiles would break provider neutrality and repository ownership.
6. Duplicating Chat/Preview execution request construction could drift grounding, fallback, or provider behavior. One explicit execution path is required.
7. Extending legacy onboarding, `/scrape`, or `company_knowledge_legacy` as a shortcut would create an alternate Knowledge lifecycle or runtime read path.
8. Adding a channel abstraction without a confirmed channel contract risks implementing Conversations, channel credentials, message persistence, or provider-specific state outside the bounded current architecture.
9. Failing to cover role authorization, cross-Workspace concealment, CSRF/Origin protections, safe failure behavior, published-only grounding, and frontend stale-context handling would leave audit-critical evidence gaps.
10. Treating the pre-existing uncommitted ADR-014 files as committed baseline would make review/verification results unreliable.

## Review conclusion

Atlas currently has a strong authenticated administrative foundation, a complete Company Knowledge publication lifecycle, and a Profile-based Preview path. Its missing architectural bridge is not Knowledge persistence or provider execution: it is a scoped, authenticated operational assistant use case with an explicit Profile-routing decision. No implementation or design decision is made by this review.
