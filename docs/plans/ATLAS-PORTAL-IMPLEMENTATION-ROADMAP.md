# Atlas Portal Implementation Roadmap

## Guardrails

All phases implement the EPIC-021 experience foundation without changing backend domain behavior. Preserve server-derived capabilities, tenant concealment, CSRF flow, typed API validation, abort/stale-response protections, and English/Spanish localization.

## Phase 1: Foundation

- Normalize the existing token file into the documented semantic taxonomy.
- Establish base typography, focus, responsive shell, card/section, button, field, notice, and status patterns.
- Add reduced-motion behavior and verify keyboard navigation, 200% zoom, mobile layouts, and locale expansion.

Exit: the portal has no competing visual primitives or raw values for repeated UI decisions.

## Phase 2: Contextual Shell

- Make Workspace and Company context persistently understandable in the authenticated shell.
- Implement the minimal internal router and frozen authenticated route model without client-side authorization decisions.
- Standardize loading, empty, unavailable, and error states around the context hierarchy.

Exit: users can identify current scope and recover from context changes without stale content or hidden controls.

## Phase 3: Company Workflow

- Apply the system to Company creation, Knowledge publication, Assistant Profiles, preview/operational execution, and Web Chat configuration.
- Make prerequisites actionable and keep one primary action per surface.
- Verify localized strings and accessible async feedback for every state.

Exit: the core company setup path is coherent from company creation through executable assistant configuration.

## Phase 4: Channel Operations

- Apply the channel checklist/status pattern to WhatsApp configuration, credential validation, activation, health, conversations, and delivery state.
- Clearly separate implemented Atlas state from real Meta production-validation evidence.

Exit: operators can distinguish configured, validated, active, degraded, and production-validated states without credential disclosure.

## Phase 5: Quality Gate

- Run frontend typecheck, tests, production build, and dependency audit.
- Review keyboard-only paths, focus transitions, status announcements, reduced motion, English/Spanish copy, desktop/mobile layouts, and no-sensitive-data displays.
- Confirm no routing dependency, backend contract, or architectural boundary changed incidentally.
- Router tests use deterministic `popstate` dispatch because jsdom does not reliably execute asynchronous native history traversal. Native browser back/forward remains a manual release check.

## Sequencing Rule

Do not begin visual redesign of a future capability before its information architecture and state contract are known. Reopen architecture review before adding routes outside the frozen route model, persistent UI preferences beyond locale, dark mode, RTL delivery, or a shared package.
