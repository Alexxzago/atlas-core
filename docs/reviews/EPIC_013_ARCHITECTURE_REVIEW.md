# EPIC 013 - Architecture Review

**Review subject:** `docs/plans/EPIC_013_ENGINEERING_PLAN.md`  
**Review type:** Pre-implementation adversarial architecture review  
**Review status:** Complete

## 1. Executive summary

The plan identifies the correct architectural gap: authenticated operational execution must be distinct from trusted-local legacy Chat, select an explicit ready Company-owned Profile, use only published Company Knowledge, and traverse the provider-neutral execution contract under `chat:use`.

The core direction is consistent with ADR-013 and ADR-014. It is not ready for Architecture Freeze as written. Two Critical gaps undermine the promised authorization ordering and safe handoff guarantee. Six Major changes are required to make the execution boundary testable, capability-driven, bounded, and verifiable in actual application composition. The required changes preserve the proposed scope; they do not require Conversations, channels, persistence, Knowledge changes, or implicit Profile routing.

## 2. Scope review

The scope is minimal in its domain ambition. It creates one ephemeral request/response use case and explicitly excludes channel providers, Conversation state, message history, lead capture, analytics, retrieval changes, queues, and migrations. That preserves the current Company Knowledge and Profile boundaries.

The plan must not broaden into a generic channel abstraction. The operational service may be channel-neutral in its request contract, but it is an authenticated portal capability in this epic. WhatsApp, Instagram, email, and web-channel identity/routing remain future decisions.

**Observation - Scope is appropriately bounded.** The proposed explicit Profile contract prevents the epic from inventing a default Profile or channel-routing policy. ADR-013 requires explicit selection and intentionally has no default.

## 3. Findings

### Critical

#### CR-013-001 - Authorization does not precede JSON body parsing

- **Evidence:** The plan requires authorization before protected work and private/no-store outcomes (`docs/plans/EPIC_013_ENGINEERING_PLAN.md:132,235-240`). The current app installs global `express.json()` before all routers (`backend/src/app.ts:8,20`). The authorized wrapper only applies Session, CSRF, Origin, Fetch Metadata, membership, capability, and response headers later (`backend/src/routes/authorizedCompanies.ts:67-86`).
- **Risk:** Unauthorized, malformed, oversized, or adversarial JSON reaches the global parser before authorization. Parser failures can bypass the authorized router's generic concealment and private/no-store policy. This contradicts the plan's ordering guarantee and exposes unauthenticated resource consumption.
- **Required change:** Freeze an authorization-first parsing design for this endpoint. The operational route must not depend on the global JSON parser. Specify route-local parser placement after authorization, message/request byte limits, malformed JSON, unsupported media type, oversized body, cache headers, and generic concealment behavior. Add real-route tests proving the parser/controller are not invoked for unauthenticated, invalid-CSRF, invalid-Origin, and unauthorized requests.
- **Freeze impact:** Blocks Architecture Freeze.

#### CR-013-002 - The safe fallback is not enforced by the application

- **Evidence:** The plan promises the selected Profile fallback for unsupported facts and provider unavailability (`docs/plans/EPIC_013_ENGINEERING_PLAN.md:108,112,196,322`). Its proposed execution port returns provider-produced `AssistantExecutionResult` (`:75-81`). The existing result union permits arbitrary `safe_fallback.answer` text (`backend/src/assistant/application/assistantExecution.ts:29-32`).
- **Risk:** A replacement provider or agent can return `{ outcome: "safe_fallback", answer: "different text" }`. The proposed service only replaces `AnswerGenerationUnavailableError`; it does not normalize a returned fallback. The user-facing safe handoff would therefore depend on adapter behavior rather than approved Profile configuration.
- **Required change:** Make `safe_fallback` an application-owned outcome. Either remove its answer from the execution-port result or require `OperationalAssistantExecutionService` to replace every `safe_fallback` answer with `profile.fallbackMessage`. Define handling for empty/malformed results as a generic unavailable outcome or safe fallback, without leaking provider output. Add adversarial fake-port tests for mismatched fallback, empty answer, malformed result, and provider exception.
- **Freeze impact:** Blocks Architecture Freeze.

