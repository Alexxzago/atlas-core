# Atlas Design System Scope

## Purpose

The Atlas design system is a lightweight portal foundation, not a separate package or generic UI framework. It standardizes repeated decisions while preserving existing React components and CSS ownership.

## Tokens

`frontend/src/design-system/foundations.css` defines semantic Atlas tokens; `frontend/src/styles/tokens.css` preserves compatibility aliases for existing feature surfaces. Maintain semantic tokens for:

- page, surface, text, border, action, focus, and lifecycle colors;
- typography, spacing scale, sizing, radii, borders, elevation, z-index, density, and responsive breakpoints;
- focus halo plus motion duration/easing.

New components consume semantic Atlas tokens such as `--atlas-color-action` and `--atlas-space-5`; legacy variables are compatibility aliases only. Components do not introduce literal colors, one-off spacing scales, or conflicting breakpoints. A new primitive token requires a demonstrated repeated need.

## Component Scope

The first reusable implementation set is:

- foundations: Stack, Inline, Cluster, Grid, Container, Divider, VisuallyHidden;
- feedback: Alert, StatusIndicator, Skeleton, EmptyState, ErrorState, ProgressIndicator;
- navigation: AppShell, Sidebar, MobileNavigation, WorkspaceSwitcher, CompanySwitcher, CompanySubnav, and PageHeader;
- future primitives: Button, IconButton, Link, Field and controls, data display, and overlays beyond the mobile drawer.

Components must define semantic HTML, supported states, loading/disabled behavior, focus treatment, localization ownership, and responsive behavior. They must accept data and callbacks, not make tenant, authorization, or provider decisions.

`Skeleton` requires a caller-supplied localized accessible label. It may not own user-facing loading copy, because the caller owns the loading context.

## Non-Goals

No third-party component library, CSS-in-JS migration, visual-token export pipeline, icon overhaul, dark mode, or universal cross-product component API is authorized by this scope.

## Governance

Prefer extending an established primitive over creating a lookalike. Add a component only after a second concrete use or when an accessibility contract requires centralization. Review visual changes at desktop and mobile widths in both supported locales.
