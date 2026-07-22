# EPIC 012 — Company Knowledge Foundation Engineering Plan

**Status:** Proposed for Architecture Review  
**Scope:** Engineering plan only; no implementation is included  
**Repository baseline inspected:** 2026-07-20

## 1. Executive Summary

EPIC 012 should replace the current single mutable `company_knowledge` snapshot and website-only onboarding path with a Company-owned knowledge subsystem that accepts manual text, a public URL, and PDF uploads. The subsystem remains inside the modular monolith and uses explicit domain, application, repository, provider, and HTTP boundaries.

Each Company may own multiple `KnowledgeSource` records. Every ingestion attempt creates an immutable `KnowledgeSourceRevision`; successful revisions can be assembled into an immutable `KnowledgeVersion`. Publishing atomically changes the Company's single published-version reference. Assistant Preview and future assistant execution load only that published version. Drafts, failed ingestion attempts, superseded revisions, raw uploads, and extraction diagnostics never become assistant facts implicitly.

Retrieval in this epic is deterministic and non-vectorial: load the complete published structured snapshot, enforce bounded publication limits, and pass the snapshot through the existing provider-neutral `AssistantExecutionRequest`. No Assistant Profile owns or selects knowledge, and no AI provider loads tenant data.

The existing knowledge row is migrated into one legacy source revision and one published version per Company, preserving current answers. The existing unauthenticated/default-workspace endpoints remain temporarily compatible but are not extended with new mutation capabilities; the new management API is authenticated, workspace-scoped, authorized, CSRF-protected, and server-authoritative.

## 2. Current Repository Findings

- The backend is a layered TypeScript/Express modular monolith. Composition is centralized in `backend/src/composition.ts`; SQLite migrations are append-only in `backend/src/config/migrations.ts`.
- `Workspace` is the tenant boundary. Authenticated routes resolve trusted `WorkspaceContext` from Session, Membership, and the workspace public ID. Client input never establishes tenant authority, and authorization failures collapse to `404`.
- `Company` owns current structured knowledge. `company_knowledge` has one mutable row per Company containing services, hours, locations, FAQ, and an update timestamp. Workspace scope is enforced by joining through `companies`.
- `KnowledgeRepositoryPort` currently exposes `save`, `load`, and `delete`; `KnowledgeService` only reads. There is no Knowledge aggregate, source identity, revision, publication record, provenance, or concurrency token.
- Website onboarding changes Company status, deletes prior knowledge before scraping, calls Firecrawl, cleans Markdown, optionally writes a local debug file, asks Gemini to extract the fixed `CompanyKnowledge` shape, then upserts knowledge. A failed refresh removes the previously usable snapshot.
- `/scrape`, `/knowledge`, `/chat`, and the legacy `/companies/:companyId/onboard` use a trusted default workspace and are not part of the authenticated workspace route tree. Authenticated Company and Assistant Profile operations use `/workspaces/:workspaceId/companies/...`.
- `WebsiteScraper`, `KnowledgeExtractor`, and `MarkdownDebugStore` are provider ports, although the extractor contract is tied to website/Markdown inputs. Firecrawl and Gemini are replaceable adapters; the current file debug store is not tenant-safe enough for durable source storage.
- ADR-004 approves immutable knowledge versions with one published reference as future direction. ADR-013 requires current Company Knowledge to be passed explicitly through the immutable, provider-neutral Assistant Execution Contract.
- Assistant Preview verifies Company and Profile ownership in trusted context, requires a ready Profile and ready Company, loads knowledge through the repository, freezes a minimal execution contract, and invokes `AtlasAgent`. Preview is ephemeral and deliberately bypasses the legacy exact-FAQ shortcut.
- Authenticated frontend state already guards against stale workspace/company/profile requests with abort controllers, request IDs, and generation checks. The Knowledge UI should use the same pattern rather than the older unauthenticated `CompanyWorkspace`/`OnboardingPanel` path.
- Backend tests use Node's test runner and in-memory SQLite. HTTP tests exercise real authentication, CSRF, permission, tenant-isolation, and error contracts. Frontend state tests use `node:test`; component tests use Vitest and Testing Library.
- No PDF parsing or multipart dependency exists. Express JSON limits and upload handling therefore need an explicit bounded design.

## 3. Goals / Non-Goals

### Goals

- Let authorized Workspace members add Company knowledge from manual text, one public HTTP(S) URL, or one PDF.
- Preserve source identity, immutable revision history, ingestion status, normalized content, extracted structured facts, and safe diagnostics.
- Require an explicit publish action before new content affects Assistant Preview.
- Guarantee that execution sees either the complete old published version or the complete new one.
- Preserve tenant isolation, provider neutrality, server authority, local testability, and current assistant grounding rules.
- Migrate existing knowledge without losing current published behavior.
- Provide an authenticated portal experience with accessible source, ingestion, draft, and publication states.

### Non-Goals

