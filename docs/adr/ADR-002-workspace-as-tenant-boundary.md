# ADR-002: Workspace as Tenant Boundary

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Commercial Atlas must support multiple customers while preventing data leakage. A company is a business managed inside an administrative customer boundary; it is not itself the durable boundary for membership, policy, secrets, or billing relationships.

## Decision

Workspace is the tenant and administrative isolation boundary. Companies and all company-owned data belong to exactly one workspace. Cross-workspace access must behave as not found and must not disclose resource existence.

The workspace foundation and default-workspace scoping are implemented. Multiple workspace administration, membership, and workspace selection are not yet implemented.

Moving a company between workspaces is not a routine update. It requires a future explicit administrative transfer that validates ownership of all dependent data and preserves auditability.

## Alternatives considered

- Company as tenant: rejected because it cannot naturally represent agencies or groups managing multiple companies.
- User as tenant: rejected because data ownership must outlive individual users.
- Global resources filtered only by convention: rejected because isolation must be structurally enforced.

## Consequences

Company-owned records require workspace-scoped access. Future memberships, policies, secrets, and subscriptions attach to the workspace boundary as appropriate.

## Tradeoffs

The additional ownership key and trusted context increase API discipline but provide a stable SaaS boundary.

## Compatibility implications

Legacy records are assigned to the default workspace without changing public HTTP contracts. Clients do not provide workspace authority.

## Conditions for revisiting

Revisit if enterprise legal isolation requires a boundary above workspace, or a validated business model requires a different durable administrative owner.
