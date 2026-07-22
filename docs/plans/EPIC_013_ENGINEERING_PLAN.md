# EPIC 013 - Operational Assistant Execution Engineering Plan

**Status:** Reconciled after Architecture Review  
**Scope:** Engineering plan only; no implementation is included  
**Repository baseline inspected:** 2026-07-22

## 1. Objective

Introduce the smallest authenticated, Company-aware, channel-neutral operational Assistant execution capability. The capability closes the gap between administrative Preview and a real operational request while reusing the existing Company-owned Assistant Profile, published Company Knowledge reader, immutable Assistant Execution Contract, Atlas Agent/provider adapter, Workspace authority boundary, and authenticated portal.

The capability is an ephemeral request/response operation. It does not introduce a channel provider, Conversation, history, memory, lead capture, analytics, or durable execution record.

## 1.1 Architecture Review reconciliation

The following Architecture Review findings are incorporated by this plan. No Critical or Major finding is deferred.

| Finding | Reconciled design decision |
|---|---|
| CR-013-001 | The operational endpoint is excluded from global JSON parsing. Its route-local JSON parser runs only inside the already-authorized continuation, with explicit media, byte, malformed-body, header, and parser-order evidence. |
| CR-013-002 | `safe_fallback` is normalized by the operational application service to the selected Profile fallback for every port fallback, empty answer, malformed result, or provider-unavailable outcome. |
| MA-013-001 | Request freezing moves to the Assistant application layer. Preview and operational services import that application builder and depend only on `AssistantExecutionPort`. |
| MA-013-002 | Malformed body Profile IDs are `400`; syntactically valid absent, foreign, or Company-mismatched IDs are concealed `404`. |
| MA-013-003 | The operational UI gates solely on server-derived `capabilities.includes("chat:use")`; it adds no frontend role mapping. |
| MA-013-004 | EPIC 013 defines browser abort as presentation-only. It clears/suppresses stale UI results but does not claim cancellation of an already-started provider operation. |
| MA-013-005 | A process-local, trusted-Workspace execution budget limits concurrent and rate-window operational calls without persistence, queues, or client-supplied scope. |
| MA-013-006 | App assembly gains a narrowly testable router-injection boundary so production-mode mounting and local Chat absence can be verified without Gemini calls. |

## 2. Current state

EPIC 011 provides Company-owned Assistant Profiles and an authenticated Preview operation. Preview resolves a Company and an explicit Profile in trusted `WorkspaceContext`, requires a ready Company and executable Profile, loads the published Company Knowledge projection, freezes an `AssistantExecutionRequest`, and delegates it to `AtlasAgent` (`backend/src/assistant/services/assistantPreviewService.ts`).

EPIC 012 makes `KnowledgeRepositoryPort.load(context, companyId)` a published-only read. The compatibility `KnowledgeRepository` delegates to `CompanyKnowledgeRepository.loadPublished`, so Preview and legacy Chat cannot read source revisions, drafts, or an unpublished candidate (`backend/src/repositories/knowledgeRepository.ts`).

`chat:use` is already a server-derived Workspace capability for Owner, Administrator, and Operator. It is not yet consumed by an authenticated route (`backend/src/workspace/domain/membership.ts`). The only current Chat route is `POST /chat`, uses the default trusted Workspace, accepts `companyId` in the body, and is mounted only in non-production trusted-local mode (`backend/src/routes/chat.ts`, `backend/src/controllers/chatController.ts`, and `backend/src/app.ts`). It cannot become the production authority path.

The immutable execution contract currently has only `preview` and `legacy_chat` purposes. `AtlasAgent` is the concrete execution facade and is injected directly into both Preview and legacy `ChatService`. This leaves services coupled to a concrete agent (`backend/src/assistant/application/assistantExecution.ts`, `backend/src/agents/atlas.ts`).