- Vector databases, embeddings, semantic chunk search, RAG infrastructure, reranking, or hybrid retrieval.
- Assistant-specific knowledge, Profile-to-source assignment, channel-specific copies, or default Assistant routing.
- Web crawling beyond the submitted URL, scheduled refresh, external change detection, or sitemap ingestion.
- OCR, image extraction, scanned-PDF support, tables/layout reconstruction, password-protected PDFs, or non-PDF document types.
- Collaborative rich-text editing, per-field approval, diff/merge UI, rollback automation, or deletion of immutable audit history.
- Background queues, distributed workers, websockets, polling infrastructure beyond normal HTTP refresh, or cross-process job leasing.
- Conversations, memory, capabilities, tools, WhatsApp, billing, PostgreSQL, or a vector-store dependency.

## 4. Domain Model

### Aggregates and value objects

`KnowledgeSource` is a Company-owned aggregate root:

- `id`: opaque stable public identifier, e.g. `ksrc_<random>`.
- `companyId`: ownership; Workspace ownership is derived through Company and never duplicated.
- `kind`: `manual_text | public_url | pdf`.
- `name`: user-visible label, normalized and unique among non-archived sources in one Company.
- `locator`: canonical URL only for `public_url`; `null` otherwise. It is metadata, never authority.
- `status`: `active | archived`. Archiving excludes a source from future compilation but does not alter an already published version.
- timestamps and a positive `version` used for optimistic concurrency.

`KnowledgeSourceRevision` is immutable after it reaches a terminal ingestion outcome:

- opaque ID, source ID, monotonically increasing source-local revision number, ingestion status, media type, byte/character counts, content digest, timestamps, and sanitized failure code;
- normalized text and provider-neutral structured extraction when ready;
- for manual text, submitted text is the input; for URL and PDF, obtained/extracted text is the input;
- statuses: `pending | processing | ready | failed`;
- only `ready` revisions are eligible for compilation;
- a retry creates a new revision; it never overwrites the preceding revision.

`KnowledgeVersion` is an immutable Company-wide publication candidate:

- opaque ID, Company ID, monotonically increasing Company-local version number;
- canonical `CompanyKnowledge` snapshot, deterministic source-revision manifest, snapshot digest, creation metadata, and timestamps;
- states are unnecessary once immutable: a version is either referenced as published or is an unpublished historical candidate;
- version creation validates that every manifest revision belongs to the same Company and is ready.

`KnowledgePublication` records the publication event:

- opaque ID, Company ID, Knowledge Version ID, actor User ID, published timestamp, and the previously published version ID;
- the Company has exactly zero or one current published version reference;
- publication history is append-only and supplies auditability without making event sourcing the architecture.

The existing `CompanyKnowledge` structure remains the execution projection in this epic. Provenance and ingestion metadata are not sent to the model automatically.

## 5. Lifecycle

```text
create source
    -> create revision(pending)
    -> processing
       -> ready
       -> failed

ready source revisions
    -> build immutable KnowledgeVersion candidate
    -> explicit publish
    -> atomically becomes Company's published version
    -> available to Assistant Preview
```

- Creating a source and its first revision is one application operation.
- An ingestion failure leaves the previous ready revision and current publication intact.
- Retrying creates the next revision. Concurrent ingestion for the same source is rejected while a `pending` or `processing` revision exists.
- Archiving a source prevents it from being selected in the next candidate but does not mutate a published snapshot.
- Publication requires at least one selected ready source revision and a valid non-empty compiled snapshot.
- A published version is never edited. Corrections require a new source revision, candidate, and publication.
- Company `ready` should mean operationally usable and should be derived/updated when a publication exists. EPIC 012 must stop using Company status as the ingestion-attempt state; source revisions own ingestion status.

## 6. Persistence

Add an append-only migration after migration 8. Proposed tables:

### `knowledge_sources`

- `id TEXT PRIMARY KEY`
- `company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE`
- `kind TEXT NOT NULL CHECK (...)`
- `name`, `normalized_name`, `locator`, `status`, `version`, `created_at`, `updated_at`, `archived_at`
- unique `(company_id, normalized_name)` for active records via a partial index
- checks enforcing URL locator presence only for URL sources and archive timestamp consistency

### `knowledge_source_revisions`

- `id TEXT PRIMARY KEY`
- `source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE RESTRICT`
- `revision_number INTEGER NOT NULL CHECK (> 0)`
- `status`, `media_type`, `content_digest`, `input_size`, `normalized_size`
- `normalized_text TEXT`, `extracted_knowledge_json TEXT`
- `failure_code TEXT`, `created_at`, `started_at`, `completed_at`
- unique `(source_id, revision_number)`
- partial unique index allowing at most one `pending`/`processing` revision per source
- status-dependent checks for terminal timestamps, required content, and failure fields

Raw PDF bytes should not be stored in SQLite in this epic. Parse within the bounded request, retain only normalized text, digest, size, media type, and extraction output. This avoids an undeclared blob-storage subsystem and secret-bearing local files. The security implications must be disclosed in the UI.

### `knowledge_versions`

- `id TEXT PRIMARY KEY`
- `company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE`
- `version_number INTEGER NOT NULL CHECK (> 0)`
- `knowledge_json TEXT NOT NULL`, `snapshot_digest TEXT NOT NULL`
- `created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT`
- `created_at TEXT NOT NULL`
- unique `(company_id, version_number)` and `(company_id, snapshot_digest)`

