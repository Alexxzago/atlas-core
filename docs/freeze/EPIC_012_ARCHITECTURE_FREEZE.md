# EPIC 012 — Architecture Freeze

**Status:** Frozen  
**Authority:** Single implementation contract for EPIC 012  
**Freeze date:** 2026-07-20  
**Inputs considered:** Engineering Plan, independent Architecture Review, accepted ADRs, architecture baseline, engineering prompt, and current repository

This document is independent. It does not amend the Engineering Plan or Architecture Review. Where either earlier document offers alternatives, leaves a decision unresolved, or conflicts with this contract, this freeze is authoritative for EPIC 012 implementation.

## 1. Executive Summary

EPIC 012 introduces a Company-owned Knowledge module supporting Manual Text, one Public URL, and one PDF per source ingestion. Workspace remains the tenant boundary. Knowledge remains independent from Assistant Profiles, channels, providers, prompts, and users. Providers acquire or transform content only; application services own lifecycle, validation, deterministic compilation, authorization inputs, and publication.

Knowledge has three durable concepts: a mutable source identity, immutable terminal source revisions, and immutable published Company Knowledge Versions. There is no persistent draft version, candidate aggregate, publication event aggregate, or Company-to-Version pointer. One `company_knowledge_publications` row per Company is the sole current-publication authority. It points to one immutable version and is changed atomically with compare-and-swap.

Ingestion is synchronous for this epic. Each request reserves a pending revision, performs external work without holding a SQLite transaction, then completes the exact revision as `ready` or `failed` through compare-and-swap. Ingestion never changes runtime knowledge. Publishing is a separate explicit authenticated command, except that the pre-existing legacy `onboard` command is defined as an explicit combined ingest-and-publish compatibility use case.

Publication compiles exact ready revision IDs using a frozen pure deterministic algorithm. Company identity fields come only from the current Company record. Source facts cannot override them. Conflicting hours or FAQ answers block publication; arrays are normalized, deduplicated, and sorted. AI may extract candidate facts per source but never merges sources or chooses conflict winners.

Assistant Preview and legacy Chat read only the bounded structured snapshot referenced by the current-publication row. No vector database, embeddings, chunk retrieval, OCR, crawl, queue, raw file storage, or Assistant-owned knowledge is introduced.

## 2. Frozen Domain Model

### 2.1 Ownership

```text
Workspace 1 ── 0..* Company
Company   1 ── 0..* KnowledgeSource
KnowledgeSource 1 ── 1..* KnowledgeSourceRevision
Company   1 ── 0..* CompanyKnowledgeVersion
Company   1 ── 0..1 CurrentKnowledgePublication
CompanyKnowledgeVersion * ── 1..* KnowledgeSourceRevision
```

- `Workspace` is the tenant and administrative authority boundary.
- `Company` is the business owner of every Knowledge record.
- Knowledge tables do not duplicate `workspace_id`; repositories prove Workspace ownership by joining through `companies`.
- `AssistantProfile` has no Knowledge foreign key, source selection, publication reference, or copied facts.
- A User is an actor, never an owner. Actor identity is recorded as an immutable identifier string and does not control tenant scope.

### 2.2 `KnowledgeSource`

A source is the mutable Company-owned identity of material that may be revised.

- `id`: opaque `ksrc_` public identifier generated with cryptographically secure randomness.
- `companyId`: internal Company ID.
- `kind`: exactly `manual_text | public_url | pdf` and immutable after creation.
- `origin`: exactly `user | legacy_migration` and immutable after creation. `legacy_migration` is internal and is never accepted from an API request.
- `name`: trimmed display name, 1–120 Unicode code points.
- `normalizedName`: Unicode NFKC, trimmed, internal whitespace collapsed, locale-independent lowercase.
- `locator`: canonical public URL for `public_url`; `null` for other kinds. Updating URL content creates a revision and updates locator with source compare-and-swap.
- `status`: `active | archived`.
- `version`: positive optimistic concurrency integer, incremented on locator update or archive.
- timestamps: `createdAt`, `updatedAt`, `archivedAt`.

Names are unique across all sources in one Company, including archived sources. Archived names cannot be reused. Archiving is irreversible in EPIC 012 and does not affect an already published version.

### 2.3 `KnowledgeSourceRevision`

A revision is one synchronous ingestion attempt.

- `id`: opaque `ksrv_` identifier.
- `sourceId` and positive source-local `revisionNumber`.
- `status`: exactly `pending | ready | failed`.
- `mediaType`: `text/plain`, `text/markdown`, or `application/pdf` as produced by the source adapter.
- `contentDigest`: SHA-256 of normalized UTF-8 text when ready; `null` when failed.
- `normalizedText`: normalized UTF-8 text when ready; `null` when failed. A migrated revision may have `null` normalized text because only its validated legacy structured extraction exists.
- `extractedKnowledge`: provider-neutral `ExtractedBusinessKnowledge` JSON when ready; `null` otherwise.
- `extractorSchemaVersion`: fixed string identifying extraction schema, initially `company-business-knowledge-v1`.
- bounded input/normalized byte and character counts; PDF page count where applicable.
- `failureCode`: enumerated safe code only for failed revisions.
- `createdAt`, `completedAt`.