The authenticated frontend has Workspace/Company/Profile selection and a Preview panel with abort, stale-response, and accessibility behavior. It has no operational execution panel (`frontend/src/components/AuthenticatedCompanyPortal.tsx`, `frontend/src/components/AssistantPreviewPanel.tsx`).

## 3. Problem statement

Atlas has all data and security prerequisites for a Company-aware Assistant response, but no authenticated operational use case binds them together under `chat:use`. Promoting legacy local Chat would bypass Workspace authority, accepts Company identity as ordinary body input, hardcodes behavior instead of selecting an executable Profile, and preserves a legacy exact-FAQ branch.

EPIC 013 must create one explicit operational request path without changing Knowledge publication, Assistant Profile lifecycle, authorization design, or provider grounding rules.

## 4. Scope

### In scope

- An ephemeral `OperationalAssistantExecutionService` in the Assistant module.
- An `AssistantExecutionPort` that represents execution of the existing immutable request/result contract and is implemented by `AtlasAgent`.
- Explicit caller-supplied Assistant Profile selection.
- A Workspace/Company nested authenticated POST endpoint protected by existing `chat:use`.
- Published-Knowledge-only grounding through the existing read-only repository port.
- A provider-neutral response based on the existing `answered | safe_fallback` result union.
- Safe provider-unavailable and unsupported-fact handoff behavior.
- A bounded process-local operational execution budget derived from trusted Workspace scope.
- Authenticated portal integration for selected Company/Profile execution, with abort and stale-context protection.
- Backend and frontend test coverage for authorization, tenant concealment, Profile eligibility, grounding, error behavior, and request lifecycle.

### Non-goals

- WhatsApp or any concrete channel provider.
- Conversation persistence, messages, history, memory, handoff state, lead capture, automatic follow-up, analytics, CRM, calendars, or payments.
- Embeddings, vector search, queues, scheduled refresh, or Knowledge lifecycle/migration changes.
- Workspace authorization redesign, Profile lifecycle redesign, or an implicit/default Profile.
- Prompt persistence, provider/model selection, provider credentials in requests, or provider-owned tenant selection.
- Production deployment.
- Removal of trusted-local Chat unless a narrowly required coexistence safeguard is discovered during implementation.

## 5. Architecture

### 5.1 Operational use case

`OperationalAssistantExecutionService.execute(context, companyId, input)` will be the sole new business use case. Its responsibility is to:

1. validate the request DTO;
2. resolve the Company inside the already trusted Workspace context;
3. resolve the requested Profile through that Company and context;
4. require the existing `AssistantProfileExecutionPolicy`;
5. require a ready Company and load only `KnowledgeRepositoryPort.load(context, companyId)`;
6. map Profile behavior and published Knowledge to the existing immutable execution request;
7. call an `AssistantExecutionPort`;
8. apply the trusted Workspace execution budget before provider invocation;
9. normalize every port `safe_fallback`, empty/malformed port result, and `AnswerGenerationUnavailableError` to the selected Profile's safe fallback result; and
10. return no persistence side effects.

The service must not accept Workspace authority, actor identity, Company ownership, provider, prompt, model, Knowledge, or Profile configuration from the body. Route authorization establishes identity, Workspace, actor, and capability before the controller invokes the service.

### 5.2 Execution port

Add a narrow Assistant application port, likely `backend/src/assistant/application/assistantExecutionPort.ts`:

```ts
export interface AssistantExecutionPort {
  execute(request: AssistantExecutionRequest): Promise<AssistantExecutionResult>;
}
```

`AtlasAgent` implements this port. It only delegates a complete immutable request to the provider-facing `AnswerGenerator`; it does not access persistence, tenant state, Profiles, HTTP, or construct application requests.

Move `freezeExecution` from `backend/src/agents/atlas.ts` into `backend/src/assistant/application/assistantExecution.ts` (or a colocated Assistant application file) and expose it as the single immutable request builder. Modify `AssistantPreviewService` to use that builder and depend on the port. The operational service does the same. This prevents concrete-agent imports and duplicate request construction. The legacy `ChatService` is outside the new use case and may retain its compatibility method during this epic.

