# ADR-013: Provider-Neutral Assistant Execution Contract

**Status:** Accepted  
**Date:** 2026-07-18

## Context

Atlas persists Company-owned Assistant Profiles as structured business configuration. EPIC 011 introduces the first operational consumer of a Profile through authenticated Preview. Passing aggregates or prompts across the application/provider boundary would couple business behavior to persistence or an AI vendor.

## Decision

The application owns an immutable, request-scoped Assistant Execution Contract. It contains only approved runtime behavior, current Company Knowledge, interaction input and an explicit execution purpose. It contains no prompt, provider, model, credential, Workspace authority or generic configuration.

Only ready Profiles are executable. Selection is explicit, and Company ownership is resolved inside trusted `WorkspaceContext`. Preview uses the dedicated derived `assistant:preview` permission and creates no durable state.

Provider adapters exclusively translate the contract into provider prompts or native requests. They receive Knowledge explicitly and cannot load repositories, select tenants, authorize users or grant capabilities. Profile configuration and interaction input cannot override Atlas grounding rules.

Preview always traverses this contract and the provider adapter. The exact FAQ optimization remains limited to legacy Company-aware Chat so Preview consistently exercises Profile behavior. No default Profile or routing policy is introduced.

## Alternatives considered

- Persist prompts on Assistant Profiles: rejected because Profiles are provider-neutral business configuration.
- Build prompts in application services: rejected because provider translation belongs to replaceable adapters.
- Pass the complete Profile aggregate: rejected because persistence shape must not define runtime behavior.
- Reuse `chat:use`: rejected because operational Chat and administrative Preview require independently scalable authorization semantics.
- Persist Preview as Messages: rejected because Preview is not a Conversation.

## Consequences

Application and provider boundaries remain testable with fakes. Internal identifiers and administrative Profile fields do not automatically reach providers. Preview is ephemeral and non-published. Existing Chat remains compatible without creating or selecting an implicit Profile.

## Compatibility implications

ADR-003 provider neutrality, ADR-004 Company-owned Knowledge and ADR-010 Company-owned Assistant Profiles remain authoritative. This decision complements and does not supersede them. Existing migrations and persistence are unchanged.

## Conditions for revisiting

Revisit only if a validated execution capability cannot be represented safely by structured application data without leaking provider concepts into the domain.