### `knowledge_version_sources`

- `knowledge_version_id`, `source_revision_id`, deterministic `ordinal`
- composite primary key and unique `(knowledge_version_id, ordinal)`
- foreign keys use `ON DELETE RESTRICT`

### `knowledge_publications`

- `id TEXT PRIMARY KEY`, `company_id`, `knowledge_version_id`, `previous_version_id`, `published_by_user_id`, `published_at`
- foreign keys use `ON DELETE RESTRICT`; index publication history by Company/time

### Current publication pointer

Add nullable `companies.published_knowledge_version_id`. SQLite cannot safely add the required circular foreign key with a simple `ALTER`; use the repository's established table-rebuild migration pattern, preserve Company IDs and all columns, validate row counts and `PRAGMA foreign_key_check`, then add the foreign key. Publication transaction verifies the target version's Company before updating the pointer and inserting the publication record.

All repository queries start from or join through `companies.workspace_id = ? AND companies.id = ?`. No caller-facing repository method accepts an unscoped Company-owned identifier.

## 7. Ingestion

Introduce a Knowledge application module rather than expanding controllers or provider adapters with policy:

- `KnowledgeSourceService`: validate ownership, source metadata, lifecycle, and create/retry/archive operations.
- `KnowledgeIngestionService`: reserve a revision, invoke the kind-specific content provider/parser, normalize text, enforce post-extraction limits, invoke a provider-neutral fact extractor, validate output, and complete/fail the revision.
- `KnowledgePublicationService`: select ready revisions, compile the canonical snapshot deterministically, validate limits and invariants, create a version, and publish transactionally.
- `KnowledgeQueryService`: list sources/revisions, return publication summaries, and load only the published execution projection.

Provider ports should separate content acquisition from fact extraction:

- `PublicUrlContentProvider.fetch(canonicalUrl): Promise<AcquiredText>`
- `PdfTextExtractor.extract(bytes): Promise<AcquiredText>`
- `KnowledgeFactExtractor.extract(request): Promise<ExtractedKnowledge>` where the request contains source kind, normalized text, and optional public URL but no Workspace authority.

Services own validation, size policy, retries, source selection, merging, publication, and errors. Providers own Firecrawl/PDF/AI translation only. Repositories own SQLite and transaction mechanics only.

Synchronous ingestion is acceptable for Beta 1 because no durable worker framework exists. HTTP requests need explicit provider timeouts and must not claim success until the terminal revision is persisted. The revision record makes an interrupted/failed attempt visible and retryable; a future worker can reuse the same service contract.

## 8. Manual Text Flow

1. Authorized client submits `{ name, text }`; text must be UTF-8 JSON, trimmed, non-empty, and within the configured character/byte limit.
2. Service creates a `manual_text` source and pending revision in one transaction.
3. Normalizer removes control characters, normalizes line endings/Unicode, and preserves meaningful paragraphs; it does not summarize facts.
4. Fact extractor receives the normalized text with source kind metadata.
5. Valid structured output and normalized text are stored on the revision; otherwise revision becomes `failed` with a stable code.
6. UI shows `ready` but explicitly `unpublished`. A separate publish command is required.
7. Editing manual text creates another immutable revision; optimistic source version prevents lost updates.

Manual text is untrusted content. It cannot contain system instructions that supersede grounding policy, and the provider prompt must label it solely as factual candidate material.

## 9. URL Flow

1. Client submits `{ name, url }`; service canonicalizes and validates `http`/`https` only.
2. Before provider invocation, reject credentials, fragments, nonstandard schemes, localhost names, literal private/link-local/loopback/reserved IPs, and disallowed ports.
3. Resolve DNS server-side and reject any non-public result. Redirects must be limited and each hop revalidated. This policy belongs in a reusable SSRF-safe acquisition boundary, not the controller.
4. Firecrawl adapter fetches exactly the submitted public page with a timeout and response-size bound; no crawl is started.
5. Existing Markdown cleaning becomes a provider-neutral text normalization step and must be deterministic.
6. Store final canonical URL, normalized text digest, extraction result, and safe metadata. Do not persist provider response bodies or credentials in logs.
7. Failure creates a failed revision without deleting prior ready or published knowledge.

Firecrawl's remote-fetch behavior does not eliminate Atlas's validation responsibility. Architecture Review must confirm whether the provider can enforce redirect and network rules strongly enough; otherwise URL ingestion is blocked until an adapter-level safe contract exists.

## 10. PDF Flow

1. Use `POST` with `Content-Type: application/pdf` and `express.raw({ type: "application/pdf", limit: ... })` on this route only. Metadata such as source name is supplied in validated headers or query fields; Architecture Review should prefer a small JSON initiation plus binary upload contract if multipart UX becomes mandatory.
2. Validate declared media type, `%PDF-` signature, byte limit, and non-empty body before parsing. Never trust filename or MIME alone.
3. A replaceable local `PdfTextExtractor` parses the in-memory bounded payload with execution timeout/abort semantics.
4. Reject encrypted/password-protected, malformed, zero-text, and extraction-limit-exceeding files with stable error codes. No OCR fallback occurs.
5. Normalize extracted text and apply both page-count and character limits before AI extraction.
6. Persist no raw PDF bytes; persist digest, sizes, normalized text, and structured extraction only.
7. Make clear in UI that image-only/scanned PDFs are unsupported in this epic.

