# ADR-000: Architecture Baseline

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Atlas v0.3.0-alpha has a working React portal and an Express/TypeScript backend. The backend separates routes, thin controllers, application services, repository ports, SQLite repositories, and external providers. It supports company management, targeted onboarding, persisted company knowledge, company-aware chat, migrations, and a trusted default-workspace context. Broader SaaS domains remain unimplemented.

## Decision

Treat the current layered modular monolith as the architecture baseline. Preserve inward business-rule ownership: routes expose transport, controllers translate HTTP, services enforce use cases, repository ports define persistence needs, repositories own SQLite access, and providers isolate external systems. Future domains must evolve incrementally from this baseline.

Current implementation is authoritative only for behavior that exists. Workspaces beyond the trusted default, users, conversations, channels, assistant capabilities, billing, and managed secrets remain approved or postponed direction rather than current capability.

## Alternatives considered

- Redesign before adding SaaS domains: rejected because the current boundaries are adequate for incremental evolution.
- Treat aspirational architecture as implemented: rejected because it obscures delivery and migration risk.
- Keep architecture implicit: rejected because future changes need a stable reference point.

## Consequences

Architecture changes must state whether they preserve, extend, or supersede this baseline. Existing contracts and data receive explicit compatibility treatment.

## Tradeoffs

The baseline retains some early-stage structures and a single trusted workspace selection while avoiding a speculative rewrite.

## Compatibility implications

Existing HTTP contracts, SQLite data, portal behavior, and provider integrations remain valid unless a later ADR explicitly changes them.

## Conditions for revisiting

Revisit if the documented layers no longer describe production behavior, or if a later accepted ADR deliberately replaces a foundational boundary.
