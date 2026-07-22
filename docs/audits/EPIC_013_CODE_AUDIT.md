# EPIC 013 Code Audit

## 1. Executive Summary

EPIC 013 is not ready for release approval. The implementation preserves the intended operational execution layering, uses published Company Knowledge, centralizes request construction, and keeps legacy local Chat out of production assembly. However, three Major findings violate frozen authorization and composition/testing requirements.

The most significant defect accepts missing or arbitrary `Sec-Fetch-Site` values in the authorized route wrapper. Such requests can reach route-local JSON parsing after valid Session, Origin, and CSRF checks, despite the Freeze requiring Fetch Metadata acceptance before parsing and generic concealment for missing or invalid Fetch Metadata. The production-composition test also imports a module that initializes Gemini before its fake execution port is supplied, contrary to the frozen no-Gemini-initialization test boundary. Finally, the required backend HTTP/service and frontend behavior matrices are materially incomplete.

This audit found 0 Critical, 3 Major, 0 Minor, and 3 Observations. No production code, test, migration, dependency, package, Freeze, plan, Architecture Review, or ADR was modified by this audit. This report is the sole audit deliverable.

## 2. Authority And Scope

Audited authority, in order:

1. `docs/freeze/EPIC_013_ARCHITECTURE_FREEZE.md`
2. `docs/plans/EPIC_013_ENGINEERING_PLAN.md`
3. `docs/reviews/EPIC_013_ARCHITECTURE_REVIEW.md`
4. `docs/adr/ADR-013-provider-neutral-assistant-execution-contract.md`
5. `docs/adr/ADR-014-company-knowledge-lifecycle.md`
6. Current implementation and declared test scripts

Audited surfaces included application assembly, authorized routing and parser ordering, service/controller/port layering, request construction, Gemini/provider boundary, published-Knowledge loading, Workspace budget and tenant scope, Profile selection, frontend capability/state behavior, production composition, and EPIC 013 test evidence.

## 3. Positive Verification

- `OperationalAssistantExecutionService` is an Express/SQLite/provider-independent Assistant service and depends only on Company, Profile, Knowledge, execution, and budget ports.
- Operational execution resolves the Company and explicit Profile in trusted `WorkspaceContext`, applies the existing Profile policy, reads Knowledge through `KnowledgeRepositoryPort.load`, and applies the budget before port invocation.
- Operational fallback normalization replaces provider fallback/empty/malformed results and `AnswerGenerationUnavailableError` with the selected Profile fallback.
- `buildAssistantExecution` in the Assistant application layer is the sole Profile-to-behavior mapper and freezer used by both Preview and operational services.
- The operational request contains only purpose, behavior, published structured Knowledge, and message. It carries no authority, provider, prompt, repository, or Profile aggregate.
- The frontend operational panel is distinct from local Chat and gates rendering on server-derived `capabilities.includes("chat:use")`.
- The production app excludes legacy `/chat` when created with production options.
- No EPIC 013 migration, execution persistence, channel adapter, default Profile, provider dependency, or alternate Knowledge reader/writer was identified.

## 4. Findings By Severity

### AUD-013-CODE-001 - Major - Missing or invalid Fetch Metadata is authorized through to JSON parsing

- **Files and symbols:** `backend/src/routes/authorizedCompanies.ts:75-80`, `authorize`; `backend/src/routes/authorizedCompanies.ts:102-116`, operational parser continuation.
- **Evidence:** The changing-request check rejects only `sec-fetch-site === "same-site"` or `"cross-site"`. It accepts an absent header and arbitrary values such as `invalid`, then resolves User/Membership/Workspace and invokes the route-local parser. The Freeze requires Fetch Metadata acceptance before protected parsing and mandates generic `404` without parser/controller execution for missing or invalid Fetch Metadata.
- **Violated contract/risk:** Freeze sections 4.1, 8, and 14 require Session, exact Origin, Fetch Metadata, CSRF, active User/Membership, Workspace, and `chat:use` before route-local parsing. A request that does not meet the frozen Fetch Metadata boundary can consume parser resources and receive parser-specific behavior rather than the required concealed `404`.
- **Reproduction/failure scenario:** Submit a valid Session, valid Origin, valid CSRF token, and malformed JSON body while omitting `Sec-Fetch-Site`. The current wrapper permits the request to `operationalJson`, which returns the authorized malformed-body response instead of rejecting before parsing.
- **Required remediation:** Accept only the Fetch Metadata values explicitly permitted by the frozen policy, reject missing/unknown values before controller construction or parser invocation, and add real-route tests proving missing/invalid Fetch Metadata returns generic `404` with no parser, controller, service, budget, or execution-port call.
- **Release-blocking:** Yes.

### AUD-013-CODE-002 - Major - Fake-port composition evidence initializes Gemini

