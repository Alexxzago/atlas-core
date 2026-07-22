# EPIC 012 — Third Independent Re-Audit

## 1. Executive Summary

The migration-integrity regression identified by the second audit is resolved. Migration 9 has its previously applied checksum and behavior, migration 10 performs the runtime cutover additively, and the actual development database now has exactly ten migrations, no obsolete compatibility view, both null-text enforcement triggers, valid foreign keys, and a successful integrity check.

The implementation is nevertheless not release-ready. Mandatory frozen evidence remains incomplete for the actual URL adapter, hostile PDF containment, Knowledge concurrency, exact HTTP contracts, authenticated onboarding attribution/error handling, and frontend workflows. The prior remediation report's claim that every remaining finding was fixed is not supported by the repository.

In addition, the prescribed backend `npm test` failed in two consecutive full-suite executions. In both runs, `epic012.test.ts` terminated at file level immediately after its real PDF worker tests, leaving later tests in that file unexecuted. The same file passed when run alone. This is a new HIGH release-blocking test-isolation/resource-lifecycle finding.

Resolution totals for the findings under re-audit: **9 RESOLVED, 8 PARTIALLY RESOLVED, 0 NOT RESOLVED, 0 REGRESSION INTRODUCED**. One new HIGH finding was identified.

## 2. Audit Scope

This audit treated all implementation and remediation reports as untrusted and used, in authority order:

1. `docs/freeze/EPIC_012_ARCHITECTURE_FREEZE.md`
2. `docs/audits/EPIC_012_CODE_AUDIT.md`
3. `docs/audits/EPIC_012_REAUDIT.md`
4. accepted ADRs and the Atlas architecture/engineering baseline
5. current source, migrations, tests, package metadata, dependency lockfiles, and `database/atlas.sqlite`

The audit traced production composition, authorization middleware ordering, repository write authority, ingestion deadlines, stored-data reconstruction, URL/PDF adapters, onboarding actor flow, frontend state/component behavior, migration execution, and every EPIC 012 test included by the default scripts.

No production code, tests, migrations, dependencies, package files, plans, reviews, freeze documents, or previous audits were modified.

## 3. Verification Performed

- Inspected migration 9 and 10 source, checksum identities, execution ordering, upgrade fixture, restart behavior, triggers, compatibility objects, and actual runtime schema.
- Queried the runtime database read-only for all migration records, Knowledge objects, Company/publication counts, foreign-key violations, and integrity.
- Traced the sole production publication writer and current-publication reader through composition, Chat, Preview, onboarding, and Knowledge services.
- Inspected actual URL transport, connection lookup, redirect handling, response limits, timeout/abort behavior, and all adapter tests.
- Inspected raw-PDF route ordering, parser-observation tests, worker limits/cleanup, and every PDF fixture/test.
- Reviewed separate-connection contention tests, publication fault injection, CAS paths, and the required race matrix.
- Reviewed real Knowledge HTTP route tests and mappings for exact DTO, status, envelope, isolation, and cache contracts.
- Traced authenticated onboarding actor construction into publication and searched tests for persisted actor/error assertions.
- Reviewed rendered frontend tests and reducer tests against every mandatory workflow, role, locale, limit, cleanup, stale-result, and accessibility requirement.
- Executed the prescribed test, typecheck, build, audit, whitespace, and status commands.

## 4. Finding Resolution Matrix

| Finding | Classification | Release impact |
|---|---|---|
| AUD-012-001 | RESOLVED | None remaining |
| AUD-012-002 | RESOLVED | None remaining |
| AUD-012-003 | RESOLVED | None remaining |
| AUD-012-004 | RESOLVED | None remaining |
| AUD-012-005 | PARTIALLY RESOLVED | Complete address/transport proof missing |
| AUD-012-006 | PARTIALLY RESOLVED | Actual downgrade and connection-time adversarial proof missing |
| AUD-012-007 | PARTIALLY RESOLVED | Hostile PDF matrix remains incomplete |
| AUD-012-008 | PARTIALLY RESOLVED | Required frontend workflows untested |
| AUD-012-009 | PARTIALLY RESOLVED | Most separate-connection races absent |
| AUD-012-010 | RESOLVED | Additive upgrade verified |
| AUD-012-011 | RESOLVED | None remaining |
| AUD-012-012 | PARTIALLY RESOLVED | Exact HTTP matrix absent |
| AUD-012-013 | RESOLVED | None remaining |
| AUD-012-014 | PARTIALLY RESOLVED | Authenticated attribution/error tests absent |
| AUD-012-015 | PARTIALLY RESOLVED | Locale/limit/role/workflow coverage incomplete |
| AUD-012-016 | RESOLVED | Runtime enforcement verified |
| REAUD-012-NEW-001 | RESOLVED | Migration identity divergence eliminated |

