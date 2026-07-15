# ADR-007: Workspace Secret Store

**Status:** Accepted — Not Yet Implemented  
**Date:** 2026-07-14

## Context

Future channel connections, AI providers, and tools require credentials. Environment variables are sufficient for current instance-level integrations but cannot safely represent workspace-managed SaaS credentials.

## Decision

Secrets belong to the workspace administrative boundary. Operational records store opaque secret references, never raw credentials. Only infrastructure adapters resolve secret values during execution, and normal APIs never return those values.

The abstraction remains provider-neutral. Community deployments may use environment or local protected storage; cloud deployments may use a managed secret service; enterprise deployments may integrate customer-controlled secret infrastructure. Rotation, revocation, environment separation, and access auditing are required capabilities of future implementations.

Current environment-variable secrets remain in place until a migration path exists. Secret-management UI is intentionally postponed.

## Alternatives considered

- Raw credentials in company or connection tables: rejected because they spread exposure risk.
- One global credential set for all tenants: rejected for tenant-managed integrations.
- Mandating one secret vendor: rejected because deployment editions have different constraints.

## Consequences

Domain records can be inspected without exposing credentials. Logging and frontend serialization must treat secret values as prohibited data.

## Tradeoffs

Reference resolution adds infrastructure and failure modes, but centralizes credential controls.

## Compatibility implications

Existing environment configuration remains supported during incremental migration. No current API or database record is changed by this ADR.

## Conditions for revisiting

Revisit if deployment security requirements demand stronger ownership than workspace or if a selected storage strategy cannot support required audit and rotation guarantees.
