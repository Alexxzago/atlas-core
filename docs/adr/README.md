# Atlas Architecture Decision Records

Architecture Decision Records (ADRs) capture consequential Atlas architecture decisions, their rationale, and their operational boundaries. They complement the architecture documents; they do not replace them.

## Naming convention

Files use `ADR-NNN-short-title.md`. Numbers are assigned sequentially and are never reused.

## Status meanings

- **Proposed:** under review and not authoritative.
- **Accepted:** approved and at least materially implemented.
- **Accepted — Not Yet Implemented:** approved direction with implementation intentionally pending.
- **Superseded:** replaced by a later ADR.
- **Rejected:** considered but not adopted.

## Immutability and supersession

Accepted ADRs are immutable except for spelling, formatting, or link corrections that do not alter meaning. A changed decision requires a new ADR. The new ADR must identify the record it supersedes, and the old record must receive only a status update and a link to its replacement.

## Index

- [ADR-000: Architecture Baseline](ADR-000-architecture-baseline.md)
- [ADR-001: Modular Monolith](ADR-001-modular-monolith.md)
- [ADR-002: Workspace as Tenant Boundary](ADR-002-workspace-as-tenant-boundary.md)
- [ADR-003: Provider-Neutral AI Capabilities](ADR-003-provider-neutral-ai-capabilities.md)
- [ADR-004: Company-Owned Knowledge](ADR-004-company-owned-knowledge.md)
- [ADR-005: Channel-Independent Conversations](ADR-005-channel-independent-conversations.md)
- [ADR-006: Assistant Capabilities and Tools](ADR-006-assistant-capabilities-and-tools.md)
- [ADR-007: Workspace Secret Store](ADR-007-workspace-secret-store.md)
- [ADR-008: Explicit Trusted Tenant Context](ADR-008-explicit-trusted-tenant-context.md)
- [ADR-009: Portal Locale and Assistant Language](ADR-009-portal-locale-and-assistant-language.md)
- [ADR-010: Company-Owned Assistant Profiles](ADR-010-company-owned-assistant-profiles.md)
- [ADR-011: Zero-Cost Bootstrap Infrastructure Strategy](ADR-011-zero-cost-bootstrap-infrastructure-strategy.md)
