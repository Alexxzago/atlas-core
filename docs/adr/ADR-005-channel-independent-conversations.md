# ADR-005: Channel-Independent Conversations

**Status:** Accepted — Not Yet Implemented  
**Date:** 2026-07-14

## Context

Atlas is intended to support web, WhatsApp, Instagram, Messenger, API, voice, and future channels. Conversation continuity, handoff, and history should not be defined by any channel provider.

## Decision

Conversation is a company-owned domain concept inside a workspace. Channel adapters translate external messages and identifiers into channel-neutral conversation operations. A conversation may reference its originating channel connection, but channel providers do not own conversation history, AI policy, or knowledge.

Conversation tags are optional metadata, not a separate aggregate. Human handoff and analytics consume conversation state without redefining ownership.

## Alternatives considered

- Provider-owned conversation records: rejected because history and policy would fragment by channel.
- One conversation model per channel: rejected because it duplicates core behavior.
- Event sourcing for conversation history: postponed because no present requirement justifies it.

## Consequences

Future channel integrations share application behavior and tenant isolation. Provider-specific metadata remains at the adapter boundary.

## Tradeoffs

A neutral model must accommodate different delivery and identity semantics without pretending they are identical.

## Compatibility implications

Current test chat is not reclassified as persisted conversation history. Future introduction must preserve existing chat contracts where sensible.

## Conditions for revisiting

Revisit if a channel has regulatory or interaction semantics that cannot safely fit the shared lifecycle without a bounded specialization.
