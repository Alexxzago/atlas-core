# ADR-004: Company-Owned Knowledge

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Atlas answers on behalf of businesses. Knowledge must remain stable across model providers and communication channels, and one company’s facts must never answer another company’s customer.

## Decision

Structured knowledge is owned by a company within its workspace. AI providers receive knowledge explicitly and do not load it. Runtime knowledge is read through workspace-scoped repository contracts, not static files or provider state.

Current SQLite knowledge persistence is implemented. Immutable knowledge versions with one published-version reference are approved future direction. Embeddings may later be optional retrieval infrastructure, not the source of truth.

## Alternatives considered

- Knowledge owned by a model or assistant session: rejected because it prevents portability and reliable isolation.
- Channel-specific knowledge copies: rejected because they drift.
- Mandatory vector storage: rejected because current structured knowledge does not require it.

## Consequences

All channels and assistants for a company use the same published factual source. Refresh failures must not present stale knowledge as newly refreshed.

## Tradeoffs

Company ownership is simple but future shared catalogs will require explicit references rather than implicit cross-company reuse.

## Compatibility implications

Existing company-aware chat and onboarding persistence remain valid. Versioning can be added incrementally while preserving the current published view.

## Conditions for revisiting

Revisit if a validated product requires governed knowledge shared across companies or workspaces while preserving explicit ownership and authorization.