A pending revision may transition once to `ready` or `failed` by compare-and-swap. A terminal revision is immutable. Retry always creates a new revision. At most one pending revision exists per source. Revisions cannot be individually deleted or edited.

`ExtractedBusinessKnowledge` contains only:

```text
services: string[]
hours: string
locations: string[]
faq: { question: string; answer: string }[]
```

It deliberately excludes Company name, website, phone, and email. Those fields come from the authoritative Company aggregate during compilation.

### 2.4 `CompanyKnowledgeVersion`

A version is an immutable published snapshot. Versions are never created before publication and have no draft state.

- `id`: opaque `kver_` identifier.
- `companyId` and positive Company-local `versionNumber`.
- `compilerVersion`: initially `company-knowledge-compiler-v1`.
- `knowledge`: canonical `CompanyKnowledge` JSON.
- `snapshotDigest`: SHA-256 over compiler version, canonical ordered manifest IDs, and canonical knowledge JSON.
- immutable publisher actor ID and publication timestamp.

The manifest contains exactly one or more ready revision IDs, at most one revision from each source. Different manifests produce different snapshot digests even if their compiled `CompanyKnowledge` is equal. Repeating the same compiler version, manifest, and output is idempotent.

### 2.5 `CurrentKnowledgePublication`

One row per Company is the only current-publication authority:

- `companyId`: primary key.
- `knowledgeVersionId`: the currently executable version.
- `publicationVersion`: positive compare-and-swap integer.
- `publishedByActorId` and `publishedAt` copied from the current publication command.

There is no publication event table and no pointer on `companies`. Historical versions themselves preserve publication history. No other “current,” “latest,” or timestamp query is valid for runtime retrieval.

### 2.6 Trusted contexts

`WorkspaceContext` remains exactly the trusted tenant context required by ADR-008. It is not expanded with identity or permissions.

`ActorContext` is a separate immutable server-created application value:

```text
userId: UserId
membershipId: MembershipId
role: MembershipRole
capabilities: ImmutablePermissionSet
```

Routes derive it from the authenticated Session and active Membership. No body, query, path, or header value can establish actor or Workspace authority.

## 3. Frozen Lifecycle

### 3.1 Source creation and ingestion

```text
none
  └─ create source + pending revision (short transaction)
       ├─ acquire/normalize/extract outside transaction
       └─ CAS pending → ready | failed (short transaction)
```

1. Authenticate, authorize, resolve `WorkspaceContext` and `ActorContext`, validate Company and source request.
2. In one `BEGIN IMMEDIATE` transaction, create the source and revision number 1 in `pending` state.
3. Commit before file parsing, network access, or AI calls.
4. Acquire/parse, normalize, enforce limits, extract candidate facts, and validate the exact schema.
5. In a second short transaction, update that revision only when it is still `pending`.
6. Return the terminal source/revision result. A provider failure is persisted as failed before the HTTP error is returned.

For an existing active source, a retry/revision request performs the same flow after checking kind and `expectedSourceVersion`. A pending revision causes `409 knowledge_ingestion_in_progress`.

### 3.2 Abandoned pending revision

- The application uses the existing injected Clock abstraction.
- A pending revision is abandoned 10 minutes after `createdAt`.
- A new retry request first attempts a conditional update from expired `pending` to `failed` with `failureCode = ingestion_interrupted`, then reserves the next revision.
- No scheduler, lease, worker, or automatic resumption exists.
- A late completion uses `WHERE status = 'pending'`; after recovery it changes zero rows and is discarded. It never returns success and never changes a later revision.

### 3.3 Publication

1. Client submits exact revision IDs and expected current Knowledge Version ID (`null` for no publication).
2. Server resolves the Company and all revisions in trusted Workspace context.
3. Exactly one ready revision per active source may be selected; archived sources and pending/failed revisions are rejected.
4. Pure compiler produces either a bounded valid snapshot or a deterministic conflict/error set.
5. In one `BEGIN IMMEDIATE` transaction, the repository rechecks ownership/status, allocates the next version number, inserts immutable version and manifest, then compare-and-swap inserts/updates the current-publication row.
6. If the expected current ID no longer matches, the entire transaction rolls back with `409 knowledge_publication_changed`.
7. If the computed digest equals the current version digest, no row is added or updated and the current publication is returned as idempotent `200`.
8. Otherwise the new version becomes current and the response is `201`.

There is no unpublish operation. A Company with a publication always retains one until the Company is deleted or a later epic explicitly introduces unpublish.

### 3.4 Source archive

- Only an active source without a pending revision may be archived.
- Archive requires `expectedSourceVersion` and is irreversible.
- An archived source remains in historical manifests and does not alter the current publication.
- Archived source revisions cannot be selected for a future publication.

### 3.5 Company status

- `ready`: a current-publication row exists.
- `processing`: no current publication exists and at least one pending source revision exists.
- `failed`: no current publication exists, no pending revision exists, and at least one ingestion attempt failed.
- A newly created Company remains `processing` under the existing contract until its first terminal outcome.
- Once a Company is `ready`, later ingestion failure or source archive does not change it. Successful first publication sets it to `ready` in the publication transaction.
- This epic retains the existing persisted Company status for compatibility; services enforce the above derivation on Knowledge operations.