Choose a maintained, Node 24-compatible parser after a short dependency/security spike. `pdfjs-dist` is the preferred candidate because it supports local text extraction without an external service; lock the exact reviewed version and isolate it behind `PdfTextExtractor`.

## 11. Publication Model

- Publication is explicit and server-authoritative; ingestion success never auto-publishes.
- The publish request identifies the exact ready revision IDs to include and the expected current publication/version token. The server re-resolves all ownership and statuses.
- Compilation order is deterministic: source kind/name/ID and revision ID establish a stable ordering. Normalize, deduplicate exact repeated facts, and reject conflicting scalar facts that cannot be resolved without user judgment.
- AI may extract each source but must not decide publication. Deterministic application code merges only the validated structured schema.
- Publication creates a new immutable `KnowledgeVersion`, manifest rows, publication event, and Company pointer update in one `BEGIN IMMEDIATE` transaction.
- If compilation or persistence fails, the current pointer is untouched.
- Assistant consumers never read latest draft, latest source revision, or latest version by timestamp; they follow only the current published pointer.
- Republishing an identical source manifest/snapshot should be idempotent and return the existing current publication rather than create noise.

## 12. Retrieval Strategy (No Vector RAG)

- `PublishedKnowledgeRepositoryPort.load(context, companyId)` resolves `companies.published_knowledge_version_id` and deserializes its validated `knowledge_json`.
- The execution projection remains `AssistantExecutionKnowledge`, preserving ADR-013 and existing Gemini translation.
- Enforce publication-time maximums for services, locations, FAQs, field lengths, and total serialized characters so every published snapshot is safe to load as one bounded unit.
- Preserve exact FAQ matching only for legacy Chat as ADR-013 requires. Preview always invokes the provider with the complete published snapshot.
- No substring “relevance” heuristics are added. If bounded whole-snapshot retrieval becomes insufficient, a later ADR should introduce chunking/vector/hybrid retrieval without changing the published source of truth.

## 13. Assistant Execution Integration

- Replace the current mutable knowledge repository dependency in `AssistantPreviewService` and `ChatService` with the published-knowledge query port, keeping their service-level Company/Profile checks.
- Keep `AssistantExecutionRequest` provider-neutral and immutable. Do not add source IDs, revision metadata, prompts, provider settings, raw text, credentials, or Workspace authority unless a later execution contract decision requires them.
- Preview returns `knowledge_unavailable` when no published pointer exists, even if ready drafts exist.
- Publishing or archiving knowledge does not modify Assistant Profiles. Profile readiness and knowledge publication are separate preconditions.
- Provider adapters continue receiving knowledge explicitly and may not query repositories or choose tenants.

## 14. Authorization

Add explicit permissions instead of overloading generic Company management:

- `knowledge:read`: owner, administrator, operator, viewer.
- `knowledge:ingest`: owner, administrator, operator.
- `knowledge:publish`: owner and administrator by default; operator publication is intentionally denied pending product decision.
- `knowledge:archive`: owner and administrator.

All new endpoints live below `/workspaces/:workspaceId/companies/:companyId/knowledge...` and use the existing authenticated authorization wrapper. Mutations require current Session, exact trusted Origin, same-origin Fetch Metadata, and CSRF. Resource, tenant, and permission mismatches respond with the same generic `404` used by current authenticated routes.

Actor identity for version/publication audit must come from the authenticated server context, not a body field. This likely requires extending the authenticated route/controller context with an immutable principal containing trusted `userId` plus `WorkspaceContext`; do not place authentication parsing inside services.

## 15. API Design

Proposed authenticated contracts:

- `GET /workspaces/:workspaceId/companies/:companyId/knowledge/sources` — source summaries, latest revision summary, and publication inclusion state.
- `POST .../knowledge/sources/manual` — `{ name, text }`; returns `201` source plus terminal revision for synchronous ingestion.
- `POST .../knowledge/sources/url` — `{ name, url }`; returns `201` source plus terminal revision.
- `POST .../knowledge/sources/pdf?name=...` — raw `application/pdf`; returns `201` source plus terminal revision.
- `POST .../knowledge/sources/:sourceId/revisions/manual` — `{ text, expectedSourceVersion }`.
- `POST .../knowledge/sources/:sourceId/revisions/url` — `{ url, expectedSourceVersion }`.
- `POST .../knowledge/sources/:sourceId/revisions/pdf?expectedSourceVersion=...` — raw PDF.
- `POST .../knowledge/sources/:sourceId/archive` — `{ expectedSourceVersion }`.
- `GET .../knowledge/publication` — current publication/version summary and compiled `CompanyKnowledge`; `404` when none.
- `POST .../knowledge/publications` — `{ sourceRevisionIds, expectedPublishedVersionId }`; returns `201`, or `200` for idempotent current publication.