### 5.3 Profile selection contract

The operational request body must require the existing opaque Profile identity:

```json
{
  "assistantProfileId": "asp_...",
  "message": "What are your opening hours?"
}
```

This is the smallest safe contract because Preview already uses explicit Profile selection and no accepted default/routing policy exists. The path establishes trusted Workspace and Company scope; the service then resolves `assistantProfileId` through Company-scoped repository access. A missing, foreign, disabled, archived, draft, or otherwise non-ready Profile cannot execute.

No Profile ID in a query parameter, header, frontend state, or body can establish Company or Workspace authority. The body only requests an already-scoped resource.

### 5.4 Execution purpose and grounding

Extend the existing `AssistantExecutionRequest.purpose` union with one explicit operational value, proposed as `operational_execution`. This remains an immutable, request-scoped, provider-neutral contract containing only approved behavior, the published structured Knowledge projection, and one message.

Operational execution must use the same Profile-to-behavior mapping, Assistant application request builder, Gemini grounding prompt, and result semantics as Preview. It must not use the legacy exact-FAQ shortcut. It must not pass source metadata, raw normalized text, revision/version IDs, provider configuration, credentials, Workspace context, actor context, or prompts to `AssistantExecutionPort`.

The existing provider rule remains authoritative: only facts in supplied Company Knowledge may support an answer. Insufficient evidence returns the Profile's configured fallback message as `{ status: "safe_fallback" }`.

### 5.5 Safe fallback and provider failure

For this operational request, the application owns `safe_fallback`. `OperationalAssistantExecutionService` must return `{ outcome: "safe_fallback", answer: profile.fallbackMessage }` when the port returns `safe_fallback`, returns an empty/invalid result, or throws `AnswerGenerationUnavailableError`. It must never forward a port-provided fallback answer. This makes the customer-facing operation safe and preserves the no-invention/handoff behavior. Unexpected application failures remain controlled `503` responses with a generic safe error envelope and no technical detail.

This differs from Preview's current `503 assistant_preview_unavailable` behavior only in user-facing operational outcome handling. It does not change Gemini's contract, prompt ownership, or the provider-neutral result type.

### 5.6 Operational execution budget

EPIC 013 introduces a small process-local `OperationalExecutionBudgetPort` behind the Assistant application boundary. Its key is the trusted resolved Workspace identity, never a path/body/query/header value. The initial policy permits at most one in-flight operational execution per Workspace and ten accepted executions in a rolling one-minute window. The service acquires the budget only after successful Workspace/Company/Profile eligibility checks and releases its in-flight slot in `finally`.

When the budget is exhausted, the controller returns `429` with the safe code `assistant_execution_rate_limited`, no tenant/resource detail, and private/no-store headers. The budget stores no message, Knowledge, Profile content, actor data, or durable data. It is intentionally process-local for this non-deployment epic; it is not a distributed/channel quota guarantee. A future multi-process or channel execution policy requires its own architecture decision and must not silently reuse this implementation as a global limit.

## 6. Execution flow

```text
Authenticated portal
  -> POST nested Workspace/Company assistant execution route
  -> existing authorization wrapper: Session, Origin, Fetch Metadata, CSRF,
     active User/Membership, chat:use, WorkspaceContext, ActorContext
  -> route-local JSON parser (only after authorization)
  -> operational execution controller
  -> OperationalAssistantExecutionService
  -> Company / AssistantProfile / published Knowledge repository ports
  -> immutable AssistantExecutionRequest
  -> AssistantExecutionPort (AtlasAgent)
  -> AnswerGenerator provider adapter
  -> provider-neutral answered or safe_fallback response
```

The service resolves Company, Profile, and published Knowledge after authorization. It performs no database writes and no external-provider call before validation/eligibility checks. Provider adapters receive no authority or repository.