### Resolved findings

- **AUD-012-001:** The production `KnowledgeRepositoryPort` projection exposes only `load`; Chat and Preview read the current publication. `CompanyKnowledgeRepository.publish` remains the single production writer. Test-only fixture publication is explicitly isolated under tests.
- **AUD-012-002:** Rejecting ingestion/extraction deadlines, abort propagation, retry cancellation, pending-state terminal CAS, and late-completion rejection remain implemented and covered.
- **AUD-012-003:** Published snapshots are size-bounded and strictly reconstructed; corruption and oversize fail closed.
- **AUD-012-004:** The PDF parser is invoked inside the already-authorized handler. The real Express test proves unauthenticated and invalid-CSRF raw PDF requests return generic 404 with private/no-store headers while parser invocation stays zero; an authorized upload invokes it once and succeeds.
- **AUD-012-010 / AUD-012-016 / REAUD-012-NEW-001:** Migration 9's applied checksum is preserved and migration 10 additively removes the view and creates both null-text triggers. Exact migration-9 upgrade, restart, unpublished Company, and foreign-key assertions pass. The actual database matches.
- **AUD-012-011:** Revision reservation updates a Company to processing only when no publication exists, and the regression test preserves ready after publication.
- **AUD-012-013:** A historical non-current digest raises `knowledge_historical_version_conflict`; the A→B→A test confirms B remains current.

### Partially resolved findings

- **AUD-012-005:** Address classification is materially broader and mapped IPv4 is normalized. Tests sample IPv4, mapped IPv4, and IPv6 special ranges. They do not table-drive every required special-use class, and mixed/rebound DNS tests invoke `createSafeLookup` directly rather than exercising `SecurePublicUrlProvider` transport.
- **AUD-012-006:** Real adapter tests cover a redirect, redirect overflow, content type, identity-encoding policy, streaming overflow, timeout, abort, proxy-environment bypass, and one-page-only behavior. No test executes an HTTPS-to-HTTP downgrade; `/downgrade` exists in the fixture but is never requested. Mixed DNS and rebinding remain lookup-helper tests, not actual provider requests. No real transport test demonstrates validation at each rebound connection.
- **AUD-012-007:** Production has worker resource limits, default 15-second termination, loading-task/document/page cleanup, active-content checks, no-worker-fetch settings, page/text bounds, and no raw persistence. Tests cover invalid signature, one valid PDF, signature-window edge, exact/over byte limit through an injected success worker, injected crash, short timeout, and abort. They do not cover real 100-page or text boundaries, truncation, malformed xref, encryption, scanned/empty input, JavaScript/actions, attachments, external references, memory pressure, or no-network behavior. The font warning no longer appeared, but hostile containment remains unproved.
- **AUD-012-008:** The component implements create/revise branches, detail loading, mutation abort controllers, stale abort checks, and publication-conflict reload/re-review state. Rendered tests cover only Manual/URL creation, sensitive-name cleanup, and Company-change abort. PDF creation/retry, all three revision flows, detail, stale success/error, conflict, Workspace/logout/unmount cleanup, and selected-file cleanup are absent.
- **AUD-012-009:** One separate-file two-connection busy-lock test and four publication rollback injections exist. The rollback test proves no partial version, manifest, or publication rows and unchanged pre-publication Company status. Required separate-connection races for revision-number allocation, one-pending uniqueness, terminal/source CAS, first/stale/equal publication, concurrent equal idempotency, and version allocation are absent. Rollback preservation of an existing current publication is also not asserted.
- **AUD-012-012:** One real authenticated route test covers invalid CSRF, successful Manual creation, publication separation, and successful publication; the parser-order test covers PDF authorization errors and headers. There is no table-driven real-route coverage for unknown fields, empty Manual/URL input, source names/count, Manual/URL/PDF size/media variants, normalized uniqueness, lifecycle states, historical digest, publication CAS response, parser/provider failures, cross-tenant 404, `knowledge_unavailable`, safe error details, or cache headers across controller/parser/success cases.
- **AUD-012-014:** Production wiring passes the authenticated actor through nested onboarding and catches only explicit `knowledge_unavailable` when reading current publication. No authenticated nested-onboarding test asserts `published_by_actor_id`, excludes the system actor, corrupts the current snapshot, proves safe availability/integrity propagation, or demonstrates failed-refresh publication preservation through that route.
- **AUD-012-015:** UTF-16 `maxLength` was removed and production code uses code-point and UTF-8-byte checks. Rendered tests do not exercise actual byte/code-point boundaries, the 10 MiB PDF limit, PDF cleanup, English and Spanish lifecycle labels, status translations, Administrator/Owner differences, publication conflict/re-review, revision details, or the complete keyboard/accessibility workflow.

