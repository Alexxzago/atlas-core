# ADR-003: Provider-Neutral AI Capabilities

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Atlas currently uses Gemini for generation and extraction, but business behavior must not depend on one model vendor. Future deployments may need OpenAI, Claude, local models, or different models per task.

## Decision

Application services depend on provider-neutral AI contracts and pass required company knowledge explicitly. Providers translate those contracts to external model APIs and own no business rules, repositories, or tenant selection.

The provider boundary and explicit knowledge passing are implemented. Model selection policies, multiple configured providers, fallback routing, and per-assistant model configuration are approved future direction and not yet implemented.

## Alternatives considered

- Direct vendor SDK use in services or agents: rejected because it couples business logic to a vendor.
- A universal lowest-common-denominator model API: rejected because it can hide meaningful capability differences.
- Multi-provider routing now: postponed because current product demand does not justify its complexity.

## Consequences

Provider replacement remains testable with fakes. Provider-specific features require explicit adapter capabilities rather than leakage into the domain.

## Tradeoffs

Neutral contracts require deliberate evolution and may not expose every vendor feature immediately.

## Compatibility implications

Gemini remains a valid adapter. Existing chat and onboarding contracts remain unchanged.

## Conditions for revisiting

Revisit if materially different model semantics cannot be represented without unsafe abstraction, or measured requirements justify provider-specific application capabilities.
