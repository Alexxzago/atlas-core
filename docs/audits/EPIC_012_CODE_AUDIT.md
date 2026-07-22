# EPIC 012 — Independent Code Audit

## 1. Executive Summary

EPIC 012 is **not release-ready**. The implementation compiles, builds, and passes its declared suites (91 backend tests and 55 frontend tests), and both production dependency audits report zero known vulnerabilities. Those results are real, but the implementation does not satisfy the frozen architecture contract.

The audit found 18 issues: 1 CRITICAL, 9 HIGH, 6 MEDIUM, 1 LOW, and 1 INFORMATIONAL. The release blockers include a production-wired compatibility repository that can publish arbitrary snapshots outside the frozen compiler and CAS command; extraction deadlines that do not cancel the Gemini operation; unvalidated/unbounded stored JSON reconstruction; raw PDF buffering before authentication and authorization; incomplete IPv6 SSRF controls; insufficient URL/PDF containment; missing frozen frontend revision/conflict behavior; and absent mandatory migration/concurrency evidence.

The implementation report was treated as untrusted. Every conclusion below is based on repository source, schema, route composition, tests, dependency metadata, and commands executed during this audit.

## 2. Audit Scope

Audited authority, in order:

1. `docs/freeze/EPIC_012_ARCHITECTURE_FREEZE.md`
2. accepted ADRs in `docs/adr/`
3. `docs/ATLAS_V1_ARCHITECTURE.md`
4. `docs/ATLAS_ENGINEERING_PROMPT.md`
5. historical Architecture Review and Engineering Plan

Audited implementation surfaces:

- migration 9 and unchanged migration history;
- Knowledge domain, compiler, services, ports, repositories, providers, controllers, routes, and composition;
- Preview, Chat, onboarding, `/knowledge`, and `/scrape` compatibility behavior;
- Workspace/Actor contexts, capabilities, authorization, CSRF, Origin, Fetch Metadata, Session, concealment, and cache headers;
- frontend API, types, reducer, component, localization, cleanup, and tests;
- backend/frontend scripts, lockfiles, dependency versions, runtime tests, typechecks, build, and npm vulnerability reports.

No production code, test, migration, dependency, package file, freeze document, plan, or review was modified by this audit.

## 3. Verification Performed

The audit read the actual source and traced the production composition from authenticated routes through controllers, services, repositories, and providers. Migration 9 was compared with the pre-EPIC diff so changes to migrations 1–8 could be distinguished from regression-test expectation updates. Test scripts were checked against the files they execute; test output was checked for failures, skips, and TODOs.

Positive verification includes:

- five non-circular Knowledge tables are added without rebuilding `companies`;
- Company-owned rows cascade on Company deletion and actor attribution has no User foreign key;
- the main Knowledge service reserves and completes revisions in separate transactions, with external work outside SQLite transactions;
- the deterministic compiler uses Company identity, canonical manifest ordering, normalized comparison keys, deterministic sorting/deduplication, and explicit hours/FAQ conflicts;
- the current-publication table is used by the new published reader;
- role capability derivation and route authorization are server-side;
- Preview uses the published projection and does not use the Chat FAQ shortcut;
- PDF is raw `application/pdf`, not multipart, and raw bytes are not deliberately persisted;
- no vectors, embeddings, OCR, queue, sitemap/crawl, Assistant-owned knowledge, or Company publication pointer were introduced;
- `pdfjs-dist` is exactly pinned at `6.1.200` in the package/lockfile; registry metadata reports Apache-2.0 and Node `>=22.13.0 || >=24`;
- declared regression suites, typechecks, build, and dependency audits pass.

## 4. Architecture Compliance

The broad model is recognizable and mostly follows the freeze: Company ownership, immutable terminal attempts, explicit publication, one current-publication table, deterministic compilation, published-only assistant retrieval, and provider isolation are present. The normal `KnowledgeService.publish` route also performs publication through one repository transaction.

