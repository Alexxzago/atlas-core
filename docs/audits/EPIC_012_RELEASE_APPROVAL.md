# EPIC 012 - Final Release Approval Audit

## Executive Summary

EPIC 012 satisfies the frozen Company Knowledge architecture and the previously identified remediation requirements. The current production model has one current-publication authority, immutable source revisions and published versions, workspace-scoped repository access, published-only runtime retrieval, deterministic compilation, authenticated Knowledge routes, and bounded URL/PDF/manual ingestion.

The authoritative backend Windows test command now executes test files serially with `tsx --test --test-reporter=tap --test-concurrency=1`. This is an infrastructure-only configuration: it preserves the complete test list and every assertion. It is required because parallel test-file execution intermittently terminated a PDF test-file process with Windows native access violation `0xC0000005`; the unchanged complete suite passed under serial execution in all three required runs. Isolation did not identify an Atlas production defect in PDF validation, worker lifecycle, cleanup, abort handling, transferred buffers, or synthetic worker-failure handling.

No release blocker remains under the Architecture Freeze. The prior request for successful worker-side URI processing is not a freeze requirement: the freeze requires external references to fail closed, and `/URI`/`/OpenAction` documents are now rejected before worker creation.

## Authority And Scope

This audit applied authority in this order:

1. `docs/freeze/EPIC_012_ARCHITECTURE_FREEZE.md`
2. Prior EPIC 012 audits: Code Audit, Re-Audit, Final Re-Audit, Release Audit, and the prior Release Approval audit
3. `AGENTS.md`
4. Current source, migrations, tests, package files, lockfiles, and runtime-schema evidence

The audit inspected production composition, repository ownership, runtime Knowledge reads/writes, migrations 9/10, URL/PDF containment, authenticated routes, onboarding, concurrency tests, HTTP contracts, frontend accessibility/state behavior, and all prescribed command results.

## Finding Resolution Matrix

| Finding | Resolution | Evidence |
|---|---|---|
| AUD-012-001 | RESOLVED | `KnowledgeRepository` is read-only; `CompanyKnowledgeRepository.publish` is the sole production publication writer. |
| AUD-012-002 | RESOLVED | Rejecting ingestion/extraction deadlines, abort propagation, and terminal CAS are covered. |
| AUD-012-003 | RESOLVED | Stored Knowledge JSON is bounded and strictly reconstructed. |
| AUD-012-004 | RESOLVED | Route authorization precedes raw PDF parsing; real-route parser-order test covers it. |
| AUD-012-005 | RESOLVED | Public-address classification, mapped IPv4, mixed answers, and rebinding failures are covered. |
| AUD-012-006 | RESOLVED | Actual URL adapter tests cover redirect validation, downgrade, media, encoding, size, timeout, abort, proxy bypass, and one-page retrieval. |
| AUD-012-007 | RESOLVED | Production worker has limits/cleanup and no test hooks; hostile fixtures cover limits, corruption, encryption, JavaScript, attachments, timeout, abort, resource failures, and external-reference rejection before worker creation. |
| AUD-012-008 | RESOLVED | Rendered frontend tests cover context cleanup, stale results, no replay, limits, roles, localization, and Knowledge workflows. |
| AUD-012-009 | RESOLVED | File-backed separate-connection workers exercise production repository/service CAS, allocation, publication, and idempotency operations. |
| AUD-012-010 | RESOLVED | Migration 9 identity is preserved; additive migration 10 performs runtime cutover. |
| AUD-012-011 | RESOLVED | Retry restores processing only where no publication exists. |
| AUD-012-012 | RESOLVED | Authenticated HTTP matrix asserts success envelopes, `Cache-Control`, `Pragma`, status/error mapping, and safe details. |
| AUD-012-013 | RESOLVED | A-to-B-to-A historical digest rejection preserves B as current. |
| AUD-012-014 | RESOLVED | Authenticated nested onboarding proves actor attribution, absence, stored-integrity failure, and real SQLite contention behavior. |
| AUD-012-015 | RESOLVED | Rendered tests prove native Enter/Space activation and loading-to-published/conflict/error announcements. |
| AUD-012-016 | RESOLVED | Insert/update triggers restrict ready null text to legacy-migration sources. |
| REAUD-012-NEW-001 | RESOLVED | Migration checksum/body divergence is eliminated by migration 10. |
| FINAL-REAUD-012-001 | RESOLVED | Serial test-file execution is the authoritative Windows runner; three complete runs pass. |

## PDF And Runner Verification

The production structural envelope rejects `/Encrypt`, JavaScript, attachment, `/URI`, and `/OpenAction` markers before constructing `WorkerPdfTextExtractor`'s worker. The worker receives only the bounded transferred PDF buffer, has resource limits, disables PDF.js fetch/auto-fetch/stream/eval features, and cleans pages/loading tasks before termination.

The freeze requires external references to fail closed. It does not require a worker to successfully process a URI-bearing document. Therefore the external-reference rejection test is the authoritative behavior; worker-side URI no-fetch evidence is inapplicable because the worker does not start for such input.