## 7. Authorization and tenant boundaries

Use the existing `createAuthorizedCompaniesRouter` wrapper and its `chat:use` permission. The exact route is:

```text
POST /workspaces/:workspaceId/companies/:companyId/assistant/executions
```

The route is changing and therefore requires the current Session cookie, exact Origin, same-origin Fetch Metadata rules, CSRF header, active User, active Membership, and server-derived `chat:use` capability. Owner, Administrator, and Operator may execute; Viewer cannot.

Authorization must run before controller/service work. The existing wrapper returns generic `404 Resource not found.` for missing/invalid Session, CSRF, Origin, Fetch Metadata, Membership, Workspace, or permission. Company/Profile ownership mismatches must also remain generic `404`; no route or service response may reveal cross-Workspace existence.

The operational endpoint is excluded from the global `express.json()` middleware. `app.ts` must mount/configure a route exclusion so the global parser does not consume this path. In `createAuthorizedCompaniesRouter`, the existing authorization wrapper must invoke a route-local `express.json({ type: "application/json", limit: "8kb" })` parser only after the Session/CSRF/Origin/Fetch Metadata/membership/capability decision succeeds. The controller is called only after that parser completes successfully.

The route-local parser accepts exactly `application/json`. An authorized unsupported media type returns `415 assistant_execution_media_type_unsupported`; malformed JSON returns `400 invalid_assistant_execution_request`; and an authorized body over 8 KiB returns `413 assistant_execution_input_too_large`. The authorization wrapper must already have set private/no-store headers. Unauthenticated or unauthorized requests receive the generic private `404` without invoking the parser or controller.

`WorkspaceContext` remains tenant authority only. `ActorContext` remains separately server-created and is not needed by this ephemeral execution service unless later audit requirements prove an execution audit record is required. EPIC 013 introduces no execution persistence, so it must not add an actor field or database record.

## 8. HTTP contract

### Request

```http
POST /workspaces/:workspaceId/companies/:companyId/assistant/executions
Content-Type: application/json
X-CSRF-Token: <current token>
```

```json
{
  "assistantProfileId": "asp_...",
  "message": "What are your opening hours?"
}
```

The DTO accepts exactly those two fields. `assistantProfileId` must satisfy the existing Profile ID parser. `message` is trimmed and must contain 1 through 2,000 Unicode code points. Unknown fields, missing values, malformed Profile IDs, and invalid messages return a controlled `400`. A syntactically valid Profile ID that is absent, foreign, or does not belong to the scoped Company remains a generic `404`.

### Success response

```json
{
  "status": "answered",
  "answer": "..."
}
```

or:

```json
{
  "status": "safe_fallback",
  "answer": "<selected Profile fallback message>"
}
```

Success is `200`, including a safe fallback. Responses set `Cache-Control: no-store, private` and `Pragma: no-cache` through the authorized route/controller boundary.

### Error and concealment behavior

| Condition | Status | External response |
|---|---:|---|
| Missing/invalid auth, CSRF, Origin, Fetch Metadata, membership, permission, Workspace, Company, or syntactically valid foreign/absent Profile | 404 | `{ "error": "Resource not found." }` |
| Unsupported media type | 415 | `assistant_execution_media_type_unsupported` safe envelope |
| Oversized authorized JSON body | 413 | `assistant_execution_input_too_large` safe envelope |
| Malformed JSON, unknown DTO field, malformed body Profile ID, or invalid message | 400 | `{ "error": { "code": "invalid_assistant_execution_request", "message": "A valid Assistant Profile and message are required." } }` |
| Existing scoped Profile is not executable | 409 | `assistant_profile_not_executable` safe message |
| Existing scoped Company is not ready | 409 | `company_not_ready` safe message |
| Existing scoped Company has no publication | 409 | `knowledge_unavailable` safe message |
| Provider unavailable | 200 | `safe_fallback` result using the Profile fallback message |
| Trusted Workspace execution budget exhausted | 429 | `assistant_execution_rate_limited` safe envelope |
| Unexpected internal failure | 503 | generic `assistant_execution_unavailable` envelope; no stack, provider detail, or internal identifiers |

