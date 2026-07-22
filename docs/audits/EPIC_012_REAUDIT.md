# EPIC 012 — Independent Re-Audit

## 1. Executive Summary

The remediated EPIC 012 implementation is **not release-ready**. The remediation materially improved publication authority, timeout enforcement, stored-JSON validation, retry status, historical-digest handling, and frontend functionality. All declared tests, typechecks, build, dependency audits, and `git diff --check` pass.

Those green checks do not establish frozen-contract compliance. Of the sixteen original findings, five are resolved, eight are partially resolved, two are not resolved, and one has a regression introduced. Mandatory actual URL adapter tests, hostile PDF containment fixtures, authorization-before-PDF-buffering proof, full Knowledge concurrency/rollback races, exact HTTP contract coverage, authenticated onboarding attribution tests, and complete frontend behavior tests remain absent.

Most importantly, migration 9 was changed without changing its checksum identity. A read-only inspection of the repository's actual runtime database, `database/atlas.sqlite`, found migration 9 recorded with checksum `91d87eb541b129067ce2822e3035f7de45b3760b535f918bad25583c5e4a095a`, while the database still contains the supposedly removed `company_knowledge` compatibility view and contains neither new null-text trigger. Because current code derives the same checksum from unchanged `checksumSource`, startup accepts this stale schema rather than applying the remediated migration body. This is a CRITICAL migration integrity regression and independently blocks release.

## 2. Re-Audit Scope

The re-audit used, in authority order:

1. `docs/freeze/EPIC_012_ARCHITECTURE_FREEZE.md`
2. `docs/audits/EPIC_012_CODE_AUDIT.md`
3. accepted ADRs
4. current production code, tests, migrations, package metadata, lockfiles, runtime database, and command results

The remediation report was treated as untrusted. The audit traced production composition, repository interfaces, migration checksum behavior, route middleware order, timeout/cancellation paths, URL/PDF adapters, frontend API/state/component behavior, and every test matching the claimed remediation evidence. No production code, test, migration, dependency, package file, plan, review, freeze, or original audit was modified.

## 3. Verification Performed

Verification included:

- production wiring from `composition.ts` into Chat, Preview, onboarding, Knowledge service, repositories, and providers;
- repository search for alternate `save/delete` publication methods and legacy runtime SQL;
- execution-path review of outer ingestion deadlines, provider signals, retry backoff, terminal CAS, and late completion;
- strict validator and 128 KiB reconstruction review plus corruption tests;
- raw-PDF middleware ordering and actual HTTP-test coverage review;
- IPv4, mapped-IPv4, IPv6, DNS lookup, redirect, encoding, size, timeout, and abort code review;
- PDF worker resource limits, task/document/page cleanup, active-content checks, termination, and fixture coverage;
- frontend revise/detail, mutation abort, stale result, conflict refresh, localization, limit, and test coverage review;
- migration 9 schema/body/checksum review, migration fixtures, fresh-schema tests, and read-only inspection of `database/atlas.sqlite`;
- publication historical-digest, retry status, SQLite busy, rollback, and concurrency tests;
- inspection of EPIC 004–011 diffs for weakened assertions;
- full prescribed command matrix.

## 4. Finding-by-Finding Resolution Matrix

