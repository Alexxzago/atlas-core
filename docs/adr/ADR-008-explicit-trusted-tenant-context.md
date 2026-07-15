# ADR-008: Explicit Trusted Tenant Context

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Workspace isolation fails if callers can choose tenant authority through ordinary resource input. Atlas currently has no authentication or membership system but still needs an enforceable tenant boundary.

## Decision

Company-owned application and repository operations require an explicit trusted `WorkspaceContext` containing both workspace ID and workspace key. The context is established by trusted application composition and passed through controllers and services to repository ports.

No public parameter, body field, query value, or header establishes workspace authority. Cross-workspace access behaves as not found. Future authentication may resolve the same context from verified identity and membership, but does not change this invariant.

## Alternatives considered

- Accept workspace IDs from clients: rejected because identifiers are not authorization.
- Use process-global tenant state: rejected because concurrent requests could cross tenants.
- Add optional workspace filters in repositories: rejected because omission would permit unsafe access.

## Consequences

Tenant scope is visible in application contracts and mandatory in persistence operations. Tests can construct trusted contexts without adding authentication.

## Tradeoffs

Context propagation adds parameters throughout the call chain but makes authority explicit and testable.

## Compatibility implications

Current HTTP clients send no workspace identifiers and retain existing contracts. The default trusted context preserves single-workspace behavior.

## Conditions for revisiting

The resolution mechanism may change when authentication arrives. Revisit the context shape only if verified authorization requires additional immutable tenant claims; never permit client identifiers alone to establish authority.
