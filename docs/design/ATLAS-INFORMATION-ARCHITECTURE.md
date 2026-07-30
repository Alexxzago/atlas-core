# Atlas Information Architecture

## Context Hierarchy

```text
Account
  Workspace (authorization boundary)
    Company (operational owner)
      Knowledge
      Assistant Profiles
      Channels: Web Chat, WhatsApp
      Conversations and operational history
```

The portal must never flatten this hierarchy into an ambiguous global list. Workspace selection determines the authorized company set; Company selection determines all operational configuration and reads.

## Approved Route Model

```text
/dashboard
/companies
/companies/:companyId
/companies/:companyId/assistant
/companies/:companyId/knowledge
/companies/:companyId/channels
/companies/:companyId/channels/whatsapp
/conversations
/analytics
/settings
/chat/:publicConnectionId
```

The top-level authenticated destinations are Dashboard, Companies, Conversations, Analytics, and Settings. Assistant and Channels are Company context, never top-level navigation. Route parameters establish presentation context only; the backend resolves authorization through the active authenticated Workspace.

## Shell

The authenticated shell contains:

- Sidebar: primary top-level navigation on desktop.
- Top bar: account actions plus Workspace and Company switchers.
- Company sub-navigation: Overview, Assistant, Knowledge, Channels, and WhatsApp.
- Main work area: page header, route loading/error boundary, and one routed feature surface.

Desktop may keep contextual navigation visible. Mobile uses an explicit, keyboard-accessible selector or disclosure and keeps the current context visible after it closes.

## Company Task Order

1. Companies: choose or create the operational owner.
2. Knowledge: ingest, review, and publish the factual source of truth.
3. Assistant Profiles: configure and make a profile ready.
4. Test/execute: use the appropriate authorized assistant operation.
5. Channels: create/configure/activate Web Chat or WhatsApp when prerequisites are met.
6. Operations: inspect conversation and delivery state as capabilities become available.

This order expresses dependency without blocking legitimate revisits. Each section names its current state and links to the next relevant task rather than hiding unavailable capabilities.

## Public Surface

Public Web Chat remains a narrow, connection-specific page at `/chat/wcp_<id>`. It is intentionally separate from the authenticated portal shell and must not expose administrative navigation, account state, or tenant discovery affordances.

## Router Decision

Atlas uses an internal router, not a dependency. Typed route parsing and path construction are sufficient for the frozen finite route model, browser history, deep links, nested Company routes, route guards implemented through existing scoped API reads, and unit tests. A routing dependency is reconsidered only if route data loading, nested route composition, or public/private route policy outgrows this bounded implementation.
