# EPIC 012 — Final Independent Release Audit

## 1. Executive Summary

EPIC 012 is operationally stable under the prescribed verification commands, but it is not release-ready against the frozen testing contract. Three consecutive default backend runs passed 124/124, frontend tests passed 71/71, both typechecks and the production build passed, dependency audits reported zero known vulnerabilities, and the runtime SQLite database has the correct ten migrations and integrity state.

The URL adapter and the backend PDF file-level stability finding are materially remediated. Migration identity and runtime cutover remain correct. Nevertheless, mandatory frozen executable evidence is still incomplete for hostile PDF containment, Knowledge concurrency, exact HTTP contracts, authenticated onboarding failure behavior, and rendered frontend stale-result and boundary workflows. These are not failures observed in the happy path; they are missing release evidence expressly required by the Architecture Freeze.

Across the 18 findings in scope, 12 are **RESOLVED**, 6 are **PARTIALLY RESOLVED**, 0 are **NOT RESOLVED**, and 0 have a **REGRESSION INTRODUCED**. No distinct new finding was opened because the remaining release blockers are continuations of existing IDs.

## 2. Audit Scope

This audit treated implementation and remediation reports as untrusted. Authority was applied in this order:

1. `docs/freeze/EPIC_012_ARCHITECTURE_FREEZE.md`
2. `docs/audits/EPIC_012_CODE_AUDIT.md`
3. `docs/audits/EPIC_012_REAUDIT.md`
4. `docs/audits/EPIC_012_FINAL_REAUDIT.md`
5. accepted ADRs, especially ADR-004, ADR-008, ADR-010, and ADR-013
6. current source, migrations, tests, lockfiles, and runtime database

The audit traced production composition, repository authority, Chat and Preview reads, Knowledge service lifecycle, migration identities and runtime objects, middleware order, URL transport, PDF worker protocol, onboarding actor propagation, controller mappings, frontend behavior, and the test files included by the default scripts.

No production code, test, migration, dependency, package file, plan, review, freeze document, or previous audit was modified.

## 3. Verification Performed

- Traced every production write to `company_knowledge_versions` and `company_knowledge_publications`.
- Verified the legacy compatibility `KnowledgeRepository` is read-only and delegates to the frozen published reader.
- Verified Chat and Assistant Preview receive only the read-only `KnowledgeRepositoryPort.load` projection.
- Inspected revision reservation/completion, deadlines, deterministic compilation, publication CAS, historical digest handling, and stored JSON validation.
- Verified authorization wraps the raw PDF parser and executed its real Express ordering test.
- Inspected the real URL provider and all actual-adapter tests.
- Inspected PDF worker limits, transfer, termination, loading-task/page cleanup, and hostile/resource tests.
- Compared the required separate-connection and rollback matrix with tests actually executed.
- Compared the exact frozen HTTP matrix with real-route cases actually executed.
- Traced authenticated actor construction through nested onboarding and searched executable attribution/error evidence.
- Compared rendered frontend tests with every required source, revision, abort, stale-result, role, locale, limit, conflict, cleanup, and accessibility case.
- Queried `database/atlas.sqlite` read-only for migrations, schema objects, counts, foreign keys, and integrity.
- Executed all required backend, frontend, dependency, whitespace, and status commands.

## 4. Complete Finding Resolution Matrix

