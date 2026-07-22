# EPIC 013 - Architecture Freeze

**Status:** Frozen  
**Authority:** Single implementation contract for EPIC 013  
**Freeze date:** 2026-07-22

This document freezes the reconciled EPIC 013 design. It is authoritative over the EPIC 013 Engineering Plan where wording differs. Implementation MUST stop and return to Architecture Review if it cannot meet an invariant below. This freeze introduces no change to accepted ADRs.

## 1. Objective and scope

EPIC 013 SHALL add one authenticated, Company-aware, channel-neutral, ephemeral operational Assistant execution capability. It SHALL close the gap between administrative Preview and an operational request by reusing Assistant Profiles, published Company Knowledge, the immutable execution contract, the provider adapter boundary, trusted Workspace authority, and the authenticated portal.

The operation MUST NOT persist an execution, message, Conversation, memory, handoff state, lead, analytics record, Profile selection, channel configuration, or provider configuration.

EPIC 013 MUST NOT implement WhatsApp, Instagram, email, a web-channel identity, a concrete channel adapter, CRM, calendar, payment, embeddings, vector retrieval, queues, scheduled refresh, Knowledge lifecycle changes, Knowledge migrations, Workspace authorization redesign, Assistant Profile lifecycle redesign, a default Profile, or production deployment.

## 2. Module boundaries and dependency direction

The required direction is:

```text
Authorized route -> controller -> OperationalAssistantExecutionService
  -> Company / Assistant Profile / published Knowledge ports
  -> AssistantExecutionPort -> AtlasAgent -> AnswerGenerator provider
```

- `OperationalAssistantExecutionService` SHALL live in `backend/src/assistant/services/`. It owns operational execution policy, Profile eligibility, published-Knowledge loading, Workspace budget use, fallback normalization, and application errors.
- The service MUST NOT import Express, routes, controllers, Gemini, `AnswerGenerator`, SQLite repositories, `WorkspaceResolver`, authentication services, or provider SDKs.
- Controllers SHALL translate HTTP only. They MUST NOT resolve tenant authority, access persistence, construct prompts, call providers, or log caught exception objects.
- Repositories SHALL remain the only SQLite boundary. EPIC 013 MUST NOT add an alternate Knowledge reader or publication writer.
- `AtlasAgent` SHALL implement the application execution port. It MUST NOT resolve Company/Profile/Workspace state, access repositories, construct application requests, or select a provider.
- Provider adapters SHALL translate the immutable request only. They MUST NOT select tenants, Profiles, Knowledge, permissions, or capabilities.

Legacy `ChatService` and its local-mode concrete-agent compatibility dependency MAY remain unchanged, but MUST NOT be reused by the new operational path.

## 3. Execution port and request builder

### 3.1 Execution port

The Assistant application layer SHALL own:

```ts
interface AssistantExecutionPort {
  execute(request: AssistantExecutionRequest): Promise<AssistantExecutionResult>;
}
```

`AtlasAgent` SHALL implement this port by delegating a complete immutable request to `AnswerGenerator`.

`AssistantPreviewService` and `OperationalAssistantExecutionService` MUST depend on `AssistantExecutionPort`, never on concrete `AtlasAgent`.

### 3.2 Request builder

The Assistant application layer SHALL own the single immutable request builder/freezer. It SHALL be moved from `backend/src/agents/atlas.ts` to `backend/src/assistant/application/` alongside the execution contract or an immediately colocated application file.

Preview and operational services MUST use this same builder. They MUST NOT duplicate freezing, Profile-to-behavior mapping, provider prompt construction, or grounding rules.

### 3.3 Execution contract

`AssistantExecutionRequest` SHALL gain exactly one new purpose: `operational_execution`.

The contract MUST remain immutable and request-scoped. It SHALL contain only approved behavior, published structured Company Knowledge, the message, and explicit purpose. It MUST NOT contain a prompt, provider/model choice, credential, Workspace authority, ActorContext, repository, Profile aggregate, source/revision/version metadata, normalized source text, or generic configuration.