## 5. New Findings

### FINAL-REAUD-012-001 — HIGH — Default backend suite fails under full-suite execution

- **Evidence:** Two consecutive prescribed `backend: npm test` executions failed. Both reported `epic012.test.ts` as a file-level failure immediately after `PDF worker parses bounded real PDF text in isolation`; subsequent tests in that file did not execute. Each run reported 103 discovered tests, 102 passed, and 1 failed. Running `npx tsx --test src/tests/epic012.test.ts` alone passed all 12 tests.
- **Risk:** The required default verification gate is not stable, and PDF worker lifecycle/resource interaction appears sensitive to concurrent test-file execution. A green isolated file cannot substitute for the frozen full regression command.
- **Required fix:** Identify and correct the worker/test isolation or resource-lifecycle failure, then prove repeated default-suite success without serializing away required concurrency evidence or omitting tests.
- **Release blocking:** Yes.

New finding counts: **0 CRITICAL, 1 HIGH, 0 MEDIUM, 0 LOW, 0 INFORMATIONAL**.

## 6. Migration Verification

Migration verification passes:

- Migration count: **10**.
- Migration 9: `0009_company_knowledge_foundation`.
- Migration 9 checksum: `91d87eb541b129067ce2822e3035f7de45b3760b535f918bad25583c5e4a095a`.
- Migration 10: `0010_company_knowledge_runtime_cutover`.
- Migration 10 checksum: `063e8c681fc70adbcd4d45d227ba8311727e1c21b3c3b0e6535b185a1d54b8fd`.
- Exact prior migration-9 upgrade test: pass.
- Migration-9 checksum before/after upgrade: unchanged.
- Restart applies exactly ten migration records.
- Obsolete `company_knowledge` compatibility view: absent.
- `knowledge_ready_null_text_legacy_only`: present.
- `knowledge_ready_null_text_legacy_only_update`: present.
- Runtime database Company count: 4.
- Runtime source count: 2.
- Runtime publication count: 2.
- Runtime Companies without publication: 2.
- `PRAGMA foreign_key_check`: zero rows.
- `PRAGMA integrity_check`: `ok`.

The additive migration does not rebuild Companies or the Knowledge graph. Workspace ownership continues through Company joins. The exact-upgrade fixture proves an unpublished Company remains unpublished. Existing development data survived the applied migration.

## 7. Security Verification

Authorization-before-buffering is verified by executable middleware-order evidence, including parser non-invocation and cache headers. URL and PDF production code contain substantial defensive controls, but the frozen security test contract is not satisfied because mandatory adversarial cases remain absent.

The URL adapter directly uses Node HTTP(S), supplies the safe lookup on each connection, rejects non-public answers, validates redirects, rejects protocol downgrade in code, streams with a 2 MiB ceiling, requires identity encoding, and enforces timeout/abort. Missing actual-adapter tests prevent full approval of those paths.

The PDF adapter uses a worker with 128 MiB old-generation, 16 MiB young-generation, and 4 MiB stack limits; production timeout remains 15 seconds. PDF.js worker fetching, auto-fetch, streaming, and eval are disabled; pages, document/loading task, and worker are cleaned/terminated. The previous standard-font warning did not recur. The majority of mandatory hostile fixtures and external-fetch proof remain absent.

## 8. Concurrency Verification

Verified evidence:

- real two-connection SQLite busy contention maps to `knowledge_temporarily_unavailable` and leaves no source row;
- sequential publication CAS and A→B→A historical conflict pass;
- publication fault injection after version insert, manifest insert, publication write, and Company status update rolls back all new publication rows and passes foreign-key checks;
- schema uniqueness enforces normalized source names, one pending revision, Company-local version numbers, and Company digest uniqueness.

Missing evidence:

- separate-connection concurrent revision allocation and one-pending race;
- concurrent terminal and source CAS;
- first-publication race;
- stale-publication race;
- equal-current and concurrent-equal publication idempotency;
- concurrent version allocation;
- rollback injections starting from an existing publication and proving current-publication/status preservation.

Schema and transactions are promising, but the mandatory executable race matrix is not present.

## 9. HTTP Verification

Real authentication, CSRF concealment, Manual ingestion, publication separation, successful publication, PDF authorization order, generic 404, and private/no-store headers have executable coverage. Controllers map domain errors to controlled status/envelope categories and do not deliberately expose stacks or SQL.