### 3.6 Legacy onboarding

The existing `POST /companies/:companyId/onboard` and authenticated nested onboard command remain compatibility endpoints. Invoking `onboard` is explicit intent to ingest the submitted URL and publish it. The use case creates or revises a reserved source named `Website onboarding`, ingests it, and publishes that exact ready revision through the same compiler and publication transaction. It preserves the existing response shape. A failure preserves the previous publication and keeps a previously ready Company ready.

No legacy code writes `company_knowledge`. `/scrape` remains a non-persistent diagnostic compatibility endpoint and is never called by the new Knowledge module. `/knowledge` and `/chat` read the new current publication only after migration.

## 4. Frozen Persistence

One append-only migration after migration 8 introduces the following schema. Migrations 1–8 are immutable.

### 4.1 `knowledge_sources`

```text
id TEXT PRIMARY KEY
company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE
kind TEXT NOT NULL CHECK kind IN ('manual_text','public_url','pdf')
origin TEXT NOT NULL CHECK origin IN ('user','legacy_migration')
name TEXT NOT NULL
normalized_name TEXT NOT NULL
locator TEXT
status TEXT NOT NULL CHECK status IN ('active','archived')
version INTEGER NOT NULL CHECK version > 0
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
archived_at TEXT
UNIQUE(company_id, normalized_name)
```

Checks require locator only for URL sources and enforce archived timestamp consistency. Index `(company_id, status, created_at DESC, id DESC)`.

### 4.2 `knowledge_source_revisions`

```text
id TEXT PRIMARY KEY
source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE
revision_number INTEGER NOT NULL CHECK revision_number > 0
status TEXT NOT NULL CHECK status IN ('pending','ready','failed')
media_type TEXT NOT NULL
content_digest TEXT
normalized_text TEXT
extracted_knowledge_json TEXT
extractor_schema_version TEXT NOT NULL
input_bytes INTEGER NOT NULL CHECK input_bytes >= 0
normalized_bytes INTEGER
normalized_characters INTEGER
page_count INTEGER
failure_code TEXT
created_at TEXT NOT NULL
completed_at TEXT
UNIQUE(source_id, revision_number)
```

Status-dependent checks require ready extraction/digest/completion, failed code/completion, and null terminal data while pending. The single migration exception permits a ready `legacy_migration` revision with null normalized text; the application cannot create this exception. A partial unique index on `source_id WHERE status = 'pending'` enforces one active attempt.

### 4.3 `company_knowledge_versions`

```text
id TEXT PRIMARY KEY
company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE
version_number INTEGER NOT NULL CHECK version_number > 0
compiler_version TEXT NOT NULL
knowledge_json TEXT NOT NULL
snapshot_digest TEXT NOT NULL
published_by_actor_id TEXT NOT NULL
published_at TEXT NOT NULL
UNIQUE(company_id, version_number)
UNIQUE(company_id, snapshot_digest)
```

Actor ID is an immutable audit string without a foreign key to `users`; later User lifecycle changes cannot erase attribution or block Company deletion.

### 4.4 `company_knowledge_version_sources`

```text
knowledge_version_id TEXT NOT NULL REFERENCES company_knowledge_versions(id) ON DELETE CASCADE
source_revision_id TEXT NOT NULL REFERENCES knowledge_source_revisions(id) ON DELETE CASCADE
ordinal INTEGER NOT NULL CHECK ordinal > 0
PRIMARY KEY(knowledge_version_id, source_revision_id)
UNIQUE(knowledge_version_id, ordinal)
```

The application never deletes revisions. `ON DELETE CASCADE` on both paths exists so deleting the owning Company can remove the complete aggregate graph without a `RESTRICT` cycle.

### 4.5 `company_knowledge_publications`

```text
company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE
knowledge_version_id TEXT NOT NULL UNIQUE REFERENCES company_knowledge_versions(id) ON DELETE CASCADE
publication_version INTEGER NOT NULL CHECK publication_version > 0
published_by_actor_id TEXT NOT NULL
published_at TEXT NOT NULL
```

Repository writes verify that version and Company match. No circular reference exists. `companies` is not rebuilt or altered.

### 4.6 Repository and transaction boundaries

- Every Company-owned repository method requires `WorkspaceContext` and Company ID.
- Queries begin from `companies` or join it with `workspace_id = ? AND companies.id = ?`.
- Source/revision/version IDs never establish scope.
- SQLite row shapes and JSON parsing remain inside repositories.
- JSON is validated on write and reconstruction. Invalid stored JSON is an internal integrity failure, never silently coerced.
- Provider I/O and PDF parsing never occur inside a SQLite transaction.
- Publication persistence is exposed as one transaction port, not several repository calls coordinated by a service.

### 4.7 Retention and deletion