The controller must not return a different body for foreign Company/Profile combinations than for not-found resources. It must not expose provider payloads, prompts, model errors, published Knowledge, or source/revision information.

## 9. Frontend scope

Frontend integration is required because the product goal includes the authenticated portal. Add a bounded operational execution UI for the selected Company and explicit selected Profile. It must not reuse the trusted-local `ChatPanel` or call `/chat`.

The UI must:

- receive `WorkspaceSummary.capabilities` from the authenticated portal and render only when a Workspace, Company, selected Profile, and `capabilities.includes("chat:use")` are present;
- require the existing selected Profile and visibly require its `ready` state;
- send `assistantProfileId` and trimmed message through a new authenticated API method;
- use a dedicated `AbortController`, request ID, and reducer state, patterned after `AssistantPreviewPanel`;
- abort the browser fetch and clear message/result state on Workspace, Company, Profile, logout, and component unmount;
- ignore stale success and error completions after context changes;
- never automatically replay the POST after authentication recovery;
- render `answered`, `safe_fallback`, validation, profile/company/knowledge availability, and generic temporary states with accessible live regions and typed English/Spanish strings; and
- treat server capability checks as authoritative even when client affordances hide controls.

The existing Preview remains an administrative test capability protected by `assistant:preview`; the new panel is operational and protected by `chat:use`. They may share presentational patterns but must not silently share authorization semantics.

Browser abort is presentation-only in EPIC 013. It suppresses stale UI updates and cancels the browser fetch but does not claim to terminate an already-started server/provider execution. Cancellation is intentionally not added to `AssistantExecutionRequest` or `AssistantExecutionPort`; adding provider cancellation requires a separate execution-options design and adapter review.

## 10. Persistence and migrations

No database change is required.

EPIC 013 must not create execution, message, conversation, Profile-selection, channel, or provider configuration records. It must not modify Knowledge sources, revisions, versions, publication rows, migrations 1 through 10, or the published-Knowledge reader.

## 11. Compatibility

- Preserve `AssistantPreviewService` behavior and the `assistant:preview` authorization boundary while replacing only its concrete-agent dependency with the execution port.
- Preserve legacy trusted-local `/chat`, `ChatService`, `chatController.ts`, and `AtlasAgent.answer` as compatibility behavior. Do not mount them in production or make them an authorized authority path.
- Preserve the existing `KnowledgeRepositoryPort.load` published-only contract.
- Preserve the existing Gemini prompt grounding rules. Add the operational purpose only to explicit language behavior where required; do not create a second prompt implementation.
- No API client currently consumes the new endpoint, so adding it is additive. Existing Preview API/request/response contracts remain unchanged.

## 12. Security

- Reuse `createAuthorizedCompaniesRouter`; do not duplicate authentication, CSRF, Origin, Fetch Metadata, capability, or Workspace resolution logic.
- Exclude this endpoint from global JSON parsing and establish authorization before route-local body parsing, Company/Profile discovery, budget acquisition, and provider invocation.
- Validate exact JSON shape and message bounds in the service, not only in the frontend.
- Treat Profile configuration and customer message as untrusted data. Providers retain Atlas grounding rules at highest priority.
- Load only the published projection through the existing scoped reader. Do not expose or use draft/revision/source data.
- Return generic `404` for all unauthorized/mismatched scope conditions and private/no-store responses for all route outcomes.
- Do not log customer message, Profile content, Knowledge, prompts, provider responses, credentials, cookies, or CSRF tokens. The controller must not log caught exception objects. If an application logger is introduced, it may record only a stable outcome code, duration, and trusted internal correlation ID; tests must prove no exception/payload object is passed to it.

## 13. Likely files and changes

### Create