| Original ID | Status | Release impact |
|---|---|---|
| AUD-012-001 | RESOLVED | None remaining |
| AUD-012-002 | RESOLVED | None remaining |
| AUD-012-003 | RESOLVED | None remaining |
| AUD-012-004 | PARTIALLY RESOLVED | Required proof missing |
| AUD-012-005 | PARTIALLY RESOLVED | SSRF classification assurance incomplete |
| AUD-012-006 | NOT RESOLVED | Release-blocking security test gap |
| AUD-012-007 | PARTIALLY RESOLVED | Release-blocking containment evidence gap |
| AUD-012-008 | PARTIALLY RESOLVED | Required frontend behavior unproven |
| AUD-012-009 | PARTIALLY RESOLVED | Required concurrency/rollback matrix absent |
| AUD-012-010 | REGRESSION INTRODUCED | CRITICAL runtime migration divergence |
| AUD-012-011 | RESOLVED | None remaining |
| AUD-012-012 | PARTIALLY RESOLVED | Exact HTTP contract remains unproven |
| AUD-012-013 | RESOLVED | None remaining |
| AUD-012-014 | PARTIALLY RESOLVED | Actor/error behavior lacks mandatory tests |
| AUD-012-015 | PARTIALLY RESOLVED | Required component/localization coverage absent |
| AUD-012-016 | NOT RESOLVED | Actual runtime database lacks enforcement |

### AUD-012-001 — RESOLVED

- **Evidence:** `KnowledgeRepositoryPort` now exposes only `load`; `KnowledgeRepository` delegates only to `CompanyKnowledgeRepository.loadPublished`. No production `save/delete` method remains. Chat and Preview receive this read-only projection. Frozen onboarding calls `KnowledgeService.create/revise` and `publish`, and test setup uses a test-only fixture helper.
- **Tests:** legacy Chat/Preview and onboarding regressions pass; Knowledge publication tests pass.
- **Residual risk:** no alternate production writer was found.
- **Release impact:** none.

### AUD-012-002 — RESOLVED

- **Evidence:** ingestion and extraction are wrapped in rejecting `Promise.race` deadlines; both controllers are aborted. `GeminiKnowledgeFactExtractor` passes the signal to `GeminiProvider`, the SDK request receives `abortSignal`, and retry delay is abortable. Failure persists only while the exact revision is pending. A late extractor continuation cannot complete the failed revision because terminal update uses pending-state CAS.
- **Tests:** `never-settling and late-settling extraction time out, persist failure, and cannot complete late` exercises short injected deadlines and verifies no publication.
- **Residual risk:** the never-settling provider promise can remain allocated internally, but the request and revision lifecycle terminate; production SDK cancellation is wired.
- **Release impact:** none.

### AUD-012-003 — RESOLVED

- **Evidence:** `validateStoredCompanyKnowledgeJson` enforces the 128 KiB UTF-8 limit, exact root/company/business/FAQ shapes, primitive types, array limits, and field limits. Revision reconstruction calls `validateExtractedBusinessKnowledge`; published/version reconstruction uses the stored snapshot validator. Invalid JSON maps to integrity failure.
- **Tests:** corruption and oversized stored-snapshot tests both fail closed.
- **Residual risk:** none material within this finding.
- **Release impact:** none.

### AUD-012-004 — PARTIALLY RESOLVED

- **Evidence:** route code now wraps `pdfBody` inside the already-authorized handler, so Session, Origin, Fetch Metadata, CSRF, Workspace, membership, and permission checks execute first. Cache headers are set at entry to the authorization middleware.
- **Tests:** no real HTTP test submits an unauthorized oversized/raw PDF and proves the parser was not invoked. `epic012.http.test.ts` tests invalid CSRF only on the JSON manual endpoint.
- **Residual risk:** the code order is correct, but the mandatory regression proof requested by the freeze and remediation prompt is absent; future route refactoring can reverse it unnoticed.
- **Release impact:** required test before approval.

### AUD-012-005 — PARTIALLY RESOLVED

- **Evidence:** mapped IPv4 is normalized; IPv4 private, loopback, link-local, multicast/reserved, documentation, benchmark, and carrier-grade ranges are rejected. IPv6 is restricted to `2000::/3` with several explicit exclusions, and mixed DNS answers fail the actual lookup callback.
- **Tests:** classification covers common IPv4, mapped IPv4, ULA, link-local, site-local, multicast, documentation, and one public IPv6 address.
- **Residual risk:** the hand-maintained IPv6 exclusion list is not proved against the complete current special-purpose registry, and test coverage samples rather than exhaustively table-drives the required classes. No mixed-answer transport test proves the callback behavior.
- **Release impact:** must be completed together with AUD-012-006.