Compliance fails at the enforceable boundaries. `KnowledgeRepository.save` remains a second production-capable publication writer; stored structured snapshots are trusted through TypeScript assertions; cancellation stops only consumers that cooperate; the raw PDF parser runs before security middleware; URL address classification is incomplete; and mandatory frontend and adversarial/concurrency behavior is absent. These are contract violations in executable paths, not documentation differences.

## 5. Findings by Severity

### AUD-012-001 — CRITICAL — Alternate publication writer bypasses the frozen compiler and publication command

- **File and symbol:** `backend/src/repositories/knowledgeRepository.ts`, `KnowledgeRepository.save`; `backend/src/composition.ts`, production repository wiring.
- **Evidence:** `save` accepts an arbitrary `CompanyKnowledge`, creates source/revision/version rows directly, computes its own digest, and upserts `company_knowledge_publications`. It does not invoke the frozen compiler, validate selected ready revisions, enforce actor context/capability, compare the expected current version, apply conflict/limit rules, or use the frozen publication transaction port. The adapter is exported as the runtime `knowledgeRepository` used by legacy Chat/Preview/onboarding composition.
- **Violated contract/risk:** Freeze §§3.3, 4.6, 10.2 and Frozen Decisions 6, 8, 12, and 23 require one publication writer, no dual mutable authority, and legacy onboarding through the same compiler/publication transaction. Any caller of this public port can replace executable Company Knowledge outside the frozen authority.
- **Reproduction/failure scenario:** Instantiate or use the production compatibility repository and call `save(context, companyId, arbitraryKnowledge)` while a publication exists. A new current version is installed without an expected-version CAS and can contain data that the compiler would reject.
- **Required remediation:** Retire the mutable legacy `save/delete` runtime port. Inject a read-only `PublishedCompanyKnowledgeReader` into Chat/Preview. Route every compatibility write, including onboarding, through the frozen ingest/compiler/publication use case; use test fixtures or the frozen transaction for setup.
- **Release-blocking:** Yes.

### AUD-012-002 — HIGH — Extraction and total-ingestion deadlines are not enforceable

- **File and symbol:** `backend/src/knowledge/services/knowledgeServices.ts`, `KnowledgeService.ingest`; `backend/src/providers/gemini.ts`, `GeminiKnowledgeFactExtractor.extract` and `GeminiProvider.extract`.
- **Evidence:** the service builds a 45-second extraction signal and a 60-second total signal, but `GeminiKnowledgeFactExtractor.extract` names the signal `_signal` and does not pass it to the provider/SDK. Provider requests and retry sleeps therefore continue independently of abort. Awaiting a provider that never settles also prevents terminal failure persistence and the HTTP request from finishing.
- **Violated contract/risk:** Freeze §§3.1, 7.4, 8, and 11.5 require enforceable 45/60-second limits and no reported success after 60 seconds.
- **Reproduction/failure scenario:** supply an extractor/provider promise that ignores `AbortSignal` and never resolves. After 60 seconds `ingest` is still awaiting it; the pending revision remains pending until a later recovery request.
- **Required remediation:** propagate abort into the actual Gemini request and retry/backoff path, stop retries on abort, and enforce an outer rejecting deadline that does not depend on provider cooperation. Persist a safe failed terminal result when the attempt still owns the pending revision.
- **Release-blocking:** Yes.

### AUD-012-003 — HIGH — Persisted JSON is neither validated nor bounded on reconstruction