### Major

#### MA-013-001 - The execution port still leaves services coupled to the concrete agent

- **Evidence:** The plan requires Preview and operational execution to depend on `AssistantExecutionPort` (`docs/plans/EPIC_013_ENGINEERING_PLAN.md:75-85,323`). Current Preview imports both `AtlasAgent` and `freezeExecution` from `agents/atlas.ts` (`backend/src/assistant/services/assistantPreviewService.ts:1,8,23,47-60`); freezing is defined in the concrete agent module (`backend/src/agents/atlas.ts:41-57`).
- **Risk:** Replacing only the constructor dependency leaves an application service importing the concrete agent. A new operational service would either repeat that inversion or duplicate contract-freezing logic.
- **Required change:** Move immutable request construction/freezing to the Assistant application layer alongside `AssistantExecutionRequest`. Both Preview and operational services must use that application function and depend only on `AssistantExecutionPort`. `AtlasAgent` should implement the port and delegate to `AnswerGenerator`; it should not own application request construction.

#### MA-013-002 - The request-ID error and concealment policy is contradictory

- **Evidence:** The plan states invalid `assistantProfileId` is a `400` validation failure (`docs/plans/EPIC_013_ENGINEERING_PLAN.md:165`), while its error table groups invalid Profile conditions under generic `404` (`:191`). Existing Preview maps invalid route Profile IDs to not-found (`backend/src/assistant/services/assistantPreviewService.ts:70-74`).
- **Risk:** Implementers cannot consistently distinguish malformed request input from a syntactically valid absent/foreign resource. The resulting client and test behavior could leak scope or diverge across endpoints.
- **Required change:** Freeze one matrix: malformed body `assistantProfileId` is `400`; syntactically valid but absent, foreign, or Company-mismatched Profile IDs are indistinguishable generic `404`. Retain generic `404` for unauthorized scope before resource discovery. Cover every branch in real HTTP tests.

#### MA-013-003 - Frontend capability gating must not reuse role-derived Preview authorization

- **Evidence:** The plan requires `chat:use` capability gating (`docs/plans/EPIC_013_ENGINEERING_PLAN.md:207-215`). Current portal passes only `workspaceRole` to `AssistantProfilesPanel` (`frontend/src/components/AuthenticatedCompanyPortal.tsx:200`); Preview derives allowance from hard-coded roles (`frontend/src/components/AssistantProfilesPanel.tsx:7-13,72` and `frontend/src/state/assistantPreviewState.ts:28`). The portal already supplies capabilities to Knowledge UI (`AuthenticatedCompanyPortal.tsx:199`).
- **Risk:** A second role-to-permission mapping in frontend execution UI will drift from the server-derived `PermissionPolicy`. Server authorization remains authoritative, but the stated portal contract would be false and user controls could be misleading.
- **Required change:** Pass `WorkspaceSummary.capabilities` to the operational panel and gate only on `capabilities.includes("chat:use")`. Do not alter Preview authorization in this epic unless its own capability contract is separately approved. Add Viewer/Operator/Administrator/Owner capability-driven rendered tests.

#### MA-013-004 - Browser abort must be distinguished from provider cancellation

- **Evidence:** The plan requires abort and clearing on Workspace, Company, Profile, logout, and unmount (`docs/plans/EPIC_013_ENGINEERING_PLAN.md:210-213`). The proposed execution port has no cancellation parameter (`:75-81`). Current Gemini generation does not receive an abort signal (`backend/src/providers/gemini.ts:23-37`).
- **Risk:** Frontend abort prevents stale rendering but does not stop an already-started provider request containing prior Company Knowledge and customer input. Describing this as request cancellation overstates current behavior and masks cost/availability implications.
- **Required change:** Choose one explicit policy before implementation: either state that UI abort is presentation-only and test only stale-result suppression, or add cancellation as separate execution options outside immutable request data and propagate it through agent/provider. Do not put transport/runtime cancellation state into `AssistantExecutionRequest`. If cancellation is supported, test provider cancellation and disconnect behavior.