- Raw PDF bytes and raw URL responses are never persisted.
- Ready normalized text and structured extraction are retained while the Company exists, including archived sources, because immutable publication provenance must be inspectable.
- Failed revisions retain only safe metadata, counts known before failure, and failure code; source content is discarded.
- Individual revisions and versions have no delete API.
- Company deletion, already an authorized use case, cascades all its sources, revisions, manifests, versions, and current publication in one database transaction.
- Actor identifiers remain strings within Company-owned history and disappear with Company deletion.
- Knowledge export includes sources, revision metadata, ready normalized text, structured extractions, versions, manifests, and current-publication identity. It excludes raw PDF bytes, raw provider payloads, secrets, prompts, and authentication data.
- SQLite backups include the complete retained model. Backup and restore are mandatory before production migration under ADR-011.

## 5. Frozen API

All new routes are nested under:

```text
/workspaces/:workspaceId/companies/:companyId/knowledge
```

They use existing Session authentication, exact-Origin/Fetch-Metadata rules, CSRF for mutation, trusted Workspace resolution, and generic `404` concealment. All responses set `Cache-Control: no-store, private` and `Pragma: no-cache`.

### 5.1 Capabilities

The server-derived Workspace DTO gains:

```text
capabilities: Permission[]
```

It is returned by Workspace list/selected/select responses as a sorted immutable JSON array derived by `PermissionPolicy`. It is advisory for UI rendering; routes authorize independently.

Frozen permissions:

| Permission | Owner | Administrator | Operator | Viewer |
|---|:---:|:---:|:---:|:---:|
| `knowledge:read` | yes | yes | yes | yes |
| `knowledge:ingest` | yes | yes | yes | no |
| `knowledge:publish` | yes | yes | no | no |
| `knowledge:archive` | yes | yes | no | no |

### 5.2 Query endpoints

`GET /sources`

- Requires `knowledge:read`.
- Returns active and archived source summaries, their latest terminal/pending revision summary, and whether a revision is in the current manifest.
- Does not return normalized text or extraction bodies.

`GET /sources/:sourceId/revisions/:revisionId`

- Requires `knowledge:read`.
- Returns source/revision metadata and ready normalized text plus extracted facts, bounded by stored limits.
- Returns generic `404` for any ownership mismatch.

`GET /publication`

- Requires `knowledge:read`.
- Returns `200` with current version ID/number, publication version, publisher actor ID, published time, ordered revision IDs, and compiled `CompanyKnowledge`.
- Returns `404 { error: { code: "knowledge_unavailable", message: "Published Company Knowledge was not found." } }` when the Company exists but has no publication. Authorization/resource mismatches use the generic resource `404`.

### 5.3 Create source endpoints

`POST /sources/manual`

```json
{ "name": "Policies", "text": "..." }
```

`POST /sources/url`

```json
{ "name": "Main website", "url": "https://example.com/about" }
```

`POST /sources/pdf?name=<percent-encoded-name>`

- Body is raw bytes with exactly `Content-Type: application/pdf`.
- Route-local `express.raw` parses this endpoint before global JSON middleware can consume it.
- Query contains only the source display name; actor, tenant, kind, filename, and media type cannot be supplied as authority.

All require `knowledge:ingest`. On completed success they return `201` with source summary and ready revision detail. A persisted ingestion failure returns the mapped `4xx`/`503` with `revisionId` in safe error details so the UI can refresh history. They never publish.

### 5.4 Create revision endpoints

`POST /sources/:sourceId/revisions/manual`

```json
{ "text": "...", "expectedSourceVersion": 3 }
```

`POST /sources/:sourceId/revisions/url`

```json
{ "url": "https://example.com/about", "expectedSourceVersion": 3 }
```

`POST /sources/:sourceId/revisions/pdf?expectedSourceVersion=3`

- Raw PDF body and exact content type as above.
- Endpoint suffix must match immutable source kind; mismatch is `409 knowledge_source_kind_mismatch`.
- All require `knowledge:ingest`.

### 5.5 Archive endpoint

`POST /sources/:sourceId/archive`

```json
{ "expectedSourceVersion": 3 }
```

- Requires `knowledge:archive`.
- Returns updated source or `409` for stale version/pending ingestion/already archived.

### 5.6 Publication endpoint

`POST /publication`

```json
{
  "sourceRevisionIds": ["ksrv_...", "ksrv_..."],
  "expectedKnowledgeVersionId": null
}
```

- Requires `knowledge:publish`.
- `sourceRevisionIds` must contain 1–25 unique IDs and at most one per active source.
- `expectedKnowledgeVersionId` is `null` only for first publication; otherwise it must equal the current version ID.
- Returns `201` for a new version and `200` for an idempotent current digest.
- Returns `409 knowledge_publication_changed`, `source_revision_not_ready`, `source_archived`, or `knowledge_conflict` as appropriate.
- Conflict details contain only field path, normalized conflict category, and involved source/revision IDs; they contain no raw text.

### 5.7 Error envelope and status mapping

All new errors use:

```json
{ "error": { "code": "stable_code", "message": "safe message", "details": {} } }
```

- `400`: malformed body, ID shape, URL, source name, expected version, or limit-independent validation.
- `404`: generic authority/ownership/resource mismatch; special `knowledge_unavailable` only after authorized Company resolution.
- `409`: lifecycle, optimistic concurrency, publication race, source-kind mismatch, or knowledge conflict.
- `413`: manual/raw input or acquired content exceeds byte/character/page policy.
- `415`: media type/signature unsupported.
- `422`: syntactically valid PDF/source with no usable text or extraction output that cannot satisfy schema.
- `503`: URL, extraction provider, or bounded parser temporarily unavailable.