### AUD-012-006 — NOT RESOLVED

- **Evidence:** production code implements direct Node HTTP(S), per-connection lookup validation, redirect revalidation, three-hop limit, HTTPS downgrade rejection, media/identity-encoding checks, streaming byte limit, timeout, and abort. A lookup injection seam was added.
- **Tests:** repository search found no test that instantiates `SecurePublicUrlProvider` or `safeLookup`. There are no actual adapter tests for mixed DNS, rebinding, redirects, downgrade, redirect count, media type, 2 MiB streaming limit, content encoding/decompressed-size policy, timeout, abort, proxy bypass, or exactly-one-page behavior. Existing tests call only `validatePublicUrl` and `publicAddress`.
- **Residual risk:** regressions in the real request/response/redirect/lookup machinery can pass every test.
- **Release impact:** release-blocking frozen security evidence remains absent.

### AUD-012-007 — PARTIALLY RESOLVED

- **Evidence:** worker `resourceLimits` are present; input is bounded; PDF eval/fetch/autofetch/stream behavior is disabled; tasks, documents, and pages are destroyed/cleaned; active JavaScript/actions and attachments are rejected; timeout, abort, worker error/exit, page/text limits, and empty text fail closed.
- **Tests:** only invalid non-PDF bytes and one synthetic one-page PDF are executed. There are still no fixtures for signature position, byte/page/text boundaries, truncation, malformed xref, encryption, scanned/empty input, JavaScript, attachments, references, crash, forced termination, memory exhaustion, abort, or external fetch.
- **Residual risk:** the full suite emits `UnknownErrorException: Unable to load font data ... LiberationSans-Regular.ttf`, proving the claimed standard-font resolution is not clean. Resource containment is implemented but not adversarially demonstrated.
- **Release impact:** release-blocking security/performance evidence remains incomplete.

### AUD-012-008 — PARTIALLY RESOLVED

- **Evidence:** frontend API and component now implement manual/URL/PDF revision commands, revision detail retrieval, mutation-specific `AbortController`, context/unmount cleanup, abort checks before mutation continuations, and publication-conflict reset/reload/re-review messaging.
- **Tests:** existing component tests still contain only the original empty/full-capability render and viewer read-only cases. No test submits revisions, opens details, switches Workspace/Company during a mutation, unmounts, rejects stale success/error, or exercises publication conflict refresh. Reducer coverage remains a single stale tenant response/context reset test.
- **Residual risk:** substantial asynchronous UI behavior is unprotected from regression; the implementation is not equivalent to frozen test evidence.
- **Release impact:** required behavior tests before approval.

### AUD-012-009 — PARTIALLY RESOLVED

- **Evidence:** one new test uses two SQLite connections and a real `BEGIN IMMEDIATE` lock, verifies controlled busy mapping, and asserts no partial source row. A→B→A behavior is separately tested.
- **Tests:** missing separate-connection races remain for revision allocation, one-pending uniqueness, terminal CAS, source CAS, first/equal/stale publication races, concurrent version allocation, and equal publication idempotency. There is no injected failure at each publication write step to prove rollback of version, manifest, publication, and Company status.
- **Residual risk:** most of the frozen concurrency and rollback matrix is still unexercised.
- **Release impact:** release-blocking evidence remains incomplete.

### AUD-012-010 — REGRESSION INTRODUCED