- **Files and symbols:** `backend/src/tests/epic013.composition.test.ts:8,54`; `backend/src/composition.ts:27,72,103,105`; `backend/src/providers/gemini.ts:10,119`.
- **Evidence:** The composition test imports `createProductionAppRouters` from `composition.ts`. Module evaluation imports `geminiProvider`, constructs `GoogleGenAI`, constructs `AtlasAgent(geminiProvider)`, and constructs Gemini-backed Knowledge/onboarding services before the test passes `FakeExecution` to `createProductionAppRouters`. The fake port prevents a generation call, but it does not prevent Gemini initialization.
- **Violated contract/risk:** Freeze section 13 requires a testable production assembly boundary that verifies route mounting and fake execution wiring without initializing or calling Gemini. Eager production composition creates an environment/configuration dependency in the very test boundary intended to avoid it, and weakens isolation of route-wiring evidence.
- **Reproduction/failure scenario:** Run `backend/src/tests/epic013.composition.test.ts` with a fake execution port. Import-time evaluation still executes `new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })` before the fake port is used.
- **Required remediation:** Separate router/app construction needed by this test from Gemini-backed production singleton initialization, or inject composition dependencies so the test supplies a fake execution implementation before any Gemini provider is constructed. Preserve the real production composition path and assert it receives the actual provider only at runtime assembly.
- **Release-blocking:** Yes.

### AUD-013-CODE-003 - Major - Required EPIC 013 contract matrices are not covered by tests

- **Files and symbols:** `backend/src/tests/epic013.http.test.ts:22-46`; `backend/src/tests/epic013.test.ts:21-41`; `frontend/src/components/OperationalAssistantExecutionPanel.test.tsx:8`; `frontend/src/state/operationalAssistantExecutionState.test.ts:4`.
- **Evidence:** The HTTP suite covers one Operator and parser variants, but does not prove Viewer/inactive/cross-Workspace/missing-`chat:use` concealment; missing/invalid Fetch Metadata; media and 8 KiB failure mapping; private/no-store headers; malformed-versus-valid-absent Profile ID distinction; or parser/controller/service/budget/provider non-invocation for the required authorization failures. The service suite does not cover Company/Profile/Knowledge eligibility ordering, unpublished Knowledge isolation, rolling-window exhaustion, or lease release after every terminal path. Frontend tests cover one successful panel submit/capability absence and one stale reducer transition, but do not cover all required Workspace/Company/Profile/logout/unmount abort and clearing behavior, response-validation failure, accessible English/Spanish outcome states, or all message boundaries.
- **Violated contract/risk:** Freeze section 14 explicitly requires these tests and proof obligations. Existing green suites cannot detect regressions in the frozen authorization, concealment, budget, published-only, and presentation safety contracts.
- **Reproduction/failure scenario:** Remove a Viewer denial, alter the 8 KiB parser limit, permit an unpublished Knowledge projection, omit a lease release after a failure, or render a stale operational result after a context change. The current EPIC 013-specific test files can remain green because they do not exercise those cases.
- **Required remediation:** Add the complete frozen backend HTTP/service and frontend state/component matrices. Use real authorized route/app assembly for authorization and parser tests, controlled execution/budget fakes for no-invocation and release assertions, and component tests for all required lifecycle, response-validation, localization, accessibility, and boundary conditions.
- **Release-blocking:** Yes.

## 5. Previous Audit Findings

### AUD-013-001 - Fully Resolved

`backend/src/app.ts:7,12` excludes the lower-case, case-variant, and optional-trailing-slash forms that the default Express configuration accepts. `backend/src/tests/epic013.http.test.ts:31-44` exercises trailing-slash and case variants through `createApp`, proving malformed unauthorized requests receive `404` before the route-local controller and malformed authorized requests receive `400`.

### AUD-013-002 - Fully Resolved

`backend/src/assistant/application/assistantExecution.ts:37-52` owns Profile-to-behavior mapping, immutable request construction, and freezing. `AssistantPreviewService` and `OperationalAssistantExecutionService` both consume `buildAssistantExecution`; no duplicate Profile mapping remains in those services.

### AUD-013-003 - Partially Resolved

`backend/src/tests/epic013.composition.test.ts` now sends real HTTP requests through `createApp(createProductionAppRouters(fake))`, proves the nested operational route responds through the fake port, checks an unauthorized request, and confirms production `/chat` is absent. It remains non-compliant because importing production composition initializes Gemini before fake-port injection, and it does not prove a `chat:use` denial path.

## 6. Verification Performed

The audit traced production wiring from `backend/src/index.ts` through `createProductionAppRouters`, `createApp`, the authorized Company router, controller, operational service, ports, `AtlasAgent`, and Gemini provider. It also inspected frontend API validation, operational reducer/component lifecycle, portal integration, translations/tests, package test-file enumeration, and the existing published-Knowledge repository port.

Verification results:

- `backend/npm run typecheck`: passed.
- `backend/npm test`: passed, 136 tests with no failures, skips, or TODOs.
- `frontend/npm run typecheck`: passed.
- `frontend/npm test`: passed, 45 Node tests and 41 Vitest tests.
- `frontend/npm run build`: passed.
- `git diff --check`: passed with no whitespace errors. Git emitted existing LF/CRLF conversion warnings only.
- `git status --short`: reports the existing uncommitted EPIC 013 implementation/documentation work plus this audit report; no files were reverted or otherwise altered by the audit.

The backend has no declared build script; its required backend verification is its typecheck and test suite. Frontend verification includes typecheck, test suite, and production build.

## 7. Conclusion

**CODE AUDIT PASSED WITH REQUIRED FIXES**

Release approval requires remediation and verification of all three Major findings. No Critical finding was identified, but the Fetch Metadata parser-order violation and Gemini-initializing composition test are frozen security/assurance contract failures.
