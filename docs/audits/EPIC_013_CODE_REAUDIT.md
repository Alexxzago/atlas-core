# EPIC 013 Code Re-Audit

## 1. Executive Summary

EPIC 013 is not ready for release approval. The previous Fetch Metadata and Gemini-initialization defects are resolved. The implementation retains the intended service/port/repository/provider layering, published-Knowledge authority, application-owned fallback, Workspace budget, and production local-Chat exclusion.

One previous Major finding remains partially unresolved because the frozen test matrices are still incomplete. One new Minor finding violates the frozen frontend rendering boundary by displaying disabled operational controls for a non-ready Profile. This re-audit found 0 Critical, 1 Major, 1 Minor, and 2 Observations.

No production code, test, migration, dependency, package, Freeze, plan, Architecture Review, or ADR was modified by this re-audit. This report is the sole audit deliverable.

## 2. Authority And Scope

Audited authority, in order:

1. `docs/freeze/EPIC_013_ARCHITECTURE_FREEZE.md`
2. `docs/plans/EPIC_013_ENGINEERING_PLAN.md`
3. `docs/reviews/EPIC_013_ARCHITECTURE_REVIEW.md`
4. `docs/adr/ADR-013-provider-neutral-assistant-execution-contract.md`
5. `docs/adr/ADR-014-company-knowledge-lifecycle.md`
6. Current implementation and declared test scripts

The audit covered backend routing/parser ordering, authorization, service/port/request-builder layering, Gemini/provider composition, published Knowledge, fallback and budget behavior, frontend capability/rendering/lifecycle behavior, production composition, and test evidence.

## 3. Positive Verification

- The operational service remains independent of Express, SQLite, provider SDKs, routes, controllers, and Workspace resolver services.
- Both Preview and operational execution use the single application request builder/freezer.
- Only `KnowledgeRepositoryPort.load(context, companyId)` supplies execution Knowledge; the operational service does not access source/revision/raw-content APIs.
- The operational service normalizes provider fallback, empty/malformed responses, and `AnswerGenerationUnavailableError` to the Profile fallback.
- The global JSON parser excludes the case-insensitive and optional-trailing-slash operational path variants accepted by the configured Express app.
- The authorized route now accepts only `Sec-Fetch-Site: same-origin` for changing routes before parser invocation.
- `GeminiProvider` constructs `GoogleGenAI` lazily. Production composition tests assert the fake-port route path leaves the Gemini client uninitialized.
- Production composition tests prove the nested operational route, Owner/Administrator/Operator access, Viewer/inactive/cross-Workspace concealment, fake execution-port use, and production `/chat` absence.
- No execution persistence, migration, channel adapter, default Profile, second execution contract, or alternate published-Knowledge reader/writer was identified.

## 4. Findings By Severity

### AUD-013-REAUDIT-001 - Major - Required EPIC 013 test evidence remains incomplete

- **Files and symbols:** `backend/src/tests/epic013.http.test.ts:34-54`; `backend/src/tests/epic013.test.ts:46-65`; `frontend/src/components/OperationalAssistantExecutionPanel.test.tsx:8-10`; `frontend/src/state/operationalAssistantExecutionState.test.ts:4-5`.
- **Evidence:** The HTTP test covers route variants, missing/invalid Fetch Metadata, media type, size, and one operator path, but does not cover invalid CSRF, invalid Origin, valid absent/foreign/Company-mismatched Profile IDs, or direct parser/controller/service/budget/execution-port non-invocation assertions for every required authorization failure. The service test does not prove a ready unpublished revision cannot reach the port or all frozen eligibility ordering cases. Frontend tests cover one Profile context change, malformed response, and message bounds, but not Workspace/Company/logout/unmount lifecycle changes, localized accessible answered/fallback/error states, or the complete outcome/error matrix.
- **Violated contract/risk:** Freeze section 14, especially the mandatory proofs in lines 246-257, requires these test matrices. A regression in concealment, parser ordering, published-only grounding, lifecycle clearing, or localization/accessibility can remain undetected by the declared commands.
- **Required remediation:** Complete the real authorized-route/app tests for all frozen authorization, concealment, DTO, parser, header, and non-invocation outcomes; extend service tests for published-versus-unpublished authority and all terminal budget/eligibility paths; and add frontend component/state cases for each lifecycle boundary, response outcome/error, accessibility, and English/Spanish rendering state.
- **Release-blocking:** Yes.

### AUD-013-REAUDIT-002 - Minor - Non-ready Profiles still render operational execution controls

- **Files and symbols:** `frontend/src/components/OperationalAssistantExecutionPanel.tsx:11-14`; `frontend/src/components/AssistantProfilesPanel.tsx:75`.
- **Evidence:** The panel returns `null` only when `chat:use` is absent. For draft, disabled, or archived Profiles, it renders the operational form and button disabled, along with a warning. `AssistantProfilesPanel` mounts it for every selected Profile.
- **Violated contract/risk:** Freeze section 11 requires operational controls to render only when the selected Workspace, Company, Profile, ready Profile state, and `chat:use` capability all exist. Displaying a disabled form for an ineligible Profile violates the frozen capability/rendering boundary and can mislead users about available operations.
- **Required remediation:** Return `null` when the Profile is not ready, retaining server authorization as the authority. Add component coverage for ready and each non-ready Profile state.
- **Release-blocking:** No by itself; required before approval.

## 5. Previous Finding Status

### AUD-013-CODE-001 - Fully Resolved

`backend/src/routes/authorizedCompanies.ts:75-80` now requires `Sec-Fetch-Site: same-origin` before route-local parsing. `backend/src/tests/epic013.http.test.ts:40-45` proves missing and invalid Fetch Metadata result in concealed `404` responses without controller invocation.

### AUD-013-CODE-002 - Fully Resolved

`backend/src/providers/gemini.ts:17-19,90-93` constructs the Gemini client only when provider execution or extraction is invoked. `backend/src/tests/epic013.composition.test.ts:73-98` verifies the client remains `null` before and after production route execution through the injected fake execution port.

### AUD-013-CODE-003 - Partially Resolved

The test scripts enumerate all EPIC 013 files, and coverage now includes authorization roles, inactive/cross-Workspace concealment, Fetch Metadata, parser media/size/header behavior, request validation, budget window/release, malformed frontend response handling, stale-profile abort, and Unicode bounds. The mandatory evidence listed in AUD-013-REAUDIT-001 remains absent.

## 6. Verification

Verification results:

- `backend/npm run typecheck`: passed.
- `backend/npm test`: passed, 138 tests with no failures, skips, or TODOs.
- `frontend/npm run typecheck`: passed.
- `frontend/npm test`: passed, 46 Node tests and 42 Vitest tests.
- `frontend/npm run build`: passed.
- `git diff --check`: passed with no whitespace errors; Git emitted existing LF/CRLF conversion warnings only.
- `git status --short`: reports the existing uncommitted EPIC 013 implementation/documentation work plus this re-audit report.

The backend has no declared build script; its required verification is the backend typecheck and test suite. Frontend verification includes typecheck, tests, and production build.

## 7. Conclusion

**CODE AUDIT PASSED WITH REQUIRED FIXES**

Release approval requires remediation and verification of AUD-013-REAUDIT-001 and AUD-013-REAUDIT-002.