The exact frozen HTTP compatibility matrix is still absent. Only two EPIC 012 real-route tests exist, one of which uses cast fake authorization dependencies solely to observe parser order. Required DTO, limit, uniqueness, lifecycle, provider/parser, tenant-isolation, availability, and complete header assertions are not table-driven or comprehensively executed.

## 10. Frontend Verification

Production behavior includes Manual/URL/PDF create and revision branches, detail retrieval, mutation-specific abort controllers, context/unmount cleanup, server-capability controls, publication conflict reload/re-review, translated enum labels, code-point/byte validation, and safe plain-text detail rendering.

Executable frontend evidence remains far below the freeze. The Knowledge reducer has one combined stale-context test. The rendered suite contains six test instances: basic capability rendering, Viewer/Operator distinction, Manual creation, URL creation, absence of `maxLength`, and Company-change abort. It does not verify PDF operations, retry/revision flows, details, conflict recovery, stale success/error suppression, Workspace/logout/unmount cleanup, file cleanup, real boundaries, Spanish labels, Administrator/Owner controls, or comprehensive keyboard/accessibility behavior.

## 11. Regression Verification

- Production architecture retains repository-only SQLite access and provider-only external I/O for the Knowledge module.
- Chat and Preview consume the bounded current publication through a read-only projection.
- No production alternate publication writer or legacy `company_knowledge` runtime query was found.
- Deadlines, stored JSON validation, retry status, failed-refresh preservation, and A→B→A handling remain implemented.
- EPIC 004–011 tests reached passing assertions before the EPIC 012 file-level failure; no skipped or TODO tests were reported.
- `git diff --check` passed with only CRLF conversion warnings.
- Full regression approval is withheld because the default backend command itself failed twice.

## 12. Test and Build Results

| Command | Result |
|---|---|
| `backend: npm test` — run 1 | **FAIL** — 103 tests discovered, 102 pass, 1 file-level failure, 0 skipped/TODO |
| `backend: npm test` — run 2 | **FAIL** — 103 tests discovered, 102 pass, 1 file-level failure, 0 skipped/TODO |
| `backend: npx tsx --test src/tests/epic012.test.ts` | PASS — 12/12 |
| `backend: npm run typecheck` | PASS |
| `backend: npm audit --omit=dev` | PASS — 0 vulnerabilities |
| `frontend: npm test` | PASS — 59 total: 44 Node + 15 Vitest, 0 failed/skipped/TODO |
| `frontend: npm run typecheck` | PASS |
| `frontend: npm run build` | PASS — 58 modules transformed |
| `frontend: npm audit --audit-level=high` | PASS — 0 vulnerabilities |
| `git diff --check` | PASS — CRLF conversion warnings only |

Observed warnings/events:

- Expected controlled onboarding-failure test logs an `OnboardingError` stack.
- No PDF.js standard-font warning appeared.
- Git reported LF-to-CRLF working-copy warnings.
- The full backend runner twice reported an unexplained `epic012.test.ts` file-level failure; the isolated file passed.

## 13. Remaining Fixes

Remaining partially resolved audit IDs:

- `AUD-012-005`
- `AUD-012-006`
- `AUD-012-007`
- `AUD-012-008`
- `AUD-012-009`
- `AUD-012-012`
- `AUD-012-014`
- `AUD-012-015`

New required fix:

- `FINAL-REAUD-012-001`

Required work remains verification-focused but mandatory: complete actual URL downgrade/rebinding tests, hostile PDF fixtures, separate-connection concurrency races, exact real HTTP matrix, authenticated onboarding attribution/error tests, complete rendered frontend workflows/locales/limits/roles, and stabilize the default backend test command.

Exact `git status --short` at audit completion:

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
 M frontend/package.json
 M frontend/src/api/atlasApi.ts
 M frontend/src/components/AuthenticatedCompanyPortal.tsx
 M frontend/src/i18n/translations.ts
 M frontend/src/types/api.ts
?? backend/src/controllers/companyKnowledgeController.ts
?? backend/src/knowledge/
?? backend/src/repositories/companyKnowledgeRepository.ts
?? backend/src/tests/epic012.authorization-order.test.ts
?? backend/src/tests/epic012.http.test.ts
?? backend/src/tests/epic012.remediation.test.ts
?? backend/src/tests/epic012.test.ts
?? backend/src/tests/epic012.url-security.test.ts
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

## 14. Release Recommendation

Migration integrity and several original implementation defects are fixed, but eight mandatory frozen evidence groups remain partial and the required backend test command fails reproducibly under full-suite execution. Release cannot be approved until those gaps and the new test-instability finding are resolved.

RELEASE BLOCKED