Operational execution MUST use the existing provider translation path and MUST NOT use legacy Chat's exact-FAQ shortcut. Preview SHALL retain `assistant:preview` and its explicit route Profile selection.

## 4. Authority and selection boundaries

### 4.1 Workspace and actor authority

The existing `createAuthorizedCompaniesRouter` SHALL establish Session, exact Origin, Fetch Metadata, CSRF, active User, active Membership, `chat:use`, trusted `WorkspaceContext`, and server-created `ActorContext` before protected operational parsing, discovery, budget acquisition, or execution.

`WorkspaceContext` SHALL remain tenant authority only. `ActorContext` SHALL remain a separate server-created value. EPIC 013 MUST NOT persist an actor or execution record.

No body, query, header, frontend state, Company ID, Profile ID, or Workspace public ID alone SHALL establish Workspace, actor, Company ownership, Profile authority, or capability.

### 4.2 Company and Profile boundary

The operational request SHALL be:

```text
POST /workspaces/:workspaceId/companies/:companyId/assistant/executions
```

The route MUST use the existing `chat:use` capability. Owner, Administrator, and Operator may execute under the current server-derived permission policy; Viewer MUST NOT.

The JSON body SHALL contain exactly:

```json
{
  "assistantProfileId": "asp_...",
  "message": "What are your opening hours?"
}
```

Profile selection MUST be explicit. EPIC 013 SHALL NOT introduce a default Profile, automatic routing, channel-to-Profile assignment, or Profile selection by name/status/time.

The service MUST resolve the requested Profile only through the authorized Company and trusted Workspace context. The Profile MUST belong to that Company and MUST satisfy the existing `AssistantProfileExecutionPolicy`. Missing, foreign, Company-mismatched, draft, disabled, archived, incomplete, or otherwise ineligible Profiles MUST NOT execute.

## 5. Published Knowledge rule

Operational execution MUST load Knowledge only through `KnowledgeRepositoryPort.load(context, companyId)`. That port's published projection is the sole runtime factual authority.

Operational execution MUST NOT read Knowledge sources, revisions, candidates, latest timestamps, legacy tables, raw content, normalized text, or unpublished ready revisions. A missing published projection MUST prevent provider invocation.

Providers MUST receive the published Knowledge explicitly through the immutable execution request and MUST NOT load it themselves.

## 6. Operational execution flow

The service SHALL execute in this order:

1. Validate the exact application DTO.
2. Resolve the Company through trusted `WorkspaceContext`.
3. Resolve the explicit Profile through the scoped Company.
4. Require the existing Profile execution policy.
5. Require Company `ready` status.
6. Load the published Knowledge projection only.
7. Acquire the trusted Workspace operational execution budget.
8. Build and freeze the immutable `operational_execution` request.
9. Invoke `AssistantExecutionPort`.
10. Normalize the result to an approved operational response.
11. Release any in-flight budget slot in `finally`.

The service MUST perform no database write and no provider call before successful eligibility and budget checks.

## 7. Fallback normalization and provider neutrality

The application, not a provider or agent, owns the operational `safe_fallback` answer.

`OperationalAssistantExecutionService` MUST return exactly the selected Profile's `fallbackMessage` when:

- the execution port returns `safe_fallback`, regardless of its returned answer;
- the execution port returns an empty or malformed result;
- the provider/agent raises `AnswerGenerationUnavailableError`; or
- the published Knowledge cannot support an answer through the existing grounded provider behavior.

The service MUST NOT forward a provider-supplied fallback answer. Unexpected application failures SHALL remain generic controlled `503` failures and MUST NOT expose stack traces, provider payloads, prompts, models, credentials, Knowledge, or internal identifiers.

The existing provider grounding rules remain mandatory: Assistant configuration and customer input are untrusted data; only supplied Company Knowledge may support factual answers; unsupported facts require the approved fallback.

## 8. Parser and authorization ordering

The operational endpoint MUST be excluded from global `express.json()` parsing.

After the authorized route wrapper has accepted Session, Origin, Fetch Metadata, CSRF, User, Membership, Workspace, and `chat:use`, it SHALL invoke a route-local JSON parser configured for exactly `application/json` with an 8 KiB limit. The controller SHALL run only after this parser succeeds.

