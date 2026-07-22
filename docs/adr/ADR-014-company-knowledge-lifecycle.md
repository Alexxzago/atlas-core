# ADR-014: Company Knowledge Lifecycle

**Status:** Accepted  
**Date:** 2026-07-22

## Context

ADR-004 established that Company Knowledge is Company-owned, workspace-scoped, provider-neutral, and shared by all channels. Its approved future direction of immutable versions with one published reference needed a concrete lifecycle before knowledge could be safely ingested from manual text, public URLs, and PDFs. EPIC 012 implements that lifecycle while preserving the trusted tenant boundary, channel independence, and the provider-neutral Assistant Execution Contract.

## Decision

Knowledge is a Company-owned aggregate graph whose Workspace authority is derived only through the Company in trusted `WorkspaceContext`; Knowledge records do not duplicate workspace ownership. `ActorContext` remains a separate server-created value for audit attribution and capabilities. No client resource identifier, actor value, or source identifier establishes tenant authority.

A mutable `KnowledgeSource` has immutable terminal ingestion revisions. A ready revision is not runtime authority. It can be included in an explicit publication, together with one ready revision per active source, to create an immutable Company Knowledge Version. There is no persistent draft-version or candidate aggregate: ready but unpublished revisions are the draft-like state. Revisions and versions are never edited; corrections require a new revision and publication.

`company_knowledge_publications` contains at most one row per Company and is the sole current-publication authority. There is no Company publication pointer or publication-event aggregate. Publication compiles 1 through 25 exact ready revisions with a pure deterministic algorithm, validates bounded output, and atomically creates and compare-and-swaps the current version. Compilation derives Company identity from the Company record, canonicalizes and deduplicates arrays, and rejects conflicting hours or FAQ answers. AI extracts candidate facts but cannot merge sources, select a tenant, resolve conflicts, or publish.

Chat and Assistant Preview consume only the bounded structured snapshot selected by the current-publication row. Preview passes it explicitly through ADR-013's immutable execution contract. Sources, revisions, normalized text, provenance, and unpublished content do not enter assistant execution. Channels and Assistant Profiles neither own nor copy Knowledge.

Manual text, public URLs, and PDFs are untrusted inputs. URL acquisition and PDF extraction are replaceable ports. URL acquisition fails closed unless the actual fetch enforces public HTTP(S)-only destinations, per-hop redirect and DNS/IP validation, no HTTPS downgrade, textual media types, response bounds, deadline, and one-page scope. PDF ingestion uses bounded raw `application/pdf` transport; forbidden encryption, JavaScript, attachment, URI, and open-action constructs are rejected before worker/parser execution. Parsing is isolated in a bounded worker, OCR and raw-PDF retention are excluded, and failed content is discarded.

All Knowledge management routes are authenticated nested Workspace/Company routes. Server-derived capabilities authorize each operation before protected resource discovery or mutation; raw PDF parsing occurs only after authorization. Owner and Administrator may publish and archive, Operator may ingest, and Viewer may read. Mutations retain Session, Origin, Fetch Metadata, CSRF, private/no-store, and generic-not-found protections.

Legacy knowledge is backfilled into the immutable model and runtime reads use the published reader only. Legacy onboarding is an explicit combined ingest-and-publish compatibility use case through the same lifecycle. The prior mutable table is runtime-inert, and dual writes are forbidden.

## Alternatives considered

- Keep one mutable Company Knowledge snapshot: rejected because failed refreshes, concurrent updates, and unpublished material could alter runtime facts.
- Treat ready revisions as executable drafts: rejected because ingestion success is not approval.
- Store a publication pointer on `companies` or a separate publication-event aggregate: rejected because one current-publication row is the non-circular authority.
- Let AI merge sources or select conflicting facts: rejected because factual authority must be deterministic and reviewable.
- Permit remote URL acquisition without enforceable actual-fetch controls: rejected because initial URL validation alone does not prevent SSRF.
- Parse PDFs in the request process or retain raw PDF bytes: rejected because resource containment and data retention require a bounded isolated parser and transient bytes.
- Create channel-, Profile-, or provider-specific Knowledge copies: rejected because they would fragment Company facts.

## Consequences

Knowledge publication is deliberate, auditable, deterministic, and concurrency-protected. A failed or abandoned ingestion attempt cannot replace the current publication, and a concurrent publication or source mutation returns a controlled conflict rather than losing updates. Company deletion cascades the complete Company-owned Knowledge graph; raw PDF bytes and failed source content are not retained.

The bounded whole-snapshot reader remains the common factual source for Chat, Preview, and future channels. Vector retrieval, embeddings, crawling, OCR, queues, assistant-specific knowledge, and additional knowledge providers are not introduced by this decision.

The accepted Windows backend test command runs the complete Node test suite serially with `--test-concurrency=1`. This operational constraint avoids an intermittent native PDF test-file access violation under parallel test-file execution without omitting tests or reducing assertions.

## Tradeoffs

Immutable history, explicit review, deterministic conflict blocking, and short transactional compare-and-swap writes add lifecycle and operational complexity. Bounded whole-snapshot retrieval constrains publication size. Rejecting unsafe URLs and PDFs, and not retaining raw files, limits accepted content and reprocessing options in favor of isolation and predictable behavior.

## Compatibility implications

ADR-002, ADR-003, ADR-004, ADR-005, ADR-008, ADR-010, and ADR-013 remain authoritative. This ADR concretizes ADR-004's versioned published-knowledge direction without changing Company ownership, Workspace tenancy, provider neutrality, channel independence, or the Assistant Execution Contract. Existing knowledge is migrated to equivalent published snapshots; legacy onboarding preserves its compatibility purpose while using the single lifecycle writer.

## Conditions for revisiting

Revisit only when validated requirements cannot be represented by bounded Company-owned published snapshots, require governed cross-Company sharing, require retention or reprocessing of original files, or demonstrate that a different retrieval strategy is necessary. Any change must preserve explicit tenant authority, deterministic publication, and the single published runtime source.