No stack, provider payload, SQL detail, raw input, prompt, secret, or cross-tenant clue is returned.

## 6. Frozen Frontend

- Add a Company Knowledge panel only inside the authenticated selected Workspace/Company portal.
- Use a dedicated `knowledgeState` reducer/hook. Do not add Knowledge lifecycle to Assistant Profile state.
- State captures request ID, Workspace ID, Company ID, generation, source ID, and operation. Abort and increment generation on Workspace change, Company change, logout, and unmount. Late responses with mismatched context are ignored.
- GET/HEAD may follow the existing one-time authentication recovery rule. POST requests are never replayed automatically.
- Render controls from the server-provided `capabilities` array. Components do not derive permissions from role.
- Viewer sees sources, revision detail, and current publication but no mutation controls.
- Operator may create/retry sources but cannot archive or publish.
- Owner/Administrator may perform all Knowledge operations.
- Creation UI has exactly three modes: Manual Text, Public URL, PDF. PDF shows the frozen 10 MiB/100-page/no-OCR policy before submission.
- UI distinguishes `pending`, `ready unpublished`, `failed`, `included in current publication`, and `archived`. “Saved” is not used as a synonym for published.
- Publication review selects exact ready revisions, one per active source, displays current version, and sends its expected version ID.
- On `knowledge_publication_changed`, clear selection, reload sources/publication, and require explicit review/resubmission.
- On Company/context change, clear all source bodies and selected files from memory.
- Visible text is added to both typed English and Spanish dictionaries. Status, pending, success, and error output follows existing accessible live-region patterns.
- Browser validation mirrors limits for feedback only; server validation remains authoritative.

## 7. Frozen Security

### 7.1 Input and retrieval limits

Frozen maximums are measured after Unicode normalization where applicable:

| Resource | Limit |
|---|---:|
| Sources per Company, including archived | 50 |
| Revisions selected per publication | 25 |
| Source name | 120 Unicode code points |
| Manual request UTF-8 body | 100 KiB |
| Manual normalized text | 80,000 code points and 100 KiB |
| URL acquired response | 2 MiB |
| URL normalized text | 100,000 code points and 256 KiB |
| PDF upload | 10 MiB |
| PDF pages | 100 |
| PDF normalized text | 100,000 code points and 256 KiB |
| Services | 100 items; 200 code points each |
| Locations | 50 items; 200 code points each |
| Hours | 1,000 code points |
| FAQs | 100 items |
| FAQ question | 300 code points |
| FAQ answer | 2,000 code points |
| Canonical published Knowledge JSON | 128 KiB UTF-8 |

Crossing any limit fails closed; content is never silently truncated into factual authority.

### 7.2 URL provider contract

`PublicUrlContentProvider.acquire(request)` is acceptable only when the adapter enforces the actual fetch, not merely prevalidation:

- exact canonical `http` or `https` URL; HTTPS is preferred but HTTP remains supported for public legacy sites;
- no credentials, fragment, localhost/special-use hostname, non-public literal/resolved address, or port other than 80/443;
- DNS/IP validation immediately before every network connection;
- revalidation on every redirect; at most three redirects;
- no downgrade from HTTPS to HTTP;
- one page only and no sitemap/crawl;
- `text/html`, `text/plain`, or `text/markdown` only;
- 2 MiB maximum response, 30-second acquisition deadline, and abort support;
- response includes final URL, media type, byte count, and normalized candidate text; no provider-specific shape crosses the port.

Atlas performs initial validation as defense in depth. The Firecrawl adapter may be used only if its pinned API/SDK contract demonstrably satisfies every actual-fetch requirement and automated contract tests prove the exposed controls. If it cannot, Firecrawl is rejected for this use case and EPIC 012 must implement the port with Node's built-in HTTP(S) facilities in the provider layer using the same controls. URL ingestion may not ship with a weaker contract.

### 7.3 PDF strategy

- Transport is raw `application/pdf`; multipart is not introduced.
- Parser is the open-source `pdfjs-dist` package behind `PdfTextExtractor`.
- Implementation installs one exact lockfile version that passes Node 24 ESM, license, maintenance, known-vulnerability, malformed-fixture, and extraction-quality checks at implementation time. Failure of any gate blocks the dependency and implementation; it does not reopen the architecture or permit an external paid service.
- Validate exact content type, `%PDF-` signature within the first 1,024 bytes, byte limit, encryption/password state, page limit, and non-empty extracted text.
- Parsing runs in a Node worker thread owned by the adapter. The worker receives only the bounded byte buffer, has no credentials or repository access, and is forcibly terminated after 15 seconds.
- Worker failure, memory exhaustion, timeout, malformed document, embedded JavaScript, attachments, external references, or encryption fails closed. Embedded content is never executed or fetched.
- OCR, image-only PDFs, layout reconstruction, and raw-PDF retention are excluded.

### 7.4 AI extraction