- **File and symbol:** `backend/src/repositories/companyKnowledgeRepository.ts`, `loadPublished`, `revision`, and `version`.
- **Evidence:** each method uses `JSON.parse(...) as CompanyKnowledge` or `as ExtractedBusinessKnowledge`. There is no runtime schema validation, canonical shape check, or 128 KiB snapshot bound before data enters Chat/Preview or management DTOs.
- **Violated contract/risk:** Freeze §§4.6 and 9.2 require validation on write and reconstruction and a 128 KiB bound. Corrupt or manipulated SQLite data can cross repository boundaries and reach provider execution.
- **Reproduction/failure scenario:** update `company_knowledge_versions.knowledge_json` directly to an oversized object or a shape with non-string FAQ fields, then call `loadPublished`; the cast returns the untrusted value rather than an integrity failure.
- **Required remediation:** centralize strict stored-schema validators for snapshots and extractions, enforce UTF-8/character/JSON bounds on reconstruction, and raise a controlled internal integrity failure without returning partial data.
- **Release-blocking:** Yes.

### AUD-012-004 — HIGH — Raw PDF bodies are buffered before authentication and authorization

- **File and symbol:** `backend/src/routes/authorizedCompanies.ts`, PDF create/revise route registration.
- **Evidence:** both routes register `pdfBody` before `authorize(...)`: `router.post(..., pdfBody, authorize(...))`. Express therefore parses and buffers up to 10 MiB before Session, CSRF, Origin, Workspace membership, and Knowledge permission checks in the authorization wrapper.
- **Violated contract/risk:** Freeze §§3.1, 5, 7.3, 7.5, and 11.4 require authentication/authorization before the untrusted PDF path and explicitly require raw-parser ordering tests. Unauthenticated traffic can consume substantial memory and parsing work.
- **Reproduction/failure scenario:** POST repeated near-limit PDF bodies without a valid Session. The process accepts/buffers each body before returning the authorization failure.
- **Required remediation:** run lightweight Session/Origin/CSRF/Workspace/permission middleware before `express.raw`, preserve server-created contexts, then parse and invoke the controller. Add real-route ordering tests proving unauthorized requests are rejected before body consumption.
- **Release-blocking:** Yes.

### AUD-012-005 — HIGH — URL address classification permits IPv6 special-use destinations

- **File and symbol:** `backend/src/knowledge/infrastructure/publicUrlProvider.ts`, `publicAddress` and connection lookup.
- **Evidence:** IPv6 rejection is a prefix list covering loopback/unspecified, ULA, link-local, and documentation space. It does not reject all non-global/special-use ranges, including multicast `ff00::/8` and deprecated site-local `fec0::/10`. The same incomplete predicate approves actual lookup results.
- **Violated contract/risk:** Freeze §§7.2 and 11.3 require rejection of every non-public literal/resolved address, mixed answers, and DNS-rebinding-safe validation at connection time. Incomplete classification creates an SSRF boundary gap.
- **Reproduction/failure scenario:** resolve an otherwise valid hostname exclusively to `ff02::1` or another accepted special-use IPv6 address. The lookup callback can pass the address to the socket connection.
- **Required remediation:** use a complete, reviewed IPv4/IPv6 global-unicast classification with normalized mapped-address handling; reject any mixed answer and cover all IANA special-purpose ranges with actual transport tests.
- **Release-blocking:** Yes.

### AUD-012-006 — HIGH — URL security contract is not proven by actual adapter tests

- **File and symbol:** `backend/src/tests/epic012.test.ts`, URL tests; `backend/src/knowledge/infrastructure/publicUrlProvider.ts`, `SecurePublicUrlProvider`.
- **Evidence:** tests call URL validation and `publicAddress` for a handful of values, but do not drive the actual network adapter. There are no controlled tests for mixed DNS answers, rebinding, actual-connection lookup, each redirect hop, HTTPS downgrade, redirect count, response media type, 2 MiB streaming limit, timeout, abort, compressed responses, proxy behavior, or exactly-one-page behavior.
- **Violated contract/risk:** Freeze §§7.2 and 11.3 make these automated contract tests mandatory; implementation-report claims cannot substitute for executed network behavior.
- **Reproduction/failure scenario:** introduce a redirect/lookup regression or return a content-encoded oversized response; all current tests still pass because no actual adapter request is made.
- **Required remediation:** make resolver/transport controllable without weakening production behavior and add end-to-end adapter tests for every frozen SSRF, redirect, media, size, deadline, abort, and single-page condition.
- **Release-blocking:** Yes.