#### MA-013-005 - Live provider execution has no bounded abuse or concurrency policy

- **Evidence:** The plan creates an authenticated direct provider invocation (`docs/plans/EPIC_013_ENGINEERING_PLAN.md:116-130`) while adding no rate/concurrency control and no persistence/queue mechanism (`:45-52,274-276`). Messages may be 2,000 code points (`:165`).
- **Risk:** Any authorized Owner, Administrator, or Operator can issue unbounded costly calls. A compromised session can consume provider budget or exhaust in-process capacity. The risk increases when future channel adapters call the same service.
- **Required change:** Define a small server-owned, Workspace-aware operational execution budget for this ephemeral endpoint, including concurrency and/or rate behavior, safe failure response, and deterministic local tests. It must use trusted context, not client-supplied identifiers, and must not require a queue or Conversation persistence. If such a control cannot be established in scope, record an explicit approved operational/security exception before freeze.

#### MA-013-006 - Composition/mounting evidence is not sufficiently planned

- **Evidence:** The plan requires proving operational route composition and absence of local `/chat` in production (`docs/plans/EPIC_013_ENGINEERING_PLAN.md:297,353-355`). `app.ts` statically imports composition (`backend/src/app.ts:3`), and composition eagerly constructs the database-backed default Workspace, providers, and routers at module load (`backend/src/composition.ts:65-121`).
- **Risk:** Unit/router tests can pass while production assembly omits or miswires the new controller, or accidentally exposes local Chat. Current static composition makes fake-based production-mode assembly difficult.
- **Required change:** Add a testable app/composition verification strategy. Prefer a narrowly scoped factory or dependency-injected router/app construction only if needed to test the actual mount. At minimum, prescribe an integration test that proves production-mode absence of `/chat`, registration of the nested operational route, `chat:use` wiring, and no real Gemini invocation.

### Minor

#### MI-013-001 - Test-script updates are mandatory, not conditional

- **Evidence:** The plan makes script edits conditional (`docs/plans/EPIC_013_ENGINEERING_PLAN.md:265`). Backend `test` explicitly enumerates files (`backend/package.json:7`), as does frontend `test` (`frontend/package.json:10`).
- **Risk:** New EPIC 013 test files will not run under the required verification commands.
- **Required change:** Name the exact backend and frontend EPIC 013 test files during implementation planning and include script changes as required scope.

#### MI-013-002 - The API client needs response-shape validation

- **Evidence:** The API client casts successful JSON directly (`frontend/src/api/atlasApi.ts:48-49`). The plan adds a result type but does not require runtime validation (`docs/plans/EPIC_013_ENGINEERING_PLAN.md:262-263`).
- **Risk:** A malformed server/proxy response could render undefined or unexpected customer-facing content.
- **Required change:** Validate the exact operational response shape at the API boundary: allowed status union and bounded string answer. Convert invalid response data to the existing generic temporary-unavailable UI state and test it.

#### MI-013-003 - The no-sensitive-logging rule needs an executable implementation boundary

- **Evidence:** The plan prohibits logging customer/provider-sensitive content (`docs/plans/EPIC_013_ENGINEERING_PLAN.md:241`). Current Preview logs unexpected errors directly (`backend/src/controllers/assistantPreviewController.ts:40`).
- **Risk:** Copying the Preview controller pattern can log provider errors that contain prompt fragments, customer input, or Knowledge.
- **Required change:** Specify no controller error logging for this endpoint, or safe structured metadata only. Do not log exception objects that may contain provider payloads. Add an appropriate test or logger-fake assertion if a logger is introduced.

### Observations

#### OB-013-001 - The route shape is appropriate

`POST /workspaces/:workspaceId/companies/:companyId/assistant/executions` correctly treats the request as an ephemeral execution command rather than a persisted Chat/Conversation resource. The explicit `assistantProfileId` in the body is appropriate because the route already establishes trusted Workspace/Company scope. Do not move Profile selection into a default or a route segment unless a future routing policy requires it.

#### OB-013-002 - Extending the execution contract is preferable to creating another contract