All response DTOs omit normalized raw text by default; a separate authorized revision detail endpoint may expose manual/extracted text only if the frontend genuinely needs it. Never return raw PDF bytes, provider payloads, prompts, stack traces, internal SQLite IDs, or other-workspace existence clues.

Use a consistent error envelope `{ error: { code, message, details? } }`. Expected statuses: `400` malformed input, `404` hidden authority/resource failure, `409` lifecycle/concurrency/conflict, `413` upload/input too large, `415` unsupported media, `422` valid transport but unprocessable/empty PDF or conflicting knowledge, `503` provider temporarily unavailable. Set `Cache-Control: no-store, private` on knowledge management and publication responses.

Legacy `/knowledge`, `/chat`, `/scrape`, and `/companies/:companyId/onboard` are compatibility surfaces. Do not add new source-management operations there. During migration, route legacy onboarding through an adapter use case that creates and publishes a URL source, or deprecate it only after frontend callers move and regression tests freeze the chosen behavior.

## 16. Frontend Design

Add a Knowledge panel within the authenticated selected Workspace/Company portal, alongside Assistant Profiles:

- source list with type, label, latest revision status, last updated time, included/unpublished indicator, and retry/archive actions;
- creation tabs/forms for Manual Text, Public URL, and PDF;
- explicit publication review showing the exact selected ready revisions, validation/conflict errors, current published version, and Publish action;
- clear separation between `ingested`, `ready draft`, and `published`; never use a generic “saved” label for publication;
- PDF file/type/size validation for early feedback, while treating server validation as authoritative;
- accessible pending/status/error announcements, keyboard operation, disabled duplicate submissions, and English/Spanish typed translation keys;
- viewer read-only mode; controls follow permission hints for UX but server authorization remains final.

Extend authenticated portal state using a dedicated `knowledgeState.ts` reducer or bounded hook rather than further enlarging the Profile reducer. Capture request ID, workspace ID, company ID, generation, source ID, and operation. Abort requests and increment generation on Workspace/Company change, logout, or component unmount. Ignore late completions exactly as Profile state does. Mutating requests are never automatically retried after authentication recovery.

## 17. Security

- Enforce tenant ownership in every repository query through Company and trusted `WorkspaceContext`.
- Treat manual, web, and PDF content as untrusted data and possible prompt injection. Extraction and answer prompts must preserve Atlas rules as highest-priority adapter instructions.
- Apply independent request-byte, normalized-character, PDF-page, field-count, and execution-time limits. Centralize policy constants and test boundaries.
- Harden URL fetch against SSRF, redirects, DNS rebinding, credentials in URLs, and oversized responses.
- Parse PDFs locally in a replaceable adapter; review parser CVEs/license, pin the lockfile, and avoid executing embedded content, JavaScript, attachments, or external references.
- Do not log source bodies, normalized text, raw PDF data, model prompts/responses, Session/CSRF tokens, or secrets. Hashes are diagnostic identifiers, not authentication material.
- Sanitize output rendering as plain text. Do not render ingested HTML/Markdown with unsafe injection paths.
- Preserve exact-Origin/CSRF protections and generic `404` concealment of unauthorized resources.
- Do not use the existing Company-only markdown debug file store for durable or production ingestion artifacts; remove it from the new path.

## 18. Concurrency

- Use `BEGIN IMMEDIATE` for revision-number allocation and publication pointer changes.
- `knowledge_sources.version` supplies compare-and-swap for edit/archive operations.
- A partial unique index permits one active ingestion revision per source. A conflicting request returns `409 knowledge_ingestion_in_progress`.
- Publication request includes `expectedPublishedVersionId` (`null` for first publish). Update the Company pointer only when it still equals that value; otherwise return `409 knowledge_publication_changed` and require review.
- Validate selected revision ownership and readiness inside the publication transaction, not only before it.
- Use content/snapshot digests plus uniqueness constraints for idempotent repeated submission/publication.
- The frontend's request generation prevents stale rendering but is not a substitute for database concurrency enforcement.
- Process crashes may leave `processing` revisions. On read/retry, revisions older than a configured threshold become recoverable failures through an explicit service operation; do not use process-memory locks.

## 19. Error Model

Define application errors with stable codes and controller mappings:

- validation: `invalid_knowledge_request`, `invalid_source_name`, `invalid_public_url`, `knowledge_input_too_large`, `unsupported_pdf`;
- acquisition/extraction: `url_fetch_unavailable`, `url_content_empty`, `pdf_parse_failed`, `pdf_text_empty`, `knowledge_extraction_unavailable`, `knowledge_extraction_invalid`;
- lifecycle: `knowledge_ingestion_in_progress`, `source_archived`, `source_revision_not_ready`, `knowledge_conflict`, `knowledge_publication_changed`, `knowledge_unavailable`;
- hidden access/resource errors remain generic `404 Resource not found` externally.

Persist only stable failure codes and safe bounded metadata. Log the causal exception server-side with a request correlation ID and internal source/revision ID, never content. Provider outages map to retryable `503`; malformed or unsupported customer content maps to non-retryable `4xx`.

## 20. Observability

Use structured event logging through a small application logger port or the existing console boundary until a broader observability decision is accepted. Events:

- ingestion started/completed/failed with kind, duration, byte/character/page counts, safe failure code, workspace/company/source/revision IDs;
- publication completed/conflicted with version number, source count, snapshot size, actor ID, and duration;
- published-knowledge load missing/corrupt and execution fallback outcomes;
- provider latency/failure category without request or response bodies.

Pass or generate a request correlation ID at the HTTP boundary. Define measurable counters conceptually even if the initial adapter writes JSON logs: success/failure by source kind, extraction latency, publication conflicts, unprocessable PDFs, SSRF rejections, and missing published knowledge. Do not add a paid observability dependency in this epic.

## 21. Migration Strategy

1. Add new tables and rebuild `companies` with nullable `published_knowledge_version_id` in one append-only, checksum-protected migration. Never edit migrations 1–8.
2. For each existing `company_knowledge` row, create a deterministic `legacy_import` source representation. Because public domain kind is limited to three, either allow internal-only `legacy` kind or map to `manual_text` with immutable `origin = legacy_migration`; Architecture Review must choose before schema freeze.
3. Create one ready source revision containing the current structured snapshot, one immutable Knowledge Version, one manifest row, and one publication event; set the Company pointer.
4. Preserve Company IDs, current knowledge values, and Company status. Verify counts: every legacy knowledge row has exactly one current pointer and identical deserialized `CompanyKnowledge`.
5. Keep `company_knowledge` read-only during a compatibility release or replace it with the new repository immediately after backfill. Do not dual-write indefinitely. Drop it only in a later migration after regression evidence and backup/restore validation.
6. Update legacy onboarding compatibility to create/publish through the new services. Never delete the current publication when refresh starts or fails.
7. Before production migration: back up SQLite, test restore, run migration against a production-shaped copy, run `PRAGMA foreign_key_check` and integrity checks, and document rollback as restore-from-backup because applied migrations are forward-only.

## 22. Testing Strategy

### Domain/unit

- Source names, kind invariants, status transitions, optimistic versions, immutable revision reconstruction, size policies, normalization, deterministic compilation, conflict detection, publication eligibility, and snapshot limits.
- URL policy tests for schemes, credentials, IP ranges, ports, DNS/redirect decisions, and canonicalization.
- PDF signature/type/size/page/encryption/empty-text cases using tiny committed fixtures with no sensitive data.
- Prompt-injection strings remain data and cannot change provider execution rules.

### Repository/migration

- In-memory SQLite tests for scoped CRUD, cross-workspace not-found behavior, source revision allocation, active-ingestion uniqueness, immutable records, publication CAS, transaction rollback, cascades/restricts, and corrupt JSON handling.
- Upgrade a migration-8 fixture containing multiple Workspaces/Companies/knowledge rows; assert byte-equivalent logical snapshots, counts, current pointers, migration checksums, and zero foreign-key violations.
- Concurrent worker tests should use separate SQLite connections/files where needed, following existing Assistant Profile concurrency testing patterns.

### Service/provider

- Fake URL/PDF/extractor adapters cover success, timeout, invalid extraction, retry, and prior-publication preservation.
- Verify providers receive no repositories, Workspace context, actors, or authorization data.
- Verify publish is explicit and Assistant Preview cannot see a ready unpublished revision.

### HTTP/security

- Real authenticated routes for every role and permission; missing/invalid Session, CSRF, Origin, same-site/cross-site Fetch Metadata, malformed identifiers, foreign Workspace/Company/source/revision, upload limits, media type, error mappings, and no-store headers.
- Confirm unauthorized and cross-tenant cases are indistinguishable `404`s.
- Confirm mutations are not automatically replayed after authentication bootstrap.

### Frontend

- Reducer tests for context switches, stale requests, aborts, duplicate submission prevention, permission-driven controls, publication conflict refresh, and logout reset.
- Component tests for all three source forms, PDF validation, lifecycle labels, publish review, error mapping, accessibility live regions, and English/Spanish rendering.

## 23. Regression Protection

- Keep all EPIC 004–011 tests green and add EPIC 012 tests to the explicit backend/frontend test scripts.
- Freeze ADR-013 behavior: Preview only uses ready Profile plus the published Company snapshot, always traverses provider execution, and sends no internal IDs/provider authority.
- Preserve legacy Chat's exact FAQ optimization and safe fallback behavior against the published projection.
- Preserve Workspace tenant concealment, Session/CSRF contracts, Company CRUD, Assistant Profile lifecycle, frontend authentication rehydration, and provider-neutral ports.
- Add a test proving failed URL/PDF/manual refresh never removes or changes the current publication.
- Add a test proving ready-but-unpublished content cannot affect Preview output or provider input.

## 24. Implementation Sequence