### AUD-012-007 — HIGH — PDF worker containment and adversarial proof are incomplete

- **File and symbol:** `backend/src/knowledge/infrastructure/pdfTextExtractor.ts`, `WorkerPdfTextExtractor.extract` and inline worker; `backend/src/tests/epic012.test.ts`, PDF tests.
- **Evidence:** a worker and 15-second termination exist, but the worker is created without `resourceLimits`; a compact or malicious PDF can amplify heap use before timeout. Tests cover only invalid bytes and one minimal PDF. They do not cover signature position, 10 MiB/100-page/text boundaries, truncation/xref corruption, encryption, JavaScript, attachments/references, scanned/empty files, worker crash, forced termination, memory pressure, abort, or external-fetch attempts. The real-PDF test also emits a missing-standard-font warning.
- **Violated contract/risk:** Freeze §§7.3, 11.3, and 11.5 require fail-closed worker isolation, memory-amplification scrutiny, hostile fixtures, and performance gates.
- **Reproduction/failure scenario:** parse a high-expansion or pathologically structured PDF. The worker can consume process memory until runtime exhaustion even though a timer will eventually call `terminate()`.
- **Required remediation:** impose worker resource limits or equivalent hard memory isolation, ensure all parser resources/tasks are destroyed, classify failures safely, and add the complete adversarial and timing fixture suite.
- **Release-blocking:** Yes.

### AUD-012-008 — HIGH — Frozen frontend revision, cancellation, and publication-conflict workflows are missing

- **File and symbol:** `frontend/src/components/CompanyKnowledgePanel.tsx`, `submit`, `publish`, `archiveSource`, and rendering; `frontend/src/api/atlasApi.ts`, Knowledge calls.
- **Evidence:** the panel creates sources, selects latest ready revisions, publishes, and archives, but provides no retry/create-revision workflow and no revision-detail view. Mutation requests have no per-operation `AbortController`; changing tenant context aborts only the current load, not ingestion/publication/archive. Publication errors are collapsed to a generic error and do not recognize `knowledge_publication_changed`, clear stale selection, reload, and require review.
- **Violated contract/risk:** Freeze §§6, 8, and 11.5 require revision/retry flows, abort and stale-result safety, sensitive cleanup, and explicit publication-conflict refresh. A request can continue mutating Company A after the UI has switched to Company B.
- **Reproduction/failure scenario:** start a PDF ingestion, switch Company, and let the POST finish; the server mutation continues. Separately, publish with a stale expected version; the UI shows only a generic error and retains a stale review state.
- **Required remediation:** implement the frozen revise/retry and detail flows, attach/abort mutation controllers on context/logout/unmount, keep request-generation guards, and handle publication CAS conflict with selection reset, reload, and explicit re-review messaging.
- **Release-blocking:** Yes.

### AUD-012-009 — HIGH — Mandatory Knowledge concurrency and rollback behavior is untested

- **File and symbol:** `backend/src/tests/epic012.test.ts`, publication CAS test; Knowledge repository test coverage.
- **Evidence:** the only EPIC 012 publication CAS test performs sequential calls on one in-memory connection. There are no separate-connection races for revision allocation, pending uniqueness, terminal CAS, version allocation, equal/stale publication, lock exhaustion/busy mapping, or injected rollback points. Separate-connection tests in earlier epics exercise other aggregates, not Knowledge.
- **Violated contract/risk:** Freeze §§8 and 11.2 explicitly require real write contention, concurrent publication semantics, rollback injection, and `503 knowledge_temporarily_unavailable` mapping.
- **Reproduction/failure scenario:** change busy handling or version allocation so two SQLite connections race incorrectly; the entire current EPIC 012 suite remains green.
- **Required remediation:** add deterministic worker/separate-connection Knowledge races and transaction-failure injection covering all frozen outcomes and proving no partial rows/current-pointer changes.
- **Release-blocking:** Yes.