- `KnowledgeFactExtractor` receives source kind, bounded normalized text, schema version, and URL only when factual context requires it.
- It receives no Workspace context, actor, repository, model choice, credential, publication state, or Assistant Profile.
- Provider prompt labels source material as untrusted candidate facts and keeps non-invention/schema rules at highest priority.
- Output is parsed as unknown, strictly validated, normalized, and bounded. Invalid output fails the revision; it is never repaired by application inference.
- Extraction deadline is 45 seconds. Total ingestion deadline is 60 seconds.

### 7.5 HTTP and data safety

- Existing Session, CSRF, exact Origin, Fetch Metadata, no-store, and generic-not-found rules are mandatory.
- Normalized text is rendered as plain text only; no ingested HTML/Markdown is injected into the DOM.
- Logs never include source bodies, normalized text, raw PDF, model prompts/responses, cookies, CSRF tokens, secrets, or provider credentials.
- Safe structured logs include correlation ID, trusted internal scope IDs, source kind, revision ID, counts, duration, and enumerated outcome.
- Existing file markdown debug storage is not used by new ingestion or legacy onboarding after cutover.

## 8. Frozen Concurrency

- SQLite is the correctness authority; frontend aborts and request IDs provide UX correctness only.
- Source creation/revision allocation uses `BEGIN IMMEDIATE`, unique name/revision constraints, and one-pending partial uniqueness.
- Source mutation compares `knowledge_sources.version`. A stale value returns `409 knowledge_source_changed`.
- No database transaction spans URL acquisition, PDF parsing, or AI extraction.
- Terminal revision write uses `UPDATE ... WHERE id = ? AND status = 'pending'`. Zero changed rows means the attempt lost recovery/CAS and its result is discarded.
- Publication compilation happens before the write transaction, then ownership/readiness and current version are rechecked inside the transaction.
- Current publication CAS compares `expectedKnowledgeVersionId`; first publication requires no existing row.
- Version number is allocated inside `BEGIN IMMEDIATE` as current maximum plus one under the Company-scoped write lock.
- Snapshot digest includes compiler version, sorted manifest IDs, and canonical JSON. A digest equal to the current version is idempotent; an equal historical digest is returned only if it is already current. The unique constraint prevents duplicate historical rows.
- Concurrent equal publishes: one succeeds; the other observes a changed current publication and returns `409` unless its expected version and resulting digest now exactly match current, in which case it returns idempotent `200`.
- SQLite busy/lock exhaustion maps to `503 knowledge_temporarily_unavailable`, never a false lifecycle conflict.

## 9. Frozen Retrieval

### 9.1 Deterministic compiler

The compiler is a pure application/domain function. Its inputs are current Company identity plus 1–25 ready revisions resolved in trusted scope. It performs no I/O and invokes no provider.

Canonical manifest order is ascending opaque `sourceId`, then `revisionId`; exactly one revision per source makes the second key a deterministic tie-break only. Output order never depends on client array order, database row order, source display name, or source kind.

Text comparison key for services, locations, FAQ questions, and FAQ answers:

1. Unicode NFKC;
2. trim leading/trailing whitespace;
3. collapse internal Unicode whitespace to one ASCII space;
4. locale-independent Unicode lowercase.

Empty normalized values are discarded. Display values use the trimmed/collapsed original from the lexicographically first manifest revision that provides the comparison key.

Frozen merge rules:

- `company.name`, `website`, `phone`, and `email` come exclusively from the current Company record after existing Company validation. Extractors cannot supply them.
- `services`: union by comparison key; identical keys deduplicate; final list sorted by comparison key.
- `locations`: same rule as services.
- `hours`: discard empty values; identical comparison keys deduplicate; zero values produces `""`; more than one distinct value is `knowledge_conflict` at `business.hours`.
- `faq`: identity is normalized question key. Duplicate question plus identical normalized answer deduplicates. The same question with two different non-empty answer keys is `knowledge_conflict` at `faq[question-key]`. Empty question or answer is discarded. Final list sorted by question key, then answer key.
- Exact duplicates are not conflicts. No source priority, latest-wins, kind priority, or AI arbitration exists.
- Compiler validates item/field/JSON limits after merge. Exceeding them returns a stable limit error; it never truncates.

Canonical JSON uses a fixed field order matching `CompanyKnowledge`, array order defined above, no insignificant whitespace, and UTF-8 encoding. `snapshotDigest` is SHA-256 of:

```text
compilerVersion + "\n" + manifestRevisionIdsJoinedByNewline + "\n" + canonicalKnowledgeJson
```

### 9.2 Runtime read

`PublishedCompanyKnowledgeReader.load(context, companyId)` joins:

```text
companies
→ company_knowledge_publications
→ company_knowledge_versions
```

with mandatory Workspace scope. It validates stored JSON and the 128 KiB bound on reconstruction and returns the application `CompanyKnowledge` projection or `null`.

- Assistant Preview requires ready Profile, Company status `ready`, and a current publication.
- Legacy Chat uses the same published projection and retains its exact-FAQ shortcut.
- Preview always passes the complete bounded snapshot through the immutable ADR-013 execution contract and provider adapter.
- Providers never retrieve Knowledge.
- Source/revision metadata and normalized text never enter assistant execution.
- No vector, embedding, chunk, relevance, or “latest revision” lookup exists.