| Finding | Classification | Release impact |
|---|---|---|
| AUD-012-001 | RESOLVED | One production publication writer; compatibility reader is load-only |
| AUD-012-002 | RESOLVED | Rejecting deadlines, abort propagation, terminal CAS, and late-result rejection are implemented and tested |
| AUD-012-003 | RESOLVED | Stored publication/extraction JSON is strictly reconstructed and bounded |
| AUD-012-004 | RESOLVED | Authentication and authorization execute before raw PDF buffering |
| AUD-012-005 | RESOLVED | IPv4, mapped IPv4, IPv6, mixed-answer, and rebound destinations fail closed |
| AUD-012-006 | RESOLVED | Actual adapter exercises redirects, downgrade, media, encoding, size, timeout, abort, direct transport, and one-page behavior |
| AUD-012-007 | PARTIALLY RESOLVED | Lifecycle is stable, but several hostile fixtures/no-network assertions do not prove the exact attack form |
| AUD-012-008 | PARTIALLY RESOLVED | Main workflows exist; rendered stale success/error and complete context-sensitive cleanup evidence remain incomplete |
| AUD-012-009 | PARTIALLY RESOLVED | Busy contention and rollback pass; most required separate-connection races remain absent |
| AUD-012-010 | RESOLVED | Applied migration identity and additive runtime cutover are verified |
| AUD-012-011 | RESOLVED | Retry moves unpublished Company to processing without downgrading a published Company |
| AUD-012-012 | PARTIALLY RESOLVED | Real route basics pass; the exact table-driven HTTP/error/header matrix remains absent |
| AUD-012-013 | RESOLVED | A→B→A historical digest conflict preserves B as current |
| AUD-012-014 | PARTIALLY RESOLVED | Actor propagation works; authenticated nested-route and error/integrity matrix remains absent |
| AUD-012-015 | PARTIALLY RESOLVED | Role/locale/PDF/workflow coverage improved; rendered code-point, UTF-8, stale-result, and complete accessibility boundaries remain incomplete |
| AUD-012-016 | RESOLVED | Runtime insert/update triggers enforce the legacy-only null-text exception |
| REAUD-012-NEW-001 | RESOLVED | Migration 9 identity is preserved; migration 10 owns the additive cutover |
| FINAL-REAUD-012-001 | RESOLVED | Default backend suite passes repeatedly with deterministic worker cleanup and bounded resources |

Resolution totals: **12 RESOLVED, 6 PARTIALLY RESOLVED, 0 NOT RESOLVED, 0 REGRESSION INTRODUCED**.

## 5. New Findings

No separate new finding was opened. Outstanding mandatory work remains attributable to `AUD-012-007`, `AUD-012-008`, `AUD-012-009`, `AUD-012-012`, `AUD-012-014`, and `AUD-012-015`.

New finding counts: **0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW, 0 INFORMATIONAL**.

## 6. Architecture Verification

The production architecture complies with the core frozen model:

- Workspace is the tenant boundary and Company owns the Knowledge graph.
- `CompanyKnowledgeRepository.publish` is the only production publication writer.
- `KnowledgeRepository` is a read-only adapter exposing only `load` and delegates to `loadPublished`.
- Chat and Assistant Preview consume that published projection. Neither selects latest revisions nor accesses SQLite directly.
- One `company_knowledge_publications` row is the current-publication authority; no Company publication pointer or publication-event aggregate exists.
- Publication uses exact ready revision IDs, deterministic compilation, immutable versions, a manifest, expected-current CAS, and historical-digest rejection.
- Providers perform external acquisition/extraction; repositories alone access SQLite; services retain lifecycle and publication rules.
- No vector store, embeddings, OCR, crawl, queue, raw PDF persistence, Assistant-owned Knowledge, or provider-selected tenant authority was introduced.
- ADR-008 `WorkspaceContext` remains separate from server-created `ActorContext`; ADR-013 execution remains provider-neutral.

## 7. Migration Verification

Migration verification passed:

- Applied migration count: **10**.
- Migration 9: `0009_company_knowledge_foundation`.
- Migration 9 checksum: `91d87eb541b129067ce2822e3035f7de45b3760b535f918bad25583c5e4a095a`.
- Migration 10: `0010_company_knowledge_runtime_cutover`.
- Migration 10 checksum: `063e8c681fc70adbcd4d45d227ba8311727e1c21b3c3b0e6535b185a1d54b8fd`.
- Computed checksums match the applied runtime records.
- The exact migration-9 upgrade regression passes and preserves migration 9's checksum.
- Migration 10 is distinct and additive: it removes the compatibility view and creates insert/update enforcement triggers.
- `company_knowledge` compatibility view: **absent**.
- `company_knowledge_legacy` table: **present**.
- `knowledge_ready_null_text_legacy_only`: **present**.
- `knowledge_ready_null_text_legacy_only_update`: **present**.
- Runtime Companies: **4**; sources: **2**; versions: **2**; publications: **2**.
- `PRAGMA foreign_key_check`: **zero rows**.
- `PRAGMA integrity_check`: **ok**.

## 8. Security Verification

### URL adapter

The actual `SecurePublicUrlProvider` is exercised, not only helper functions. Evidence covers special-use IPv4 and IPv6 literals, IPv4-mapped IPv6, mixed public/private DNS, rebound lookup on a second connection, direct connection-time lookup, redirect validation and overflow, HTTPS-to-HTTP downgrade using the `/downgrade` fixture, textual media types, identity-only encoding, the streaming 2 MiB limit, timeout, caller abort, direct transport despite proxy environment variables, and exactly one fetched page.