- **Evidence:** fresh migration source removes the compatibility view, adds legacy-null triggers, and enhanced migration tests assert one legacy graph, Unicode/empty values, an unpublished Company, counts, deep snapshot equality, FK integrity, and restart. However migration 9 retains the original `checksumSource` string despite its schema body changing.
- **Runtime verification:** read-only inspection of `database/atlas.sqlite` found the recorded migration-9 checksum accepted by current code, while `sqlite_master` still reports `company_knowledge` as a view and reports zero `knowledge_ready_null_text%` triggers. This demonstrates an already-applied migration-9 database is not remediated at startup.
- **Tests:** no fixture begins with the previously applied migration-9 schema/checksum and verifies a safe forward migration. The enhanced fixture remains a handcrafted pre-Workspace legacy schema, not a production-shaped migration-8 database with multiple Workspaces and boundary data.
- **Residual risk:** runtime schema differs from reviewed source, the legacy query surface remains active, and enforcement depends on whether a database was created before or after remediation.
- **Release impact:** CRITICAL release blocker. Applied migration 9 must not be silently redefined; a new additive migration/checksum strategy and upgrade test are required under the freeze/ADR migration rules.

### AUD-012-011 — RESOLVED

- **Evidence:** `reserveRevision` updates Company to `processing` only when no current publication exists. It therefore does not downgrade a published/ready Company.
- **Tests:** explicit test covers failed/no-publication retry and retry after publication.
- **Residual risk:** none material.
- **Release impact:** none.

### AUD-012-012 — PARTIALLY RESOLVED

- **Evidence:** create/revise/archive/publish DTOs use exact-key validation; manual empty content has a distinct code; body-size, media, extraction, conflict, lifecycle, availability, and not-found categories have controlled mappings; source uniqueness and SQLite busy are translated; authorization-level cache headers were added.
- **Tests:** no table-driven real HTTP coverage verifies unknown fields, manual/URL/aggregate/entity limits, normalized-name races, historical conflict, every lifecycle code, parser error envelopes, safe details, or no-store headers on auth/parser/controller failures. The only Knowledge HTTP test covers CSRF concealment, manual create, publication separation, and publication success.
- **Residual risk:** exact endpoint/status/envelope/header compatibility remains based primarily on inspection, not executable contracts.
- **Release impact:** required HTTP contract suite remains incomplete.

### AUD-012-013 — RESOLVED

- **Evidence:** publication checks for a non-current historical digest inside the transaction and raises controlled `knowledge_historical_version_conflict` before insertion or current-publication mutation.
- **Tests:** A→B→A asserts the controlled error and that B remains current.
- **Residual risk:** concurrent equal-publication behavior remains part of AUD-012-009, not this sequential historical case.
- **Release impact:** none for this finding.

### AUD-012-014 — PARTIALLY RESOLVED

- **Evidence:** authenticated router passes the server-created actor to `createOnboardingController`, which passes it to `OnboardingService`; publication uses `actor.userId`. Current-publication lookup catches only `KnowledgeDomainError("knowledge_unavailable")`; integrity/availability errors propagate. System actor fallback is limited to callers that supply no authenticated actor.
- **Tests:** no test invokes authenticated nested onboarding and asserts `published_by_actor_id`; no corrupted-current-read test proves fail-closed propagation.
- **Residual risk:** wiring is correct by inspection but the mandatory attribution and corrupted-read regressions are absent.
- **Release impact:** required tests before approval.

### AUD-012-015 — PARTIALLY RESOLVED

- **Evidence:** typed English/Spanish labels exist for all source kinds and source/revision statuses rendered by the panel. The component checks 100 KiB/80,000 manual limits and 10 MiB PDF limit and no longer renders raw enums.
- **Tests:** component tests do not exercise either locale's lifecycle labels, manual/PDF boundaries, conflict message, revision/detail controls, or selected-file/sensitive-text cleanup. The textarea's HTML `maxLength=80000` counts UTF-16 code units, while the frozen/server limit counts Unicode code points, producing an unnecessarily stricter UX for astral characters.
- **Residual risk:** localization/limit behavior is implemented but not fully correct or regression-protected.
- **Release impact:** required component coverage and code-point-consistent UX remain.

### AUD-012-016 — NOT RESOLVED