### AUD-012-010 — HIGH — Migration equality and cutover evidence is incomplete

- **File and symbol:** `backend/src/config/migrations.ts`, migration 9; `backend/src/tests/epic007.test.ts` and `backend/src/tests/epic012.test.ts`, migration assertions.
- **Evidence:** migration 9 creates/backfills the five tables, but tests do not prove every frozen count equality or deep equality for complete legacy snapshots across multiple Workspaces, Unicode, empty fields, and maximum values. There is no full assertion that Companies without legacy rows remain unpublished or that source/revision/version/manifest/publication counts each equal legacy row count. Migration 9 also recreates a `company_knowledge` compatibility view over the renamed legacy table, leaving an active query surface where the freeze says no runtime query/test fixture reads it.
- **Violated contract/risk:** Freeze §§10.2, 10.3, and 11.2 require exact logical comparison evidence and a runtime-inert renamed legacy table before release.
- **Reproduction/failure scenario:** alter one backfilled field, omit a graph row, or accidentally query the compatibility view; current tests can still pass because they check only a subset of legacy values and general migration restart/foreign-key behavior.
- **Required remediation:** remove or strictly justify/eliminate the compatibility view as a runtime surface; add production-shaped migration-8 fixtures and exact row-count/deep-equality/no-publication/isolation/cascade/integrity assertions.
- **Release-blocking:** Yes.

### AUD-012-011 — MEDIUM — Retry reservation can leave Company status inconsistent

- **File and symbol:** `backend/src/repositories/companyKnowledgeRepository.ts`, `reserveRevision`.
- **Evidence:** expired pending recovery and reservation of a new pending revision do not update a Company with no publication from `failed` to `processing`. Initial source creation does update processing.
- **Violated contract/risk:** Freeze §3.5 defines `processing` whenever no publication exists and a pending revision exists.
- **Reproduction/failure scenario:** fail first ingestion, then retry the source. During external acquisition/extraction the revision is pending while persisted Company status remains `failed`.
- **Required remediation:** enforce the frozen status transition transactionally when reserving a retry, without downgrading a Company that already has a publication.
- **Release-blocking:** No by itself; required for approval.

### AUD-012-012 — MEDIUM — Several HTTP/error contracts are not exact or stable

- **File and symbol:** `backend/src/knowledge/services/knowledgeServices.ts`, request parsing and `ingest`; `backend/src/controllers/companyKnowledgeController.ts`, error mapping; Express application error path.
- **Evidence:** empty manual text can fall through to the URL empty-content code; aggregate source-count limits are mapped to HTTP 413 intended for request/entity size; unknown DTO fields are accepted; SQLite normalized-name uniqueness can escape as a generic infrastructure error; and failures occurring before the Knowledge controller do not consistently receive its no-store headers.
- **Violated contract/risk:** Freeze §§5 and 7.5 require exact DTOs, stable errors/statuses, safe details, and no-store/private responses.
- **Reproduction/failure scenario:** create a manual source containing only whitespace, race two equal normalized names, or trigger raw-body/parser/auth errors. Responses can expose the wrong stable code/status/header contract.
- **Required remediation:** strictly reject unknown fields, map each domain/integrity condition deterministically, distinguish aggregate from entity limits, and apply cache headers at the protected-route/error boundary.
- **Release-blocking:** No by itself; required for approval.

### AUD-012-013 — MEDIUM — Equal historical digest has an uncontrolled failure path