- `backend/src/assistant/application/assistantExecutionPort.ts`: narrow execution port.
- `backend/src/assistant/application/operationalExecutionBudgetPort.ts`: trusted Workspace budget contract and process-local implementation location, unless the repository convention keeps the adapter in a bounded Assistant infrastructure file.
- `backend/src/assistant/services/operationalAssistantExecutionService.ts`: operational use case and input/error types.
- `backend/src/controllers/operationalAssistantExecutionController.ts`: HTTP translation for the new service.
- `backend/src/tests/epic013.test.ts`: execution port, request builder, service eligibility, fallback normalization, budget, and published-only tests.
- `backend/src/tests/epic013.http.test.ts`: real authorized-route, parser-order, DTO/error/cache/concealment, and provider-safe-result tests.
- `backend/src/tests/epic013.composition.test.ts`: production-mode mount, local `/chat` absence, and operational route wiring without Gemini invocation.
- `frontend/src/components/OperationalAssistantExecutionPanel.tsx`: authenticated operational execution UI.
- `frontend/src/state/operationalAssistantExecutionState.ts`: request/result/reducer helpers, unless the existing Preview state can be safely generalized without conflating Preview and operational authorization semantics.
- Matching frontend state/component tests and typed translation keys.

### Modify

- `backend/src/assistant/application/assistantExecution.ts`: add the explicit operational purpose and the single immutable request builder; preserve provider-neutral request data.
- `backend/src/agents/atlas.ts`: implement the execution port without owning application request construction, persistence, or provider authority.
- `backend/src/assistant/services/assistantPreviewService.ts`: accept the port rather than concrete `AtlasAgent`.
- `backend/src/routes/authorizedCompanies.ts`: add the nested `chat:use` route and contextual controller dependency.
- `backend/src/composition.ts`: construct one execution port implementation, wire Preview and operational service/controller, and register the controller in the authorized router.
- `frontend/src/api/atlasApi.ts` and `frontend/src/types/api.ts`: add the operational endpoint and provider-neutral response type.
- `frontend/src/components/AuthenticatedCompanyPortal.tsx` and `frontend/src/components/AssistantProfilesPanel.tsx`: place the selected-Profile operational UI and forward server-derived capabilities.
- `frontend/src/i18n/translations.ts`: typed English/Spanish labels and safe errors.
- `backend/package.json` and `frontend/package.json`: add the exact EPIC 013 test files to their explicit test commands.
- `backend/src/app.ts`: exclude the operational path from global JSON parsing and expose a narrowly testable app assembly boundary that accepts injected routers for mount verification.

### Must remain untouched

- `backend/src/knowledge/domain/*`, `backend/src/knowledge/services/*`, `backend/src/knowledge/infrastructure/*`, `backend/src/repositories/companyKnowledgeRepository.ts`, and all Knowledge migrations.
- `backend/src/workspace/domain/membership.ts`, Workspace resolver/authorization services, and Identity Session/CSRF/origin primitives.
- Provider prompt architecture and Gemini provider contract except for exhaustive handling of the new execution-purpose value inside the existing single prompt translator.
- Existing ADRs, EPIC 012 freeze/audits, and the legacy data schema.

## 14. Dependency impact

No dependency is required. Reuse Express, TypeScript, React, `node:test`, Vitest, Testing Library, and current provider adapters. The process-local budget is an application-owned in-memory adapter with no SQLite or external store. No provider SDK, database, queue, validation, routing, state-management, or channel dependency is justified.

## 15. Testing strategy

### Assistant/service tests