- **Evidence:** fresh migration source defines insert and update triggers that restrict ready null text to a source with `origin='legacy_migration'`; a fresh-database negative test passes.
- **Runtime verification:** the actual existing `database/atlas.sqlite` contains neither trigger because migration 9's checksum identity was not changed and no additive migration applies them.
- **Tests:** no upgrade test covers a database that already recorded the earlier migration 9.
- **Residual risk:** user-origin ready/null rows remain database-acceptable on existing runtime databases.
- **Release impact:** release-blocking until resolved through a valid additive migration path.

## 5. New Findings

### REAUD-012-NEW-001 — CRITICAL — Migration body drift is hidden by an unchanged checksum

- **Files/symbols:** `backend/src/config/migrations.ts`, migration 9 `checksumSource`; `database/atlas.sqlite`, `schema_migrations` and `sqlite_master`.
- **Evidence:** migration 9's body was changed to remove a view and add two triggers, but its checksum source remains `knowledge-sources-v1|immutable-revisions-v1|published-versions-v1|single-current-publication-v1|legacy-backfill-v1`. The runtime database has the accepted recorded checksum but still has the old view and lacks both triggers.
- **Risk:** migration checksum protection no longer represents migration content. Existing installations silently run a different schema than fresh installations, defeating restart safety and the remediation itself.
- **Reproduction:** open `database/atlas.sqlite` read-only; query migration 9, the `company_knowledge` object, and `knowledge_ready_null_text%` triggers. Start current migration logic: the matching checksum prevents the modified body from running.
- **Required remediation:** do not rewrite an applied migration. Restore migration 9's frozen applied definition and introduce a new additive migration with a new ID/checksum to remove the view and add enforcement safely; test upgrade from the exact prior migration-9 schema and checksum. If migration 9 was never released anywhere, reset all development databases explicitly before release and still ensure checksum identity changes whenever the migration body changes, consistent with project migration policy.
- **Release-blocking:** Yes.

New finding counts: **1 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW, 0 INFORMATIONAL**. Residual issues already represented by original audit IDs are not double-counted as new findings.

## 6. Test and Build Verification

Executed on 2026-07-20 from the re-audited working tree:

| Command | Result |
|---|---|
| `backend: npm test` | PASS — 98 tests, 98 pass, 0 fail/cancelled/skipped/todo |
| `backend: npm run typecheck` | PASS |
| `backend: npm audit --omit=dev` | PASS — 0 vulnerabilities |
| `frontend: npm test` | PASS — 44 Node tests plus 11 Vitest component tests; 55 total, 0 failures/skips/todo |
| `frontend: npm run typecheck` | PASS |
| `frontend: npm run build` | PASS — 58 modules transformed |
| `frontend: npm audit --audit-level=high` | PASS — 0 vulnerabilities |
| `git diff --check` | PASS — no whitespace errors; LF-to-CRLF working-copy warnings emitted |

Warnings observed:

- expected controlled onboarding-failure test logs an `OnboardingError` and nested `knowledge_extraction_unavailable` stack;
- PDF test emits `UnknownErrorException` because `LiberationSans-Regular.ttf` cannot be loaded from the configured file URL;
- Git emits line-ending conversion warnings during `git diff --check`.

The totals are real and scripts include `epic012.remediation.test.ts`. They do not contain skips or TODOs. The numerical increase is only three remediation tests: timeout/late completion, A→B→A, and one separate-connection busy case. Mandatory URL, hostile-PDF, full-concurrency, exact-HTTP, actor-attribution, and frontend workflow cases were not added.

## 7. Security Reassessment

Security improved in code: alternate publication writes are removed; provider cancellation is wired; stored data fails closed; PDF parsing follows authorization in route composition; special-address rejection is broader; PDF work is memory-bounded and resources are cleaned; and management responses begin with private/no-store headers.