Production sets `agent: false`, causing a fresh validated lookup on each connection/redirect. Any non-public answer fails closed. Raw transport failures map to controlled domain errors. `AUD-012-005` and `AUD-012-006` are resolved.

### PDF authorization and worker

The real route wraps `express.raw` inside the successful authorization continuation. Unauthenticated and invalid-CSRF requests return concealed 404 responses with private/no-store headers while parser invocation remains zero; an authorized request invokes it once.

The worker transfers an exact byte buffer, applies explicit resource limits (48 MiB old generation, 4 MiB young generation, 4 MiB stack), retains the frozen 15-second production timeout, disables PDF.js worker fetch/auto-fetch/stream/eval features, cleans each page, awaits loading-task destruction, closes the message port, and makes forced paths await termination. Three complete default runs show no file-level failure or open-handle hang.

Coverage includes real 100/101-page and normalized-text boundaries, truncation, malformed xref, empty text, active-content markers, external URI references, injected memory pressure, crash, timeout, and caller abort. No PDF.js warning appeared in the audit runs.

`AUD-012-007` remains partial because the encrypted test adds an `/Encrypt` reference without a valid encrypted/password-protected document, the attachment test injects a marker rather than parsing a valid embedded-file structure, and replacing `globalThis.fetch` in the parent does not independently prove that a worker-thread PDF parser cannot initiate another network mechanism. The production controls are strong, but the exact hostile-fixture proof required by the freeze is incomplete.

## 9. Concurrency and Rollback Verification

Verified executable evidence:

- a real file-backed two-connection SQLite busy lock maps to `knowledge_temporarily_unavailable` and leaves no partial source row;
- sequential publication CAS rejects a stale expected version;
- A→B→A historical digest conflict preserves B;
- fault injection after version insert, manifest insert, publication write, and Company status update rolls back all new rows;
- the same four fault points preserve an existing current publication and ready Company status;
- database uniqueness enforces normalized source names, one pending revision, source-local revision number, Company-local version number, digest uniqueness, and current-publication shape.

Missing frozen evidence:

- concurrent revision-number allocation on separate connections;
- one-pending race on separate connections;
- terminal revision CAS race;
- source-version CAS race;
- first-publication and stale-publication races;
- equal-current idempotency and concurrent-equal publication races;
- concurrent Company version allocation.

The only explicit separate-connection Knowledge race is busy-lock exhaustion. Schema constraints and synchronous single-connection tests do not substitute for the required deterministic race matrix. `AUD-012-009` remains partially resolved and release-blocking.

## 10. HTTP Verification

Real-route tests verify Session/CSRF concealment, Owner-authorized Manual ingestion, unpublished separation, explicit publication, PDF authorization ordering, stable generic 404 behavior, and private/no-store plus `Pragma: no-cache` on authorization failures and selected successes.

The required exact table-driven matrix is not present. The suite does not execute all of the following through real routes: unknown DTO fields, empty Manual and URL bodies, invalid/normalized duplicate names, source-count limit, exact Manual byte/character boundaries, URL acquired-content boundaries, PDF byte/MIME/signature variants, pending/lifecycle conflicts, historical digest conflict, publication CAS envelope, parser/provider unavailable mappings, cross-tenant generic 404, authorized `knowledge_unavailable`, safe detail allow-listing, and headers for each controller/domain/parser failure category. The implementation's central mapping is plausible, but executable compatibility and non-leakage evidence is incomplete. `AUD-012-012` remains partially resolved and release-blocking.

## 11. Onboarding Verification

Production nested onboarding receives the authenticated server-created actor and invokes the same frozen `KnowledgeService.create/revise` and `KnowledgeService.publish` path. The compatibility repository cannot write. The service catches only explicit `knowledge_unavailable` when no current publication exists, and its failure decision uses the pre-operation publication state so a failed refresh does not re-read corrupt state or downgrade a previously published Company.

The service-level test now passes an actor and verifies `published_by_actor_id = usr_authenticated`, excluding `system:legacy-onboarding`. Existing tests verify failed initial onboarding becomes failed and failed refresh retains the previous publication and ready status.

However, no real authenticated nested-onboarding route test verifies the persisted actor. There is no executable matrix proving corrupt current snapshot fail-closed behavior, safe propagation of availability/integrity failures, or preservation for each failed-refresh point through the authenticated route. `AUD-012-014` remains partially resolved and release-blocking.

