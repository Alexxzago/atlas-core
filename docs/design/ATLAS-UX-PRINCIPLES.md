# Atlas UX Principles

## 1. Context Before Action

Show the active Workspace and Company before scoped configuration or mutation. Clear dependent selections and stale results when context changes.

## 2. Readiness Is Explicit

Represent lifecycle state with a text label, not color alone. Explain the missing prerequisite and provide the next permitted action. Server state remains authoritative.

## 3. Safe By Default

Do not expose credentials, raw provider payloads, hidden resources, or internal IDs as explanatory UI. Preserve generic not-found behavior for unauthorized scope.

## 4. One Clear Primary Task

Each surface has one primary action. Secondary/destructive actions are visually subordinate and require appropriately clear confirmation where consequences are irreversible.

## 5. Progressive Disclosure

Start with the decision and current state; reveal implementation detail only when it helps complete the task. Do not make operators parse technical jargon to understand a recoverable failure.

## 6. Honest Asynchrony

Show submitted, loading, success, failure, and unavailable states. Prevent duplicate submission while a mutation is pending. Browser abort suppresses stale presentation only; it does not mean server work stopped.

## 7. Familiar, Accessible Controls

Use native semantic controls where possible. Every interaction works with keyboard, has a visible focus indicator, and does not depend on color, hover, drag, or motion alone.

## 8. Localize Meaning, Not Just Words

All interface copy uses typed translation keys. Format dates and numbers with the active locale. Leave opaque IDs and customer/provider data unchanged unless a defined formatter applies.
