# ADR-010: Company-Owned Assistant Profiles

**Status:** Accepted  
**Date:** 2026-07-16  
**Partially supersedes:** [ADR-006](ADR-006-assistant-capabilities-and-tools.md) only for MVP assistant-profile cardinality and persistence

## Context

Atlas Beta 1 must represent distinct assistant configurations for the same company without making an AI provider, prompt, channel, or user the owner. ADR-006 postponed persistent assistant entities and assumed at most one conceptual profile per company during the MVP. The revised scope requires multiple durable profiles while preserving accepted tenant, knowledge, provider, and capability boundaries.

## Decision

Workspace remains the tenant and security boundary. Company remains the business owner. `AssistantProfile` is a Company-owned aggregate root with its own stable identity, lifecycle, repository, and mutable structured configuration.

```text
Workspace 1 -- 0..* Company
Company   1 -- 0..* AssistantProfile
```

A Company may have zero or multiple persistent profiles. `assistant_profiles` does not duplicate `workspaceId`; tenant ownership is derived and enforced through Company. Profile names are deterministically normalized and unique inside one Company.

Profiles use the explicit lifecycle `draft`, `ready`, `disabled`, and `archived`. They are mutable and have no default or automatic selection. Any future consumer must select a profile explicitly.

Beta 1 does not introduce immutable revisions, versioned publication, free-form prompts, `systemInstructions`, provider or model configuration, or secrets. Preview is outside EPIC 009. Channels, Conversations, Memory, Capabilities, and Tools also remain outside this implementation.

This ADR partially supersedes ADR-006 only where ADR-006 limited the MVP to one conceptual profile and postponed persistent Assistant Profiles. ADR-006 remains authoritative for Capabilities, Tools, execution authorization, provider neutrality, and separation between business policy and infrastructure.

## Alternatives considered

- One profile per Company: rejected because it no longer satisfies the approved Beta 1 cardinality.
- Profile owned directly by Workspace: rejected because Company owns its assistant configuration and knowledge.
- Persisting both Company and Workspace ownership: rejected because it creates two ownership sources that can diverge.
- Immutable revisions and publication now: postponed because no implemented Channel or Conversation requires published snapshots.
- Default profile: rejected because no current consumer requires implicit routing.

## Consequences

Profile operations must be tenant-scoped through trusted `WorkspaceContext` and Company ownership. Multiple profiles can evolve independently without changing Company, Knowledge, or provider contracts. A later consumer can select a profile explicitly without redesigning ownership.

## Tradeoffs

Mutable ready profiles can change between future uses. This is acceptable before Channels and publication exist. Deriving Workspace through Company requires tenant-scoped joins but prevents duplicated authority.

## Compatibility implications

Existing Company, Knowledge, Onboarding, Chat, Identity, Workspace, and frontend behavior remain unchanged. No existing data requires profile bootstrap.

## Conditions for revisiting

Revisit when implemented Channels require published snapshots, governed profile sharing across Companies is validated, or a current consumer demonstrates a need for default-routing policy.