The following behavior is mandatory:

| Condition | Required result |
|---|---|
| Missing/invalid Session, Origin, Fetch Metadata, CSRF, membership, Workspace, or `chat:use` | Generic `404 Resource not found.`; parser and controller MUST NOT run |
| Authorized unsupported media type | `415 assistant_execution_media_type_unsupported` |
| Authorized body over 8 KiB | `413 assistant_execution_input_too_large` |
| Authorized malformed JSON | `400 invalid_assistant_execution_request` |

The authorization wrapper MUST set `Cache-Control: no-store, private` and `Pragma: no-cache` before route-local parsing. All operational outcomes SHALL retain those headers.

## 9. HTTP and concealment contract

The DTO MUST reject unknown fields, missing values, malformed body Profile IDs, and messages outside 1 through 2,000 trimmed Unicode code points with:

```json
{
  "error": {
    "code": "invalid_assistant_execution_request",
    "message": "A valid Assistant Profile and message are required."
  }
}
```

These are `400` failures. A syntactically valid absent, foreign, or Company-mismatched Profile, a missing/foreign Company, or any authorization mismatch MUST be indistinguishable generic `404` responses.

An existing scoped non-executable Profile SHALL return `409 assistant_profile_not_executable`. An existing scoped non-ready Company SHALL return `409 company_not_ready`. An existing scoped Company without publication SHALL return `409 knowledge_unavailable`.

A successful response SHALL be `200` and exactly one of:

```json
{ "status": "answered", "answer": "..." }
```

```json
{ "status": "safe_fallback", "answer": "<selected Profile fallback message>" }
```

The controller MUST NOT distinguish foreign resources from not-found resources and MUST NOT return provider, prompt, Knowledge, source, revision, version, or internal failure details.

## 10. Operational execution budget

EPIC 013 SHALL add a process-local `OperationalExecutionBudgetPort` in the Assistant application boundary with a bounded in-memory implementation. Its key MUST be the trusted resolved Workspace identity; it MUST NOT use a client-controlled identifier.

The frozen initial policy is:

- at most one in-flight operational execution per Workspace; and
- at most ten accepted operational executions per Workspace in a rolling one-minute window.

The budget MUST be acquired only after Company/Profile/Knowledge eligibility checks and before provider invocation. It MUST release the in-flight slot on every terminal service path. It MUST store no message, Knowledge, Profile content, actor data, or durable record.

Exhaustion SHALL return `429 assistant_execution_rate_limited` with a safe envelope and private/no-store headers. It MUST NOT call the provider.

This budget is intentionally process-local and is not a distributed, channel, or production-deployment quota guarantee. A durable/distributed budget, channel-wide policy, or tenant operational guarantee requires Architecture Review and potentially a new ADR.

## 11. Frontend boundary

The authenticated portal SHALL add a separate bounded operational execution component/state. It MUST NOT reuse the trusted-local `ChatPanel`, call `/chat`, or share Preview authorization state.

The operational UI MUST:

- receive server-derived `WorkspaceSummary.capabilities`;
- render controls only when the selected Workspace/Company/Profile exists, the Profile is ready, and `capabilities.includes("chat:use")` is true;
- submit the explicit Profile ID and trimmed message with current CSRF token to the nested route;
- use dedicated request IDs, an `AbortController`, and stale-result guards;
- clear message and result state and abort the browser fetch on Workspace, Company, Profile, logout, and unmount changes;
- never replay the POST after authentication recovery;
- validate the successful response at the API boundary as exact `answered | safe_fallback` plus a bounded string answer; and
- render answered, safe fallback, validation, availability, rate-limit, and generic temporary states with accessible live regions and typed English/Spanish text.

Browser abort is presentation-only. It SHALL suppress stale rendering and cancel the browser fetch, but MUST NOT be represented as provider/server cancellation. EPIC 013 SHALL NOT add cancellation data to `AssistantExecutionRequest` or `AssistantExecutionPort`.

