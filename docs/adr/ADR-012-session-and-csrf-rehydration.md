# ADR-012: Session and CSRF Rehydration

**Status:** Accepted
**Date:** 2026-07-17

## Context

Atlas stores its opaque Session identifier in an HttpOnly cookie and keeps the raw CSRF token only in frontend memory. Reloading the Portal therefore preserves server-side authentication but loses both frontend identity and the token required for mutations. The existing `POST /identity/session/refresh` cannot recover this state because it requires the previous CSRF token and rotates the full Session.

## Decision

Atlas exposes `POST /identity/session/bootstrap`. It requires a current Session cookie, an exact allowed Origin and a request that is not cross-site or same-site cross-origin. It requires no previous CSRF token and returns identity, a new in-memory CSRF token and `csrfGeneration`; it returns no tenant authority.

Bootstrap preserves the Session identifier and absolute expiration. Within the authentication transaction it validates Session state and expiry, active User, active Credential and credential version, extends idle expiry up to the absolute limit, and rotates the CSRF digest using compare-and-swap on `csrf_generation`.

Production requires an HTTPS Origin whose scheme, host and port exactly match the effective request authority and an explicit allowlist. `same-origin` is accepted; `same-site` and `cross-site` are rejected. Missing Fetch Metadata or `none` is accepted only when Origin and effective authority are exact. Untrusted forwarded-host headers are ignored. Responses are `no-store, private`.

The frontend starts in `booting`, waits for a visible document, and performs a StrictMode-safe single-flight bootstrap. Same-origin tabs broadcast the raw in-memory CSRF token with its increasing generation, plus logout and invalidation events. Stale generations are ignored and nothing is persisted in browser storage.

After an operational `401`, GET/HEAD may be retried once after successful bootstrap. POST/PATCH/DELETE are never retried automatically because their outcome can be uncertain. Logout invalidates the frontend epoch so a late bootstrap cannot restore authentication.

Authentication restoration is separate from tenant navigation. Bootstrap never restores or selects Workspace, Membership, Company or Assistant Profile.

## Alternatives

- Reusing refresh was rejected because the lost token is mandatory and Session rotation creates multi-tab races.
- Returning CSRF from `GET /identity/me` was rejected because it hides security-state mutation behind a read contract.
- Double-submit cookies and browser storage were rejected because CSRF remains ephemeral and synchronized with server state.
- Silent login was rejected because no independent silent credential exists.

## Consequences

The `sessions` table gains an additive positive `csrf_generation`. No dependency, previous-token grace window, per-tab Session or persistent browser token is introduced.

The design is portable to persistent SQLite-compatible, PostgreSQL and event-driven adapters. Correctness does not depend on process memory, sticky sessions, local files, BroadcastChannel or a permanently alive server.

CSRF does not mitigate XSS or theft of the Session cookie. Those attacks require separate controls such as HTTPS, CSP, output safety and endpoint hardening.