Adding an explicit `operational_execution` purpose preserves ADR-013's immutable, request-scoped, provider-neutral contract. A second execution contract would duplicate behavior, grounding, and provider translation. The extension must retain no Workspace/actor/provider/prompt data and must use application-owned freezing as required by MA-013-001.

#### OB-013-003 - Published Knowledge integration is correct

`KnowledgeRepositoryPort.load` is the right dependency: its released implementation delegates to `CompanyKnowledgeRepository.loadPublished` (`backend/src/repositories/knowledgeRepository.ts:8-13`). The plan correctly excludes source/revision access and Knowledge changes. No alternate runtime reader may be introduced.

#### OB-013-004 - Preview and operational UI should remain separate bounded components

They may share presentation primitives and execution-result types, but Preview is an administrative `assistant:preview` operation while operational execution is `chat:use`. Separate state/components avoid merging capability semantics, endpoint contracts, and user intent. They must share the backend execution port/request builder rather than share authorization UI logic.

#### OB-013-005 - Future channel compatibility remains sound within stated bounds

An operational service that accepts an explicit ready Profile and immutable execution request can be called by future WhatsApp, Instagram, email, or web adapters without rewriting provider execution or Knowledge grounding. Each channel will still require a separately accepted identity, authorization, rate-control, and Profile-routing policy. EPIC 013 must not introduce those policies implicitly.

## 4. Dependency direction review

The intended post-change direction is valid:

```text
Authorized route -> controller -> OperationalAssistantExecutionService
  -> Company/Profile/published-Knowledge ports
  -> AssistantExecutionPort -> AtlasAgent -> AnswerGenerator provider
```

This preserves repository-only SQLite access and provider-only external I/O. The current design contains two relevant inversions that the plan must fix or avoid:

1. Preview imports concrete `AtlasAgent` for both execution and request freezing. MA-013-001 requires moving construction to the Assistant application layer and injecting the port.
2. The new service must not import Gemini, `AnswerGenerator`, `CompanyKnowledgeRepository`, route authentication services, Express types, or `WorkspaceResolver`. Those dependencies belong respectively to composition/provider, application repository port, route boundary, and controller/route construction.

Legacy `ChatService` may retain its concrete-agent compatibility dependency only if it is isolated from the new operational path. EPIC 013 must not copy it into the Assistant module.

## 5. Required changes before Architecture Freeze

1. Define authorization-first JSON parsing, request/media/size failure behavior, and executable parser-order evidence for the new endpoint.
2. Make every `safe_fallback` application-owned and equal to the selected Profile fallback; define invalid provider-result handling.
3. Move immutable execution-request freezing into the Assistant application layer and make Preview/operational services depend only on `AssistantExecutionPort`.
4. Resolve the malformed-versus-absent/foreign `assistantProfileId` status matrix and test concealment.
5. Require frontend `chat:use` capability gating from server-derived capabilities, without a frontend role mapping.
6. Define whether provider cancellation is supported; accurately scope browser abort if it is presentation-only, or add separate cancellation options and propagation.
7. Define a trusted Workspace-aware execution rate/concurrency policy or obtain an explicit approved exception.
8. Add an actual production-composition/mounting verification strategy.
9. Make exact EPIC 013 backend/frontend test files and corresponding explicit package-script updates mandatory.
10. Require frontend operational response validation and safe logging behavior.

## 6. Architecture decision assessment

No new ADR is required if the required changes remain within the existing model: explicit Profile selection, ephemeral execution, published-only Knowledge, existing `chat:use`, one immutable execution contract, and provider-neutral execution.

An ADR is required before implementation only if resolving MA-013-005 introduces a durable shared rate-limit store or policy that materially changes tenant operational guarantees, or if any required change introduces default Profile routing, durable executions, channel identity/routing, provider/model selection, or a second execution contract.

## 7. Review conclusion

**APPROVED WITH REQUIRED CHANGES**

The plan's core architecture is approved conditionally. Critical findings CR-013-001 and CR-013-002 block Architecture Freeze. All Major findings must be incorporated into the Engineering Plan and supported by the specified evidence before implementation begins. No code, freeze, or ADR is authorized by this review.