- **File and symbol:** `backend/src/repositories/companyKnowledgeRepository.ts`, `publish`.
- **Evidence:** idempotency is checked against the current digest. If the same `(company_id, snapshot_digest)` exists historically but is not current, insertion reaches the unique constraint and can escape as a generic availability error rather than an explicit frozen outcome.
- **Violated contract/risk:** Freeze §§3.3 and 8 explicitly define equal-current idempotency and historical-digest uniqueness behavior. Integrity exceptions must not masquerade as transient service failures.
- **Reproduction/failure scenario:** publish manifest A, then B, then attempt A again with the current expected version. The historical digest already exists and insertion conflicts.
- **Required remediation:** detect historical digest deterministically inside the publication transaction and return the specified controlled non-current outcome without mutating current publication.
- **Release-blocking:** No by itself; required for approval.

### AUD-012-014 — MEDIUM — Legacy onboarding loses authenticated actor attribution and swallows read failures

- **File and symbol:** `backend/src/services/onboardingService.ts`, frozen onboarding branch; authenticated onboarding controller/composition.
- **Evidence:** the compatibility flow uses a system actor rather than the server-created authenticated `ActorContext`. Its current-publication lookup is broadly caught and treated as “no publication,” so integrity/availability errors can change later behavior instead of failing closed.
- **Violated contract/risk:** Freeze §§2.6, 3.6, and 7.5 require immutable real actor attribution for authenticated commands and safe failure behavior.
- **Reproduction/failure scenario:** authenticated Owner runs onboarding and the resulting publication is attributed to a system identity; alternatively, corrupt the current-publication read and the service proceeds as though no publication exists.
- **Required remediation:** pass the trusted actor through the compatibility use case and catch only the explicit no-publication condition; propagate integrity/availability failures safely.
- **Release-blocking:** No by itself; required for approval.

### AUD-012-015 — MEDIUM — Frontend limits and localization are incomplete

- **File and symbol:** `frontend/src/components/CompanyKnowledgePanel.tsx`; `frontend/src/i18n/translations.ts`.
- **Evidence:** manual text has no frozen byte/character prevalidation, PDF selection has no 10 MiB check, and source kind/revision status values are rendered as raw enum strings rather than localized lifecycle labels. Component tests do not cover all roles, limits, errors, or English/Spanish states.
- **Violated contract/risk:** Freeze §§6 and 11.5 require mirrored limits, accessible/localized states, and bilingual lifecycle coverage.
- **Reproduction/failure scenario:** select an oversized PDF or render Spanish locale with a `public_url` failed source; the UI submits the file and displays untranslated internal enum values.
- **Required remediation:** mirror server limits for UX, retain server authority, add typed English/Spanish labels for every kind/status/error, and test both locales and boundaries.
- **Release-blocking:** No by itself; required for approval.

### AUD-012-016 — MEDIUM — Database checks do not constrain the legacy null-text exception to migrated sources

- **File and symbol:** `backend/src/config/migrations.ts`, `knowledge_source_revisions` status CHECK.
- **Evidence:** the ready-row CHECK requires digest and extracted JSON but permits `normalized_text IS NULL` for any ready revision. It does not tie the exception to a `legacy_migration` source; application paths currently supply text, but direct or future repository writes can create non-legacy exceptions.
- **Violated contract/risk:** Freeze §§2.3 and 4.2 permit null ready text only for the single migration exception and state the application cannot create it.
- **Reproduction/failure scenario:** insert a ready revision with null normalized text for a user-origin source while satisfying other columns; SQLite accepts it.
- **Required remediation:** enforce the exception through an auditable repository/migration-only mechanism (and tests) or a schema design that can prove origin while preserving the frozen model.
- **Release-blocking:** No by itself; required for approval.

### AUD-012-017 — LOW — Dense modules, unsafe casts, and dead compatibility code reduce assurance