- Explicit Profile selection resolves only within the trusted Company/Workspace scope.
- Ready Profile plus ready Company plus published Knowledge builds the same frozen request shape as Preview except for the explicit operational purpose.
- Draft, disabled, archived, incomplete-ready, missing, and foreign Profiles do not execute.
- Missing/unready Company and missing publication return controlled outcomes without provider invocation.
- The service depends on a fake `AssistantExecutionPort`, not concrete `AtlasAgent`.
- Provider `answered`, provider `safe_fallback` with a mismatched answer, empty/malformed result, and `AnswerGenerationUnavailableError` all produce the specified application-owned safe operational result where applicable.
- The trusted Workspace budget permits one in-flight execution and ten accepted executions per rolling minute, releases its slot after success/failure, and returns the controlled rate-limit outcome without calling the provider when exhausted.
- Customer message/Profile input cannot modify grounding behavior or inject authority into the request.

### HTTP and authorization tests

- Owner, Administrator, and Operator with `chat:use` execute successfully.
- Viewer, suspended/removed membership, missing Session, invalid CSRF, invalid/missing Origin, cross-site Fetch Metadata, and foreign Workspace fail with the same generic `404` before controller/service/provider execution.
- Missing Session, invalid CSRF, invalid Origin, and missing `chat:use` prove the route-local parser and controller were not invoked; authorized malformed JSON, unsupported media, and oversized body prove the specified private/no-store error mapping.
- Foreign Company/Profile probing, malformed IDs, and mismatched Company/Profile are concealed.
- Malformed body Profile IDs return `400`; syntactically valid absent/foreign/mismatched Profile IDs return generic `404`.
- Exact request fields, message trimming, Unicode boundaries, error envelopes, private/no-store headers, and no provider/internal leakage are covered.
- Provider unavailability returns the Profile fallback as `200 safe_fallback`; unexpected errors return generic `503`.
- A router-injected production-mode app test proves legacy `/chat` is absent, the nested operational route is mounted, and the actual controller wiring can use a fake execution port without a Gemini call.

### Regression tests

- Existing Preview requests still use `assistant:preview`, explicit route Profile IDs, the same execution port, and no FAQ shortcut.
- Knowledge tests prove only the published reader is passed to operational execution; ready unpublished revisions cannot affect input.
- Existing Chat compatibility tests preserve the exact-FAQ path only under legacy local Chat.

### Frontend tests

- Server-derived `chat:use` capability, Workspace, Company, selected Profile, and ready-state gating without a role-to-permission mapping.
- Exact endpoint/payload/CSRF/AbortSignal wiring and runtime response-shape validation for the exact `answered | safe_fallback` union with a bounded string answer.
- Abort and sensitive-state clearing on Workspace, Company, Profile, logout, and unmount.
- Stale success/error suppression and no automatic POST replay.
- Answered/fallback/error accessible rendering, English/Spanish translations, message boundary validation, and Viewer control absence.

## 16. Acceptance criteria

1. An authenticated Owner, Administrator, or Operator with `chat:use` can execute an explicit eligible Assistant Profile for a Company in the trusted Workspace.
2. Authorization failures occur before route-local JSON parsing, protected Company/Profile discovery, budget acquisition, and provider execution.
3. Cross-Workspace Company/Profile probing and unauthorized access return indistinguishable generic `404` responses.
4. Body/query/header/frontend values do not establish Workspace, actor, Company ownership, or Profile authority.
5. Only `KnowledgeRepositoryPort.load` published Knowledge is supplied to execution.
6. Source revisions, ready unpublished revisions, drafts, and raw source content never affect operational execution.
7. Missing, foreign, draft, disabled, archived, incomplete, or otherwise ineligible Profiles cannot execute.
8. Every port fallback, empty/malformed port result, unsupported fact, and provider-unavailable result is normalized to the selected Profile fallback without internal disclosure.
9. Services depend on `AssistantExecutionPort`, not concrete `AtlasAgent`; Preview and operational execution share the same immutable request/provider-grounding path.
10. The operational route uses `chat:use`; Preview retains `assistant:preview`.
11. Legacy trusted-local Chat remains isolated and is not promoted to the authenticated production authority path.
12. No new persistence, migration, provider dependency, channel provider, Conversation, or default Profile rule is introduced.
13. The process-local trusted Workspace budget rejects concurrent/rate-exhausted requests safely without provider invocation or durable state.
14. Backend and frontend tests cover the execution, authorization, parser order, tenant-concealment, fallback normalization, published-only, rate-limit, composition mount, response validation, and stale-context matrices.
15. Backend/frontend typechecks, tests, frontend build, dependency audits, `git diff --check`, and intended Git status pass.