The Windows crash investigation established that the native access violation occurs only under parallel Node test-file execution. The PDF suite, combined PDF resource tests, and complete suite all pass under serial file execution. The backend command retains all tests and assertions and only configures the test runner with `--test-concurrency=1`.

## Migration And Runtime Integrity

- Migration count: 10.
- Migration 9: `0009_company_knowledge_foundation` with checksum `91d87eb541b129067ce2822e3035f7de45b3760b535f918bad25583c5e4a095a`.
- Migration 10: `0010_company_knowledge_runtime_cutover` with checksum `063e8c681fc70adbcd4d45d227ba8311727e1c21b3c3b0e6535b185a1d54b8fd`.
- Migration tests verify the applied migration-9 upgrade, additive migration-10 cutover, restart safety, absent compatibility view, null-text enforcement, foreign keys, and Company Knowledge graph integrity.

## Verification Commands And Results

| Command | Result |
|---|---|
| `C:\ATLAS\backend\npm test` run 1 | PASS - 132/132; 0 failed/cancelled/skipped/TODO. |
| `C:\ATLAS\backend\npm test` run 2 | PASS - 132/132; 0 failed/cancelled/skipped/TODO. |
| `C:\ATLAS\backend\npm test` run 3 | PASS - 132/132; 0 failed/cancelled/skipped/TODO. |
| `C:\ATLAS\backend\npm run typecheck` | PASS. |
| `C:\ATLAS\backend\npm audit --omit=dev` | PASS - 0 vulnerabilities. |
| `C:\ATLAS\frontend\npm test` | PASS - 44 Node tests and 40 Vitest tests; 84/84. |
| `C:\ATLAS\frontend\npm run typecheck` | PASS. |
| `C:\ATLAS\frontend\npm run build` | PASS - 58 modules transformed. |
| `C:\ATLAS\frontend\npm audit --audit-level=high` | PASS - 0 vulnerabilities. |
| `C:\ATLAS\git diff --check` | PASS - existing LF-to-CRLF notices only. |

Expected controlled onboarding failure diagnostics were emitted during negative-path backend tests. They did not cause a failure.

## Exact Git Status

```text
 M backend/package-lock.json
 M backend/package.json
 M backend/src/app.ts
 M backend/src/application/ports/repositories.ts
 M backend/src/composition.ts
 M backend/src/config/migrations.ts
 M backend/src/controllers/onboarding.ts
 M backend/src/controllers/workspaceAdministrationController.ts
 M backend/src/providers/gemini.ts
 M backend/src/providers/prompts.ts
 M backend/src/repositories/knowledgeRepository.ts
 M backend/src/routes/authorizedCompanies.ts
 M backend/src/services/onboardingService.ts
 M backend/src/tests/epic004.test.ts
 M backend/src/tests/epic005.test.ts
 M backend/src/tests/epic007.test.ts
 M backend/src/tests/epic0081.test.ts
 M backend/src/tests/epic0082.test.ts
 M backend/src/tests/epic0083.test.ts
 M backend/src/tests/epic0084.test.ts
 M backend/src/tests/epic009.repository.test.ts
 M backend/src/tests/epic011.http.test.ts
 M backend/src/workspace/domain/membership.ts
 M backend/src/workspace/services/authorizationService.ts
 M frontend/package-lock.json
 M frontend/package.json
 M frontend/src/api/atlasApi.ts
 M frontend/src/components/AuthenticatedCompanyPortal.tsx
 M frontend/src/i18n/translations.ts
 M frontend/src/types/api.ts
?? EPIC_012_OPENCODE_RESUME_PROMPT.md
?? EPIC_012_SERIAL_RUNNER_RELEASE_COMPLETION_PROMPT.md
?? backend/src/controllers/companyKnowledgeController.ts
?? backend/src/knowledge/
?? backend/src/repositories/companyKnowledgeRepository.ts
?? backend/src/tests/epic012.authorization-order.test.ts
?? backend/src/tests/epic012.concurrency.test.ts
?? backend/src/tests/epic012.http-matrix.test.ts
?? backend/src/tests/epic012.http.test.ts
?? backend/src/tests/epic012.onboarding-evidence.test.ts
?? backend/src/tests/epic012.pdf-hostile.test.ts
?? backend/src/tests/epic012.pdf-resource.test.ts
?? backend/src/tests/epic012.remediation.test.ts
?? backend/src/tests/epic012.test.ts
?? backend/src/tests/epic012.url-security.test.ts
?? backend/src/tests/helpers/companyKnowledgeRaceWorker.ts
?? backend/src/tests/knowledgeTestFixture.ts
?? docs/audits/
?? docs/freeze/
?? docs/plans/
?? docs/reviews/
?? frontend/src/components/CompanyKnowledgePanel.test.tsx
?? frontend/src/components/CompanyKnowledgePanel.tsx
?? frontend/src/state/knowledgeState.test.ts
?? frontend/src/state/knowledgeState.ts
```

## Final Verdict

RELEASE APPROVED
