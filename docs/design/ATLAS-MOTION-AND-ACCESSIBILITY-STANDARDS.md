# Atlas Motion And Accessibility Standards

## Baseline

Target WCAG 2.2 AA for portal work. Accessibility is verified with keyboard use, browser zoom, responsive layouts, semantic inspection, and automated checks where available.

## Keyboard And Focus

- Use native buttons, links, inputs, selects, and labels before custom controls.
- Every interactive element is reachable and operable with keyboard alone.
- Preserve a high-contrast visible focus ring using the focus tokens; never remove outline without an equivalent.
- Move focus only after a deliberate context-changing action, dialog opening, or successful destructive-flow completion. Do not steal focus for passive status updates.
- Route changes move focus to the main landmark. The skip link targets that landmark. Closing the mobile drawer restores focus to its trigger; navigating from it moves focus to main content.
- The mobile drawer traps Tab focus while open and closes with Escape. Future dialogs, menus, and popovers require the same explicit focus-entry, trap, Escape, and restoration contract.

## Semantics And Feedback

- Give each page one main landmark and label navigational regions.
- Associate labels, help, validation, and errors with their fields.
- Use `role="status"` or polite live regions for noncritical async updates; use `role="alert"` for errors requiring attention.
- Status badges include localized text. Disabled controls explain their unmet prerequisite nearby rather than relying on a tooltip.

## Contrast And Responsive Use

Normal text requires 4.5:1 contrast, large text 3:1, and non-text controls/focus indicators 3:1. Support 200% zoom and narrow mobile widths without clipped content, horizontal page scrolling, hover-only controls, or loss of Workspace/Company context.

## Motion

Motion may clarify a state change, never conceal latency or convey required meaning. Use 120ms for micro-feedback, 180ms for standard entry, and 240ms only for larger contextual movement. Exits are faster than entries, use non-elastic easing, animate opacity/transform only, and never block work. Under `prefers-reduced-motion: reduce`, remove nonessential transitions, scrolling animation, and decorative effects; loading feedback must remain understandable as static text/status.

## Localization

English and Spanish are supported LTR locales. Components must tolerate longer translations and locale-formatted dates. Future RTL support requires an explicit validation pass; logical CSS properties are required now to avoid unnecessary rework.