## 12. Frontend Verification

Production behavior includes Manual, URL, and PDF creation/revision; revision details; per-mutation abort controllers; context/unmount cleanup; generation checks; selected-file and sensitive-text cleanup; publication conflict reset/reload/re-review; translated enum presentation; code-point, UTF-8, and PDF-size validation; capability-derived controls; plain-text details; and live-region alerts.

Rendered component evidence now covers:

- Manual and URL creation and sensitive-name cleanup;
- Manual, URL, and PDF revision/retry requests;
- PDF creation, over/exact 10 MiB handling, and file-input cleanup;
- revision-detail loading and plain rendering;
- Company, Workspace, logout, and unmount abort signals;
- publication conflict announcement and selection reset without replay;
- English and Spanish lifecycle/source labels without raw enums;
- Viewer, Operator, Administrator, and Owner controls.

The rendered suite still does not settle stale mutation promises after a context change to prove both stale success and stale error suppression. Its Unicode test checks only the absence of HTML UTF-16 `maxLength`; it does not submit exact/over code-point and UTF-8 byte boundaries. Administrator and Owner share one capability-derived expectation rather than independently proving the complete role matrix, and keyboard/live-region behavior is only partially asserted. Reducer-only stale coverage cannot replace the required rendered cases. `AUD-012-008` and `AUD-012-015` remain partially resolved and release-blocking.

## 13. Regression Verification

- The declared default backend script includes EPIC 004–011 and all EPIC 012 URL/PDF/remediation files.
- Three full runs passed with no failures, cancellations, skips, or TODOs.
- No historical EPIC 004–011 assertion was observed to be removed from the script.
- The single publication writer, rejecting deadlines, stored JSON validation, PDF authorization order, migrations 9/10, retry status, failed-refresh preservation, and A→B→A behavior all retain passing assertions.
- Frontend tests passed without skipped/TODO tests.
- No open-handle or worker-leak hang occurred. The backend process exited normally on every run.
- Expected warning/event: the controlled failed-onboarding regression logs an `OnboardingError` stack once per backend run.
- `git diff --check` passed; Git emitted working-copy LF-to-CRLF notices only.

## 14. Test and Build Results

| Command | Result |
|---|---|
| Backend `npm test` run 1 | PASS — 124/124; 0 failed/cancelled/skipped/TODO; 14.990 s |
| Backend `npm test` run 2 | PASS — 124/124; 0 failed/cancelled/skipped/TODO; 14.383 s |
| Backend `npm test` run 3 | PASS — 124/124; 0 failed/cancelled/skipped/TODO; 14.714 s |
| Backend `npm run typecheck` | PASS |
| Backend `npm audit --omit=dev` | PASS — 0 vulnerabilities |
| Frontend `npm test` | PASS — 44 Node + 27 Vitest = 71/71; 0 failed/skipped/TODO |
| Frontend `npm run typecheck` | PASS |
| Frontend `npm run build` | PASS — 58 modules transformed |
| Frontend `npm audit --audit-level=high` | PASS — 0 vulnerabilities |
| Runtime migration/schema check | PASS — 10 migrations, expected checksums/objects, 0 FK violations, integrity `ok` |
| `git diff --check` | PASS — LF-to-CRLF notices only |

## 15. Remaining Fixes

Release-blocking partially resolved IDs:

- `AUD-012-007`: replace marker/synthetic cases with valid encrypted/password-protected and embedded-attachment fixtures and independently prove worker-side no-network behavior.
- `AUD-012-008`: add rendered stale mutation success and error suppression, including context cleanup after promises settle.
- `AUD-012-009`: add the complete deterministic separate-connection race matrix.
- `AUD-012-012`: add the complete exact table-driven real-route contract, envelope, cache, and leakage matrix.
- `AUD-012-014`: add real authenticated nested-onboarding attribution, corruption, availability, integrity, and preservation tests.
- `AUD-012-015`: add rendered exact/over Unicode code-point and UTF-8 boundaries plus complete keyboard/live-region and role evidence.

## 16. Release Recommendation

The implementation is substantially stronger and the prescribed build/test/runtime gates are green. Release approval is nevertheless withheld because six mandatory Architecture Freeze evidence groups remain incomplete, including the concurrency and exact HTTP compatibility matrices that protect data integrity and public contracts.

RELEASE BLOCKED
