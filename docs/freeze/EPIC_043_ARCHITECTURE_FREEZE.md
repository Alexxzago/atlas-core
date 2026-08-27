# EPIC 043 - Realtime Operator Handoff V2 Architecture Freeze

**Status:** Frozen  
**Authority:** Implementation contract for EPIC 043

## Scope

EPIC 043 provides an authenticated, company-scoped operator inbox for conversations. It adds no new channel, provider, role, permission, or workspace-authority model.

## Authority and persistence

- Conversation control is authoritative only in `conversation_controls` and is changed through the atomic control-operation repository method.
- A control mutation requires a durable operation ID. Replays return the original outcome without appending another control event.
- `conversation_events` is append-only and ordered by its durable `sequence`; it is the sole incremental-feed source.
- Inbound WhatsApp capture records exactly one `inbound_message_received` event for its durable conversation message in the same transaction. Operator and assistant message persistence likewise append their feed events transactionally.
- Feed readers are tenant and company scoped in the repository. A cursor is base64url-encoded internal state and is validated against the trusted workspace and requested company; invalid, foreign, or stale cursors require resynchronization rather than exposing data.

## HTTP and client behavior

- Conversation reads and the event feed require `company:read`; control commands require `conversation:manage`; operator messages require `conversation:message:send` and current-controller authority.
- Read DTOs mask actor identity and never expose provider identifiers, customer identifiers, credentials, raw event sequence, or message content through the feed.
- The inbox bootstraps from the current feed tail before loading the authoritative list, then polls incrementally. It pauses while hidden, aborts obsolete scope requests, drains bounded pages, backs off transient failures, and resumes after an aborted request settles.

## Boundaries

- Controllers translate HTTP only; services own validation and control policy; repositories are the only SQLite boundary.
- Providers communicate with external systems only. EPIC 043 does not create a second conversation-control authority or a parallel persistence path.