Security assurance remains below the freeze. No actual URL adapter attack tests exist. PDF containment lacks hostile fixtures and still emits a resource warning. The raw-parser order has no executable regression. The hand-maintained IPv6 policy lacks comprehensive registry-based proof. These are mandatory security gates, not optional test polish.

## 8. Migration and Concurrency Reassessment

Fresh migration behavior is materially stronger, and fresh tests prove graph creation, deep snapshot equality for one Unicode/empty fixture, one unpublished Company, cascade, FK integrity, restart, and the new null-text trigger. It still lacks a production-shaped migration-8 fixture with multiple Workspaces and maximum boundary data.

Existing-database behavior is critically inconsistent due to unchanged migration-9 checksum identity. The actual runtime database proves the view/trigger divergence. This invalidates the remediation claim for legacy cutover and null-text enforcement.

Concurrency evidence now includes one real two-connection busy lock and no-partial-source assertion. It does not cover the mandatory allocation/CAS/publication races or injected transactional rollback points. A→B→A sequential behavior is correct and controlled.

## 9. Frontend Reassessment

The component now exposes create and revise flows for all three kinds, revision detail, archive/publication controls based on server capabilities, mutation aborts, context/unmount cleanup, explicit publication-conflict messaging, limits, and translated enum labels. Plain normalized text is rendered in a `<pre>`, not injected as HTML.

The tests remain essentially pre-remediation: one full-capability empty render and one viewer render, plus one reducer stale/context test. There is no executable evidence for the new revision/detail, abort, stale mutation, conflict, bilingual label, boundary, file cleanup, or sensitive-memory behavior. Manual `maxLength` also does not use the frozen Unicode code-point semantics.

## 10. Regression Assessment

EPIC 004–011 suites pass. Prior assertion changes reviewed during the first audit remain aligned with the freeze's preservation of current publication after failed refresh. Test fixtures were moved from the deleted mutable writer to a frozen compiler/publication fixture, which strengthens publication-authority fidelity.

The new migration checksum/body divergence is a material regression not caught by the suite. Fresh-database tests mask it because they never start from the already-recorded earlier migration 9. The runtime database demonstrates that existing installations and fresh installations now differ.

## 11. Remaining Required Fixes

Remaining original fix IDs:

- `AUD-012-004`: add unauthorized-before-PDF-buffering real-route proof.
- `AUD-012-005` and `AUD-012-006`: complete public-address classification assurance and actual URL adapter adversarial tests.
- `AUD-012-007`: add the complete hostile PDF/resource/timing suite and resolve the font-resource warning.
- `AUD-012-008` and `AUD-012-015`: add real frontend revision/detail/abort/stale/conflict/localization/limit/cleanup tests and correct code-point UX.
- `AUD-012-009`: add separate-connection lifecycle/publication races and injected rollback coverage.
- `AUD-012-010` and `AUD-012-016`: repair migration integrity through a valid additive upgrade and test the exact previous migration-9 schema/checksum.
- `AUD-012-012`: add the exact table-driven HTTP/status/envelope/header suite.
- `AUD-012-014`: add authenticated actor-attribution and corrupted-current-read tests.
- `REAUD-012-NEW-001`: eliminate hidden migration body drift and prove existing-database upgrade behavior.

Resolved IDs that require no further work for their original scope: `AUD-012-001`, `AUD-012-002`, `AUD-012-003`, `AUD-012-011`, and `AUD-012-013`. `AUD-012-014` is correct by inspection but remains partial until its mandatory runtime tests exist.

## 12. Release Recommendation

Resolution counts: **5 RESOLVED, 8 PARTIALLY RESOLVED, 2 NOT RESOLVED, 1 REGRESSION INTRODUCED**.

One CRITICAL new finding and multiple mandatory frozen security/concurrency/migration/frontend/HTTP gates remain. Passing current suites cannot compensate for runtime schema divergence or absent adversarial evidence.

RELEASE BLOCKED