1. Architecture Review resolves the publication permission, legacy source representation, PDF transport/parser, limits, and Company status semantics.
2. Add Knowledge domain types/policies and pure unit tests.
3. Add repository/application ports and transactional persistence adapters.
4. Add the append-only migration and migration/backfill tests before switching reads.
5. Implement text normalization and deterministic compilation.
6. Implement manual ingestion end-to-end with fakes and authenticated HTTP.
7. Implement hardened public URL acquisition by adapting Firecrawl.
8. Complete the PDF dependency spike, then implement the isolated parser and raw upload route.
9. Implement candidate creation/publication CAS and switch Preview/Chat to published reads.
10. Adapt or deprecate legacy onboarding without dual-write ambiguity.
11. Add frontend API types, dedicated knowledge state, management UI, translations, and tests.
12. Run full typecheck/test/build, migration rehearsal, security regression, and backup/restore verification.
13. Write/accept any ADR required by decisions that materially extend ADR-004 or security infrastructure before release.

## 25. Expected File Changes

Exact names may be adjusted during implementation to match the final module boundary, but no duplicate implementation should be created.

### Expected new backend files

- `backend/src/knowledge/domain/knowledgeSource.ts`
- `backend/src/knowledge/domain/knowledgePolicies.ts`
- `backend/src/knowledge/application/ports.ts`
- `backend/src/knowledge/services/knowledgeSourceService.ts`
- `backend/src/knowledge/services/knowledgeIngestionService.ts`
- `backend/src/knowledge/services/knowledgePublicationService.ts`
- `backend/src/knowledge/services/knowledgeQueryService.ts`
- `backend/src/knowledge/infrastructure/pdfTextExtractor.ts`
- `backend/src/repositories/knowledgeSourceRepository.ts`
- `backend/src/repositories/knowledgePublicationRepository.ts`
- `backend/src/controllers/companyKnowledgeController.ts`
- `backend/src/tests/epic012.domain.test.ts`
- `backend/src/tests/epic012.repository.test.ts`
- `backend/src/tests/epic012.service.test.ts`
- `backend/src/tests/epic012.http.test.ts`

### Expected modified backend files

- `backend/src/config/migrations.ts`
- `backend/src/application/ports/repositories.ts` (or move Knowledge ports into the module and update imports)
- `backend/src/types/ports.ts`
- `backend/src/types/companyKnowledge.ts`
- `backend/src/providers/firecrawl.ts`
- `backend/src/providers/gemini.ts`
- `backend/src/providers/prompts.ts`
- `backend/src/services/chatService.ts`
- `backend/src/assistant/services/assistantPreviewService.ts`
- `backend/src/routes/authorizedCompanies.ts`
- `backend/src/composition.ts`
- `backend/src/app.ts` only if route-level raw body parsing requires mounting order changes
- `backend/package.json` and `backend/package-lock.json` only after PDF dependency approval

The current `knowledgeRepository.ts`, `knowledgeService.ts`, `onboardingService.ts`, `knowledgeBuilder.ts`, `markdownCleaner.ts`, `knowledgeController.ts`, legacy routes, and markdown debug repository should be modified, adapted, or retired deliberately; they must not coexist as competing business implementations.

### Expected frontend files

- New `frontend/src/state/knowledgeState.ts` and tests
- New bounded Knowledge panel/form/publication components and component tests
- Modified `frontend/src/api/atlasApi.ts`, `frontend/src/types/api.ts`, authenticated portal composition, translations, and test scripts

### Expected documentation

- One ADR if Architecture Review changes or concretizes knowledge publication/security decisions beyond ADR-004.
- API/operational documentation and migration/backup runbook updates.

## 26. Dependencies

- Reuse Express, `node:sqlite`, Firecrawl, Gemini, React, and existing test tooling.
- No vector, queue, storage, multipart, validation, state-management, or observability dependency is required.
- One direct PDF parsing dependency is likely necessary. Preferred candidate: `pdfjs-dist`, subject to a Node 24 ESM compatibility test, text extraction quality test, package size/licensing review, CVE review, maintenance check, and lockfile pinning.
- If raw `application/pdf` transport is rejected in favor of multipart, a narrowly scoped multipart parser would become a second dependency and requires the same review. Do not hand-roll multipart parsing.
- Provider calls need timeouts using platform `AbortSignal` where supported; do not add a timeout package.

## 27. Risks

1. **SSRF and redirect bypass:** URL ingestion can become a network pivot unless every hop and resolved address is constrained.
2. **PDF parser exposure:** malformed files can cause CPU/memory exhaustion or exploit parser vulnerabilities.
3. **Prompt injection/data poisoning:** source content may try to override extraction or answering rules.
4. **Conflicting sources:** deterministic merging can surface facts that require human resolution; silent precedence would be unsafe.
5. **SQLite write contention:** synchronous ingestion completion and publication transactions can conflict under concurrent requests.
6. **Migration complexity:** rebuilding `companies` while preserving all foreign keys and backfilling publications risks data loss without rehearsal/backup.
7. **Oversized whole-snapshot retrieval:** without chunking/vector search, publication limits may constrain customers with large knowledge sets.
8. **Long HTTP duration:** Firecrawl, PDF parsing, and AI extraction can exceed proxy/request limits without a job system.
9. **Legacy surface drift:** authenticated source management and default-workspace onboarding could produce competing semantics.
10. **Company status ambiguity:** current `processing/ready/failed` represents onboarding, while the new design has independent source jobs and publication readiness.
11. **Raw-input retention tradeoff:** not storing PDFs reduces exposure/cost but prevents exact reprocessing without re-upload.
12. **Permission mismatch:** allowing operators to ingest but not publish may surprise users and needs clear UI/product policy.