Preview remains an administrative `assistant:preview` operation. Operational execution remains `chat:use`. They MAY share presentation primitives and backend request/result contracts, but MUST NOT share frontend role-to-capability mappings or collapse their authorization semantics.

## 12. Compatibility boundary

Legacy trusted-local `/chat`, `ChatService`, `chatController.ts`, `AtlasAgent.answer`, and the exact-FAQ shortcut SHALL remain compatibility behavior. EPIC 013 MUST NOT mount legacy `/chat` in production, use it as the operational authority path, or alter its default-Workspace model.

The new endpoint is additive. Preview's route, response contract, `assistant:preview` boundary, and provider path MUST remain compatible while its concrete-agent dependency is replaced with the execution port.

## 13. App composition and testing boundary

`backend/src/app.ts` SHALL expose a narrowly testable app assembly boundary that accepts injected routers sufficient to verify route mounting. Production composition SHALL still provide the real routers. This boundary MUST allow tests to verify production-mode route presence/absence without initializing or calling Gemini.

The production-mode evidence MUST prove:

- legacy `/chat` is absent;
- the nested operational route is mounted;
- the route uses `chat:use`; and
- operational execution can be wired to a fake execution port without a real Gemini call.

## 14. Testing obligations

Implementation MUST add and explicitly include in package scripts:

- `backend/src/tests/epic013.test.ts` for request builder, execution-port dependency, Profile/Company/Knowledge eligibility, fallback normalization, budget, and published-only behavior;
- `backend/src/tests/epic013.http.test.ts` for real authorized-route parser ordering, DTO/media/size/error/header/concealment behavior, authorization matrix, and provider-safe outcomes;
- `backend/src/tests/epic013.composition.test.ts` for production-mode route mounting and local Chat absence; and
- matching explicit frontend state/component test files for capability gating, API response validation, abort/stale behavior, message bounds, accessibility, and localization.

Tests MUST prove all of the following:

- unauthorized, invalid-CSRF, invalid-Origin, and missing-`chat:use` requests do not invoke the parser, controller, service, budget, or provider;
- Owner, Administrator, and Operator execute; Viewer, inactive memberships, and cross-Workspace requests are concealed;
- malformed body Profile IDs are `400`, while syntactically valid absent/foreign/mismatched IDs are `404`;
- only published Knowledge reaches the execution port and unpublished revisions never do;
- all fallback/error cases normalize to the selected Profile fallback as specified;
- budget concurrency/window exhaustion returns `429` without provider invocation and releases after terminal paths;
- Preview still uses the shared application request builder/execution port and never uses the legacy FAQ shortcut;
- legacy local Chat behavior is unchanged and remains unavailable in production-mode assembly;
- the frontend does not role-map `chat:use`, does not replay POSTs, and never renders stale operational answers/errors; and
- no sensitive exception or payload is passed to controller logging.

The backend and frontend package test commands MUST enumerate all EPIC 013 test files. The established backend serial test-file runner MUST be preserved.

## 15. Implementation invariants

1. Implementation MUST follow this freeze without adding architectural behavior not stated here.
2. Implementation MUST NOT add a database migration, persistence record, dependency, channel adapter, default Profile, or second execution contract.
3. Implementation MUST NOT weaken Knowledge publication, Profile lifecycle, Workspace authorization, tenant concealment, CSRF, Origin, Fetch Metadata, or provider-grounding rules.
4. Implementation MUST NOT introduce an alternate published-Knowledge reader or execution writer.
5. Implementation MUST NOT log customer content, Profile content, Knowledge, prompts, provider responses, credentials, cookies, CSRF tokens, or caught provider exception objects.
6. Implementation MUST NOT treat process-local budget limits as a durable or distributed quota.
7. Implementation MUST reopen Architecture Review before adding provider cancellation, a durable/distributed budget, channel/Profile routing, execution persistence, Conversation state, provider/model policy, or any behavior that cannot fit the frozen contract.

## 16. Non-goals

This freeze does not authorize a redesign of the Engineering Plan, a new ADR, an Architecture Review revision, a new Architecture Freeze, or implementation of any out-of-scope feature.

**ARCHITECTURE FROZEN**
