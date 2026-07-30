# EPIC-021 - Atlas Experience Foundation

**Status:** Planned and architecture frozen

**Architecture Freeze:** This document is the implementation contract for EPIC-021 experience work. Reopen architecture review before departing from a frozen decision.

## Objective

Establish the product-experience foundation for the Atlas portal without changing backend contracts or business rules. The outcome is a coherent, accessible, localized interface system that makes Workspace, Company, Knowledge, Assistant Profile, channel, and operational state understandable.

## Frozen Decisions

- Atlas remains a React/Vite single-page portal using the existing component/state/API boundaries. This epic does not alter backend routes, tenant authority, authorization, persistence, or provider behavior.
- Use a minimal internal router with `pushState`, `replaceState`, `popstate`, typed parsing/building, and React context. No routing dependency is installed. Authenticated routes support deep links, browser history, route loading/error boundaries, and nested Company context while backend APIs remain the only authorization authority.
- The authenticated shell has a persistent header, account controls, Workspace context, Company context, and one focused work area. On small screens, context controls must remain reachable without relying on hover or a permanently visible sidebar.
- Design tokens are the only source for shared color, spacing, typography, radius, elevation, focus, and motion values. Component CSS must consume semantic tokens rather than introduce raw visual values.
- English and Spanish are first-class supported locales. All user-visible copy, dates, statuses, errors, and empty states must be localized; business identifiers and provider values are not UI copy.
- Accessibility, reduced motion, keyboard operation, and responsive behavior are release criteria, not polish work.

## Scope

In scope: visual direction, token taxonomy, typed internal routing, shell, component scope, information architecture, localization, motion, accessibility, implementation sequence, and acceptance checks.

Out of scope: new product capability, backend/API change, router library, design-tool migration, generic component package, dark mode, RTL locale delivery, animation library, or redesign of public Web Chat behavior.

## Architecture Guardrails

The experience layer presents server-derived state and capabilities. It must not map roles to permissions, infer Company readiness, retain credentials, or make a hidden tenant resource distinguishable. Mutations continue through existing authenticated API methods with current CSRF and stale-request protections. Abort remains presentation cancellation, not a claim that server or provider work was cancelled.

## Deliverables

- `docs/design/ATLAS-PRODUCT-EXPERIENCE-VISION.md`
- `docs/design/ATLAS-UX-PRINCIPLES.md`
- `docs/design/ATLAS-VISUAL-DIRECTION.md`
- `docs/design/ATLAS-MOTION-AND-ACCESSIBILITY-STANDARDS.md`
- `docs/design/ATLAS-DESIGN-SYSTEM-SCOPE.md`
- `docs/design/ATLAS-INFORMATION-ARCHITECTURE.md`
- `docs/plans/ATLAS-PORTAL-IMPLEMENTATION-ROADMAP.md`

## Acceptance Criteria

1. Future portal work follows the frozen router, shell, token, component, localization, motion, and accessibility decisions.
2. Workspace and Company context are visible before any scoped action and remain clear at desktop and mobile widths.
3. Reusable UI uses semantic tokens and the documented component contracts.
4. Every new user-facing state has English and Spanish copy, keyboard access, focus behavior, and an appropriate live-region or error treatment.
5. WhatsApp UI communicates configured, validated, active, degraded, and unavailable states without representing real Meta production validation as complete.

## Verification

Documentation review must confirm alignment with `docs/ATLAS_PLATFORM_ARCHITECTURE.md`, `docs/releases/EPIC-020-CLOSEOUT.md`, and the current portal implementation. Implementation epics that consume this foundation must run their normal frontend typecheck, tests, build, and keyboard/reduced-motion checks.
