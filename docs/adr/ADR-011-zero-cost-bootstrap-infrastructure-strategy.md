# ADR-011: Zero-Cost Bootstrap Infrastructure Strategy

**Status:** Accepted  
**Date:** 2026-07-16

## Context

Atlas must acquire its first pilot customers before assuming recurring infrastructure costs. Beta 1 must be capable of public operation with an initial infrastructure cost of USD 0 without weakening tenant isolation, authentication, integrity, or recoverability.

## Decision

Atlas prioritizes genuine free plans and open-source software. Temporary free trials are not critical production dependencies, and promotional credits may complement testing but cannot be the sole production foundation.

The domain and application remain decoupled from hosting, AI, email, storage, observability, and channel vendors. External integrations use ports and replaceable adapters. No paid provider may be required to execute the initial Beta 1. Data must be exportable, configuration reproducible, and backups mandatory even when initially manual or implemented with free tooling.

Every future infrastructure choice must document:

1. the free option;
2. its limits;
3. suspension risk;
4. commercial-use terms;
5. backup strategy;
6. migration strategy;
7. future cost;
8. required architectural decoupling.

## Alternatives considered

- Rely on temporary trials: rejected because expiration would make the product non-operational.
- Bind the application directly to the cheapest current vendor: rejected because pricing and free-tier policies change.
- Defer backups until paid hosting: rejected because zero cost does not justify risking customer data.

## Consequences

Operational limits are acceptable during pilots, but tenant isolation, authentication, integrity, and backups are not negotiable. Concrete hosting and provider choices remain decisions for a deployment epic. The architecture can migrate to paid services without redesigning the domain.

## Tradeoffs

Free tiers can impose capacity, availability, support, and suspension constraints. Atlas accepts those constraints for initial pilots only when export, backup, and migration paths remain viable.

## Compatibility implications

This ADR is a transversal rule and introduces no hosting, deployment, email, AI, external storage, observability, dependency, or runtime change in EPIC 009.

## Conditions for revisiting

Revisit when verified customer load, reliability, regulatory, or support requirements cannot be met by the selected zero-cost operating model.
