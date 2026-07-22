# EPIC 013 Pre-Code Audit

## 1. Executive Summary

EPIC 013 is not ready for release approval. The implementation generally follows the intended layering and has previously passed its declared backend and frontend test suites, typechecks, frontend build, and dependency audits. However, it violates a security-critical frozen parser-ordering contract and lacks required shared request construction and production-composition test evidence.

This audit found three issues: one Critical and two Major. The Critical finding permits route spellings accepted by the default Express router to be parsed by global `express.json()` before the required authorization boundary. That can turn unauthorized malformed requests into parser failures and consume parsing resources before Session, Origin, Fetch Metadata, CSRF, membership, Workspace, and `chat:use` checks.

No implementation, test, migration, dependency, package, freeze, plan, or review file was changed by this audit. This report is the sole audit deliverable.

## 2. Audit Scope

Audited authority, in order:

1. `docs/freeze/EPIC_013_ARCHITECTURE_FREEZE.md`
2. `docs/plans/EPIC_013_ENGINEERING_PLAN.md`
3. `docs/ATLAS_V1_ARCHITECTURE.md`
4. `docs/ATLAS_ENGINEERING_PROMPT.md`

Audited implementation surfaces:

- application assembly and global/parser route ordering;
- authorized Company route composition and operational controller/service boundary;
- immutable execution request construction for Preview and operational execution;
- EPIC 013 HTTP, composition, service, and frontend test evidence;
- package-script and prior verification evidence.

## 3. Positive Verification

- The new operational service is located in `backend/src/assistant/services/` and depends on ports rather than Express, SQLite, or provider SDKs.
- The operational request uses the new `operational_execution` purpose and loads Company Knowledge through the repository port before provider execution.
- The service acquires the Workspace budget before execution, releases the lease in `finally`, and normalizes unavailable/invalid generation outcomes to the Profile fallback.
- The authorized Company router supplies the operational endpoint under the `chat:use` authorization boundary and applies route-local JSON parsing.
- The operational route is additive and production assembly does not mount the legacy trusted-local Chat router.
- Previous verification recorded 136 passing backend tests, passing frontend tests/typechecks/build, and no reported production dependency vulnerabilities. `backend` has no declared `build` script, so no backend build command can be run.

## 4. Findings By Severity

### AUD-013-001 - Critical - Global JSON parsing precedes authorization for Express-accepted operational route variants

- **Files and symbols:** `backend/src/app.ts`, `operationalPath` and global `express.json` registration; `backend/src/routes/authorizedCompanies.ts`, operational route registration.
- **Evidence:** `operationalPath` at `backend/src/app.ts:7` matches only lower-case paths with no trailing slash. The global parser at line 12 is skipped only when that exact regular expression matches. Express defaults to case-insensitive and non-strict routing, so the mounted `/workspaces/:workspaceId/companies/:companyId/assistant/executions` route can accept, for example, a trailing-slash form or case variant. Those forms fail `operationalPath`, invoke global `express.json()`, and only then reach the authorized router. `backend/src/tests/epic013.http.test.ts` mounts the authorized router directly rather than through `createApp`, so it cannot detect this production assembly failure.
- **Violated contract/risk:** Freeze section 8 requires the operational endpoint to be excluded from global JSON parsing and requires Session, exact Origin, Fetch Metadata, CSRF, User, Membership, Workspace, and `chat:use` before protected parsing. Freeze section 11 requires unauthorized requests not to invoke the parser. A malformed unauthorized request to an accepted variant can produce a parser `400` instead of the required generic `404`, and request bodies can be consumed before authorization.
- **Reproduction/failure scenario:** Send `POST /workspaces/{workspaceId}/companies/{companyId}/assistant/executions/` with `Content-Type: application/json` and an invalid JSON body to the production `createApp` assembly without credentials. Default Express route matching can reach the operational route, but the global parser first handles the body because the trailing slash does not match the exclusion regex.
- **Required remediation:** Make parser exclusion and route matching use the same canonical routing semantics, or restructure app/router middleware so authorization unconditionally precedes the route-local parser for every route spelling Express accepts. Add real `createApp` HTTP tests for trailing-slash and case-routing behavior, both unauthorized malformed bodies and authorized valid bodies.
- **Release-blocking:** Yes.

### AUD-013-002 - Major - Preview and operational flows duplicate the frozen Profile-to-behavior request mapping

- **Files and symbols:** `backend/src/assistant/services/assistantPreviewService.ts:46-58`, `AssistantPreviewService.preview`; `backend/src/assistant/services/operationalAssistantExecutionService.ts:46-51`, `OperationalAssistantExecutionService.execute`.
- **Evidence:** Both services independently construct `AssistantExecutionRequest` objects, copy the same six Profile fields into `behavior`, and call `freezeAssistantExecution`. They are syntactically separate mappings with different formatting and separate future change points.
- **Violated contract/risk:** Freeze section 3 states that Preview and operational services must use the same builder and must not duplicate freezing or Profile-to-behavior mapping. A later Profile or grounding-contract change can make Preview and operational execution behave differently despite both appearing to use the same execution port.
- **Reproduction/failure scenario:** Add or alter a behavior field in one service without updating the other. TypeScript permits the divergent mapping if the field is optional or a default is applied, resulting in different provider requests for the same Profile.
- **Required remediation:** Extract one application-level request builder that owns Profile-to-behavior mapping and freezing; invoke it from both Preview and operational services while each service retains its own authorization, eligibility, purpose, and fallback policy.
- **Release-blocking:** No by itself; required before approval.

### AUD-013-003 - Major - Production route composition is not verified by the required composition test

- **Files and symbols:** `backend/src/tests/epic013.composition.test.ts`, production composition assertion; `backend/src/composition.ts`; `backend/src/index.ts`.
- **Evidence:** The composition test constructs an ad hoc Express router whose endpoint returns a fake response, injects it into `createApp`, and asserts only `assert.ok(app)`. It neither uses the real production composition nor sends a request. It does not prove that the nested operational route is mounted in production, that local Chat is absent, that `chat:use` is enforced, or that the real service can receive a fake execution port without Gemini. The HTTP test likewise constructs the authorized router directly and bypasses `createApp`.
- **Violated contract/risk:** Freeze sections 13 and 11 require a narrowly testable production app boundary with test evidence for production-mode route mounting/local Chat absence, `chat:use`, and fake execution-port wiring. A routing or composition regression can leave all current EPIC 013 tests green.
- **Reproduction/failure scenario:** Remove the operational controller from real `createComposition`, mount the wrong router, or accidentally mount trusted-local Chat in production. The current composition test still passes because it supplies its own router and performs no route assertion.
- **Required remediation:** Test production `createComposition`/`createApp` with controlled dependencies and an actual HTTP request. Assert the real nested route is reachable only under the expected authorization conditions, legacy `/chat` is absent in production, and the injected fake execution port is called rather than Gemini.
- **Release-blocking:** No by itself; required before approval.

## 5. Release Assessment

Release approval is denied until AUD-013-001 is remediated and verified. AUD-013-002 and AUD-013-003 are required architectural and assurance corrections before approval. No Minor findings or Observations were recorded.

## 6. Required Follow-Up Verification

After remediation, run the complete declared backend and frontend suites, both typechecks, frontend production build, and tests that exercise the real production app composition. The parser-ordering suite must cover all routing variants accepted by the configured Express application, including trailing-slash and case behavior, and must prove unauthorized malformed requests never invoke a JSON parser.