## 10. Frozen Migration

### 10.1 Additive migration and backfill

The new migration creates the five new tables without altering or rebuilding `companies`.

For every existing `company_knowledge` row:

1. Create one `manual_text` source named `Migrated knowledge`, with `origin = legacy_migration`, active status, null locator, and generated opaque ID.
2. Create one ready revision with `media_type = text/plain`, `extractor_schema_version = company-business-knowledge-v1`, null normalized text, and `extracted_knowledge_json` containing the existing business/FAQ fields exactly.
3. Reconstruct the complete legacy `CompanyKnowledge` by joining Company identity fields with the knowledge row.
4. Create version number 1 using `company-knowledge-compiler-v1`, the migration manifest, canonical JSON, deterministic digest, actor ID `system:legacy-migration`, and the original knowledge `updated_at` as publication time.
5. Insert the manifest and current-publication row with publication version 1.
6. Preserve Company status and every existing Company/Knowledge value exactly.

The migration is deterministic in logical result, not opaque IDs. IDs may use SQLite secure random bytes; reruns are prevented by the migration record and transaction.

### 10.2 Legacy table cutover

- Rename `company_knowledge` to `company_knowledge_legacy` in the same migration after verified backfill.
- The legacy table remains read-only for one compatibility release as rollback evidence. No repository, service, endpoint, test fixture, or runtime query reads or writes it after cutover.
- A later dedicated migration may drop it only after production backup/restore and logical comparison evidence.
- `KnowledgeRepositoryPort.save/delete/load` is retired or adapted so there is exactly one runtime published reader and one publication writer.
- Legacy onboarding calls the new combined use case; it does not dual-write.

### 10.3 Migration verification

Before commit and deployment, tests must prove:

- existing and copied Company row counts match;
- legacy knowledge row count equals migrated source, revision, version, manifest, and current-publication counts;
- deserialized published snapshots deeply equal every legacy `CompanyKnowledge` value;
- Companies without legacy knowledge have no publication;
- Workspace isolation remains intact;
- `PRAGMA foreign_key_check` returns zero rows;
- existing Company deletion cascades the complete new graph;
- schema migration checksum and unknown-migration protections remain effective.

Production deployment requires a verified SQLite backup, restore rehearsal, migration against a production-shaped copy, integrity check, and documented restore rollback. Applied migrations are not reversed in place.

## 11. Frozen Testing

### 11.1 Domain and compiler

- Source invariants, name normalization/uniqueness, immutable kind/origin, archive rules, source CAS, revision lifecycle, abandoned recovery, and terminal immutability.
- Table-driven compiler tests for every normalization step, deterministic ordering, exact duplicates, empty fields, hours conflicts, FAQ conflicts, Company identity authority, one-revision-per-source, archived source rejection, every boundary limit, canonical JSON, compiler version, and digest.
- Permutations of the same manifest must produce byte-identical JSON and digest.

### 11.2 Repository and migration

- Workspace-scoped source/revision/version/current reads and writes; every cross-Workspace ID combination returns not found.
- Unique names, revision allocation, one pending attempt, terminal CAS, source CAS, publication CAS, idempotency, concurrent version allocation, rollback on every injected failure, JSON corruption handling, and busy mapping.
- Separate SQLite connections exercise real write contention.
- Migration-8 fixtures include multiple Workspaces, Companies with/without knowledge, Unicode, empty fields, and maximum legacy values.
- Company deletion cascade and actor-without-user-FK behavior are mandatory regression tests.

### 11.3 Provider contracts and security

- URL adapter contract tests cover schemes, credentials, fragments, ports, special-use literal IPs, public/private mixed DNS answers, DNS rebinding simulation, every redirect hop, downgrade, redirect count, media type, size, timeout, abort, and exactly-one-page behavior.
- PDF worker tests cover signature position, wrong MIME, truncation, malformed cross-reference data, encryption, embedded JavaScript/attachments/references, scanned/empty text, page/byte/text boundaries, worker crash, forced termination, and no external fetch.
- Extraction fake tests cover timeout, provider failure, invalid JSON/schema, prompt injection content, maximums, and absence of authority/provider leakage.

### 11.4 Service and HTTP

- Provider I/O occurs outside transactions.
- Failed/recovered/late ingestion cannot change another revision or current publication.
- Ready unpublished content never changes Preview, Chat, or provider input.
- Failed refresh preserves current publication and ready Company status.
- Real authenticated route tests cover Owner, Administrator, Operator, Viewer, Session, CSRF, exact Origin, Fetch Metadata, generic `404`, stable errors, raw PDF parser order, no-store headers, and non-replay of POST after bootstrap.
- Legacy onboarding publishes through the same compiler; `/knowledge` and `/chat` read only current publication; `/scrape` never persists.
- ADR-013 request remains frozen/minimal and Preview never uses the FAQ shortcut.

### 11.5 Frontend and performance