## 28. Acceptance Criteria

- [ ] An authorized member can create Manual Text, Public URL, and PDF sources for a Company in the selected Workspace.
- [ ] Every attempt has a persisted immutable revision and safe terminal status; retry never overwrites history.
- [ ] Cross-workspace and unauthorized access behaves as generic not found at HTTP and returns no data at repository level.
- [ ] Failed/retried ingestion cannot remove or alter the current publication.
- [ ] Ready revisions remain invisible to Assistant Preview until explicit authorized publication.
- [ ] Publication is atomic, optimistic-concurrency protected, auditable, and selects exact ready revisions.
- [ ] Preview and Chat load only the Company's current published version and preserve provider-neutral execution.
- [ ] Manual, URL, and PDF input limits and stable errors are enforced server-side.
- [ ] URL acquisition passes SSRF/redirect/DNS tests; PDF parsing passes type/signature/limit/encryption/empty-text tests.
- [ ] No vector database, embeddings, background queue, raw PDF persistence, or Assistant-owned knowledge is introduced.
- [ ] Existing knowledge is backfilled into an equivalent current publication with verified counts, values, and foreign keys.
- [ ] Frontend ignores stale cross-tenant responses and exposes accessible, localized lifecycle/publication states.
- [ ] All existing and EPIC 012 backend/frontend tests, typechecks, and frontend build pass.
- [ ] Backup, restore, migration rehearsal, and operational failure guidance are documented before deployment.

## 29. Explicit Architecture Decisions

1. Workspace remains the tenant/authority boundary; Company owns Knowledge Sources, revisions, and versions.
2. Assistant Profiles do not own, copy, publish, or select knowledge.
3. Knowledge source revision and Company Knowledge version are separate immutable concepts.
4. Ingestion and publication are separate commands; publication is always explicit.
5. One Company has zero or one atomically selected published Knowledge Version.
6. Only the published version is executable; “latest” has no runtime meaning.
7. AI extracts candidate facts but application policy validates, merges, and publishes them.
8. Providers acquire/parse/generate only; they do not authorize, select tenants, access repositories, or own lifecycle policy.
9. Retrieval is the bounded complete structured publication; no vector infrastructure is introduced.
10. PDF bytes are processed transiently and not persisted in this epic.
11. New management APIs are authenticated workspace routes with CSRF; legacy default-workspace routes gain no new authority.
12. Persistence is SQLite behind mandatory workspace-scoped ports and explicit transactions.
13. Publication history and source revisions are retained; archive is preferred over destructive delete.
14. A failed refresh preserves the last published version.
15. Frontend concurrency controls improve UX; database constraints and CAS provide correctness.

## 30. Open Questions for Architecture Review

1. Should `knowledge:publish` be limited to Owner/Administrator, or may Operator publish after ingestion?
2. Should the migration introduce an internal `legacy` source kind, or record migrated rows as `manual_text` with explicit legacy origin metadata?
3. Is raw `application/pdf` acceptable for Beta 1, or is multipart upload a firm UX/API requirement?
4. Does `pdfjs-dist` meet the repository's Node 24 ESM, license, security, size, and extraction-quality criteria, or should another local parser be selected?
5. What exact byte, character, page, source-count, FAQ-count, and published-snapshot limits fit the pilot market and Gemini context budget?
6. Can Firecrawl prove/enforce redirect and public-network restrictions, or must Atlas use a different acquisition adapter for SSRF guarantees?
7. Should source normalized text be visible through an authorized detail API for review, or should the UI expose only structured extracted facts?
8. How should users resolve conflicting scalar facts before publication: edit the source, exclude a revision, or use an explicit reviewed override source?
9. Should candidate Knowledge Versions be created only by Publish, or should a separate preview/validate candidate command persist unpublished versions?
10. What should Company `processing/ready/failed` mean after source-level ingestion exists, and should it be replaced by a derived publication readiness field in a later epic?
11. Must the legacy unauthenticated/default-workspace endpoints remain during Beta 1, and what is their removal milestone?
12. Is synchronous ingestion acceptable within known hosting timeouts, or must EPIC 012 include a durable local job runner despite the current no-queue baseline?
13. Is non-retention of original PDF bytes acceptable for audit/reprocessing, or is an approved provider-neutral blob-storage port required before launch?
14. Should publishing an identical snapshot with a different source manifest create a new auditable version or be treated as idempotent?

## Verification Commands and Expected Results

During implementation, run from the repository root:

```powershell
npm test
npm run typecheck
npm run build
git status --short
```

Also run backend migration tests against an in-memory database and a copied migration-8 fixture, followed by `PRAGMA foreign_key_check` and logical snapshot comparison. Expected results: all existing and EPIC 012 tests pass, backend and frontend typechecks pass, frontend build succeeds, migration integrity checks return no rows, and Git status contains only the intended implementation/documentation changes.

Suggested implementation commit message:

```text
feat(knowledge): add versioned company knowledge foundation
```