- **File and symbol:** `backend/src/knowledge/services/knowledgeServices.ts`, `backend/src/repositories/companyKnowledgeRepository.ts`, EPIC 012 tests, and `KnowledgeRepository.delete`.
- **Evidence:** substantial service/repository/controller logic is compressed into very long lines; tests construct trusted actor values with `as unknown as ActorContext`; `delete` is a permanent false stub; broad catches and JSON assertions obscure domain boundaries.
- **Violated contract/risk:** this raises review and maintenance risk and weakens the value of TypeScript at security boundaries.
- **Reproduction/failure scenario:** boundary changes are easy to overlook and test fixtures can bypass required context construction without the compiler detecting missing fields.
- **Required remediation:** format/decompose by use case, use real context factories, remove dead mutable compatibility methods, and replace boundary casts with validators.
- **Release-blocking:** No.

### AUD-012-018 — INFORMATIONAL — Declared toolchain and dependency checks pass

- **File and symbol:** backend/frontend package scripts, `backend/package.json`, and lockfile.
- **Evidence:** all declared tests and typechecks pass; frontend production build passes; `pdfjs-dist` package/lockfile resolves to 6.1.200; npm reports zero production backend vulnerabilities and zero full-tree vulnerabilities in both projects at audit time.
- **Violated contract/risk:** no violation. Registry audit is time-dependent and is not proof of PDF containment or parser correctness.
- **Reproduction/failure scenario:** rerun the commands in §6 with registry access.
- **Required remediation:** preserve repeatable CI checks and record the production migration rehearsal separately before deployment.
- **Release-blocking:** No.

## 6. Test and Build Verification

Executed on 2026-07-20 from the audited working tree:

| Command | Result |
|---|---|
| `backend: npm test` | PASS — 91 tests, 91 pass, 0 fail/cancelled/skipped/todo |
| `backend: npm run typecheck` | PASS |
| `backend: npm audit --omit=dev` | PASS — 0 vulnerabilities |
| `backend: npm audit --audit-level=high` | PASS — 0 vulnerabilities |
| `frontend: npm test` | PASS — 44 Node tests plus 11 Vitest component tests; 55 total, 0 failures/skips/todo |
| `frontend: npm run typecheck` | PASS |
| `frontend: npm run build` | PASS — Vite production build, 58 modules transformed |
| `frontend: npm audit --audit-level=high` | PASS — 0 vulnerabilities |
| `git diff --check` | PASS — no whitespace errors; Git emitted LF-to-CRLF working-copy warnings |

The scripts include the new EPIC 012 backend tests and both Knowledge reducer/component tests. Vitest performs real React rendering. The authenticated HTTP test uses real route composition. However, §§AUD-012-006 through 010 and 015 identify mandatory behaviors that the suites do not exercise. Green totals therefore do not prove the frozen security, migration, concurrency, or complete frontend contracts.

Existing EPIC 004–011 assertions were inspected in the diff. Count expectations were updated for migration 9. EPIC 004/005 retry assertions were changed from invalidating old knowledge to preserving the published snapshot/ready status, which matches the freeze rather than weakening it. No skipped or TODO tests were found.

## 7. Migration Assessment

Migration 9 is append-only in the migration array; the diff shows no edits to migration implementations 1–8. It creates the five frozen tables, relevant unique/partial indexes, Company cascades, no User actor foreign key, and no circular Company/version pointer. It does not rebuild `companies`. `PRAGMA foreign_key_check` passes in tests, and migration restart behavior passes.

The backfill deterministically creates one source, ready revision, version, manifest, and publication per legacy row and reconstructs Company identity from `companies`. Companies without a legacy row are not explicitly inserted by the loop. Nevertheless, release evidence is incomplete: maximum/Unicode/multi-workspace fixtures and exact graph count/deep snapshot equality are absent (AUD-012-010), reconstructed JSON is not validated (AUD-012-003), the legacy table is exposed through a compatibility view, and the ready-null-text database exception is broader than frozen (AUD-012-016).

Production backup, restore rehearsal, production-shaped-copy migration, integrity check, and documented rollback are deployment prerequisites in the freeze and are not established by repository tests. Their absence from this source audit is not asserted as code failure, but release operations must produce that evidence after code blockers are resolved.

## 8. Security Assessment