- Server capability DTO typing and UI affordances for all roles.
- Reducer/context tests for Workspace/Company/logout switches, abort, stale success/failure, publication conflicts, selection reset, no mutation replay, and sensitive-memory clearing.
- Accessible/localized component coverage for all source types, statuses, limits, conflicts, and publication review.
- Performance gates on target development hardware: 10 MiB/100-page PDF worker terminates or completes within 15 seconds; URL acquisition respects 30 seconds; extraction respects 45 seconds; full ingestion never reports success after 60 seconds; compiled 128 KiB snapshot loads and validates within 100 ms from local SQLite.
- Full EPIC 004–011 regression suite, backend typecheck/tests, frontend typecheck/tests/build, and migration rehearsal must pass.

## 12. Frozen Decisions

1. Knowledge is Company-owned; Workspace is the tenant boundary.
2. Assistant Profiles, channels, providers, models, prompts, sessions, and users do not own Knowledge.
3. Source identity is mutable only in bounded metadata; terminal revisions and published versions are immutable.
4. Source kinds are exactly Manual Text, Public URL, and PDF. Migration uses Manual Text plus internal legacy origin.
5. Ingestion is synchronous, two-transaction, CAS-completed, and has no worker queue or automatic resume.
6. Ingestion never publishes. Legacy onboarding is an explicit combined compatibility command using the same publish path.
7. Versions are created only during publication; no persistent candidate or draft-version model exists.
8. `company_knowledge_publications` is the single current-publication authority.
9. No `companies` publication pointer, circular foreign key, or publication event table exists.
10. Historical published versions are retained until Company deletion.
11. Publication selects 1–25 exact ready revisions, at most one per active source.
12. Compilation is a pure deterministic function; AI never merges sources or resolves conflicts.
13. Company identity fields always come from Company. Sources contribute only business facts and FAQs.
14. Distinct non-empty hours and differing answers to the same normalized FAQ question block publication.
15. Different manifests are different version identities even when compiled facts match.
16. Runtime retrieval loads only the bounded current structured snapshot; no vector/RAG infrastructure exists.
17. URL acquisition must enforce actual-fetch network, redirect, type, size, and time rules. Firecrawl is conditional on satisfying that frozen port, with built-in Node HTTP(S) adapter as the required fallback.
18. PDF uses raw binary HTTP transport, `pdfjs-dist`, a forcibly terminated worker thread, fixed limits, no OCR, and no raw-byte retention.
19. `WorkspaceContext` and `ActorContext` remain separate trusted server values.
20. Knowledge capabilities are derived server-side and returned to the frontend; Owner/Administrator publish/archive, Operator ingests, Viewer reads.
21. Ready normalized text is retained until Company deletion; failed content and raw acquired/uploaded bytes are discarded.
22. Company deletion cascades the complete Company-owned Knowledge graph.
23. Legacy data is backfilled exactly and the renamed legacy table becomes runtime-inert; dual writes are forbidden.
24. Company `ready` means a current publication exists; later failed ingestion does not downgrade a ready Company.
25. All management responses are private/no-store, all mutations retain current CSRF/Origin protection, and unauthorized scope remains indistinguishable `404`.
26. The numeric security, retrieval, and timing limits in this document are implementation requirements, not configuration questions for EPIC 012.

## 13. Non Goals

- Vector databases, embeddings, semantic search, chunk retrieval, reranking, or hybrid RAG.
- Multiple-page crawling, sitemaps, scheduled refresh, URL monitoring, or remote change detection.
- OCR, scanned/image-only PDF support, layout/table reconstruction, Office documents, or multipart upload.
- Raw PDF/blob storage, external object storage, or per-source destructive deletion.
- Background queues, durable workers, leases, websockets, or asynchronous job polling.
- AI-based cross-source merge, source precedence, silent conflict resolution, or user-authored system prompts.
- Assistant-specific, Profile-specific, channel-specific, session-specific, or shared cross-Company Knowledge.
- Persistent draft Knowledge Versions, unpublish, rollback UI, approval workflows, rich-text collaboration, or field-level overrides.
- Conversations, memory, capabilities/tools, WhatsApp, billing, PostgreSQL, hosting, or deployment redesign.
- New paid infrastructure or mandatory vendor coupling.

## 14. Implementation Readiness

All mandatory Architecture Review items are resolved:

- single non-circular current-publication model: resolved;
- deterministic compilation and conflict rules: resolved;
- concrete retrieval/input/timing limits: resolved;
- enforceable URL provider contract and fallback: resolved;
- PDF transport, parser, isolation, and retention: resolved;
- separate `WorkspaceContext` and `ActorContext`: resolved;
- retention, export, Company deletion, and actor attribution: resolved;
- synchronous lifecycle, abandoned attempts, and late completion: resolved;
- server-derived capabilities and role mapping: resolved;
- legacy representation, backfill, runtime cutover, and no dual write: resolved;
- final API, frontend, persistence, retrieval, testing, and lifecycle: resolved.

There are no unresolved architecture issues within EPIC 012 scope. Implementation may begin only against this contract and the accepted ADRs. If implementation evidence shows the frozen URL contract, PDF containment, migration equality, synchronous hosting budget, or bounded whole-snapshot retrieval cannot be satisfied, work must stop and return to Architecture Review; it must not silently weaken the contract.

**ARCHITECTURE FROZEN --- APPROVED FOR IMPLEMENTATION**
