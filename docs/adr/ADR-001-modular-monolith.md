# ADR-001: Modular Monolith

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Atlas needs multiple business domains but does not yet have scale, team structure, or deployment constraints that justify distributed services. Operational simplicity is a business requirement.

## Decision

Atlas remains a modular monolith. Domain and application boundaries must be explicit inside one deployable backend, with infrastructure accessed through ports or bounded adapters. Modules may evolve independently in code without becoming network services.

## Alternatives considered

- Microservices: rejected because they add distributed failure, deployment, observability, and consistency costs without demonstrated need.
- A single unstructured application module: rejected because it weakens ownership and testability.
- Separate deployments per provider or channel: postponed until independent operational scaling is proven necessary.

## Consequences

Cross-domain work initially uses in-process application contracts and shared transactional infrastructure where appropriate. Module ownership must remain clear to prevent a tightly coupled monolith.

## Tradeoffs

One deployment reduces operational cost but limits independent scaling and requires discipline around internal boundaries.

## Compatibility implications

The current backend deployment and local development model remain unchanged. New domains can be introduced without new infrastructure.

## Conditions for revisiting

Revisit only when measured load, regulatory isolation, reliability requirements, or independently operating teams cannot be addressed reasonably within the monolith.