## 17. Risks

1. Creating an implicit default Profile or using legacy hardcoded behavior would violate current Profile and ADR-013 selection rules.
2. Adding a route outside the authorized nested router would bypass Workspace tenant authority and `chat:use`.
3. Duplicating execution request construction or provider prompt translation would permit Preview/operational grounding drift.
4. Reading any Knowledge record other than the published projection would violate ADR-014.
5. Treating provider fallback as adapter-owned could expose an unapproved handoff message; the operational service must normalize every fallback.
6. Over-generalizing frontend Preview state could accidentally couple `assistant:preview` and `chat:use` affordances; separate bounded state is safer unless a clear shared abstraction is proven.
7. Letting global JSON parsing run before authorization would allow unauthenticated resource consumption and bypass route concealment/header policy.
8. Treating browser fetch abort as provider cancellation would conceal ongoing execution/cost; EPIC 013 limits its guarantee to stale UI suppression.
9. Extending legacy `/chat`, `/scrape`, onboarding, or default Workspace wiring could create a second production authority path.
10. Adding persistence to record requests or responses would expand scope into Conversations/audit-history design and require a separate decision.

## 18. Architecture decision assessment

No new ADR is required for the proposed scope. Explicit Profile selection, immutable request-scoped execution, provider-neutral translation, explicit Knowledge passing, and independently scoped `chat:use` already follow ADR-013. Published-only Company Knowledge follows ADR-014.

An ADR becomes a blocker only if implementation needs an implicit/default Profile routing rule, durable execution/conversation state, provider/model selection policy, channel-owned Knowledge, an execution capability that cannot fit the existing immutable contract, or a durable/distributed operational budget. The process-local budget in this plan does not require an ADR because it is a bounded non-deployment safeguard rather than a shared tenant operational guarantee.

## 19. Implementation sequence

1. Move the immutable request builder to the Assistant application layer, add the execution port, and change Preview to use both without behavior change.
2. Add the explicit operational purpose and ensure the existing provider translator handles it without a second prompt path.
3. Implement the process-local trusted Workspace execution budget and the operational service using Company/Profile/published-Knowledge ports, existing execution/readiness policy, and application-owned fallback normalization.
4. Add the controller, authorization-first route-local JSON parser, and nested `chat:use` route through the current authorization wrapper.
5. Add the narrowly testable app assembly boundary; wire the new service/controller in composition without altering local-mode Chat authority.
6. Add service and real HTTP authorization/parser-order/concealment/fallback/budget/published-only tests and add all exact backend test files to the backend script.
7. Add authenticated portal API/type/state/component integration with capability-only gating, response validation, presentation-only abort semantics, lifecycle/accessibility tests, and exact frontend script entries.
8. Run the complete verification matrix and inspect that changes remain confined to EPIC 013 scope.

## 20. Verification commands and expected results

Run from the repository root:

```powershell
npm --prefix backend test
npm --prefix backend run typecheck
npm --prefix backend audit --omit=dev
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix frontend audit --audit-level=high
```

Expected results:

- Backend and frontend tests pass without skips, TODOs, or unhandled worker failures.
- Backend/frontend typechecks and frontend production build pass.
- Dependency audits report no vulnerability at the selected audit level.
- `git diff --check` reports no whitespace errors.
- Git status contains only the intended EPIC 013 implementation and documentation changes; it preserves pre-existing uncommitted ADR-014 and review files unless separately committed before implementation.

## 21. Proposed commit message

```text
feat(assistant): add authenticated operational execution
```