Positive controls include server-derived Workspace/Actor authorization, CSRF/Origin/Fetch Metadata integration, Company-scoped joins in the new repository, generic not-found behavior on scoped resource lookup, raw-byte non-retention, bounded nominal inputs, a separate PDF worker, disabled PDF eval/fetch settings, direct built-in HTTP(S) acquisition, redirect revalidation, and no Firecrawl fallback.

Release security is blocked by pre-auth PDF buffering (AUD-012-004), incomplete IPv6 special-use rejection (AUD-012-005), absence of actual URL attack-contract tests (AUD-012-006), incomplete PDF resource containment/adversarial tests (AUD-012-007), and ineffective AI-operation deadlines (AUD-012-002). The extraction port is provider-neutral in type shape and does not receive tenant/repository/publication/model authority, but its prompt does not provide strong auditable proof for every prompt-injection fixture required by the freeze, and the missing extraction adversarial suite should be included in AUD-012-002 remediation.

## 9. Regression Assessment

EPIC 004–011 automated regressions pass. Published-only reads are used by Chat and Preview; Preview retains its provider path and no FAQ shortcut, while Chat retains released behavior. `/scrape` remains non-persistent. Failed refresh behavior preserves an existing publication and ready Company status in updated legacy tests.

Regression confidence remains insufficient because the runtime compatibility writer can bypass publication invariants, legacy onboarding actor/error behavior is not faithful, no Knowledge-specific real SQLite contention is exercised, and the frontend does not implement or test the full frozen lifecycle. These gaps could pass every current regression while corrupting authority, availability, or tenant-scoped user behavior.

## 10. Required Fixes

All findings AUD-012-001 through AUD-012-016 are required before approval. The minimum release gate is:

1. Remove the alternate mutable publication path and prove all runtime writes use the frozen compiler/transaction (AUD-012-001).
2. Make provider and total deadlines enforceable and terminal-state safe (AUD-012-002).
3. Strictly validate/bound all persisted JSON reconstruction (AUD-012-003).
4. Move authentication/authorization before raw PDF buffering (AUD-012-004).
5. complete SSRF address controls and actual URL transport tests (AUD-012-005, AUD-012-006).
6. Add hard PDF resource containment and the complete hostile/timing suite (AUD-012-007).
7. Complete frontend revise/retry/detail, mutation abort, conflict refresh, limits, and localization (AUD-012-008, AUD-012-015).
8. Add real Knowledge SQLite contention, rollback, busy, idempotency, and historical-digest tests/handling (AUD-012-009, AUD-012-013).
9. Prove exact migration equality and make the legacy table runtime-inert; constrain the legacy null-text exception (AUD-012-010, AUD-012-016).
10. Correct retry status, exact HTTP/error/header behavior, and authenticated onboarding attribution/error propagation (AUD-012-011, AUD-012-012, AUD-012-014).

After remediation, rerun the entire command matrix plus frozen performance gates and a production-shaped migration rehearsal. A new independent audit should verify the fixes rather than relying on an implementation report.

## 11. Optional Improvements

- Address AUD-012-017 by decomposing/formatting dense files, replacing unsafe test casts with trusted factories, and deleting dead compatibility surface.
- Add CI assertions that every EPIC test file is included by package scripts and that test output contains no skips/TODOs.
- Record the Node/npm/OS versions and hostile fixture hashes in security/performance evidence for reproducibility.
- Configure PDF standard-font data explicitly so valid-fixture runs do not emit parser warnings.

## 12. Release Recommendation

Finding counts: **1 CRITICAL, 9 HIGH, 6 MEDIUM, 1 LOW, 1 INFORMATIONAL**.

The CRITICAL alternate writer and nine HIGH contract/security/evidence failures make conditional release inappropriate. Required fixes must be implemented against the existing freeze; any discovery that URL security, PDF containment, migration equality, or bounded synchronous ingestion cannot meet that freeze must return to Architecture Review rather than weaken the contract.

RELEASE BLOCKED
