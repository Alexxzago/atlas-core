# Atlas Design Manifesto v1.0

## Status And Authority

**Status:** proposed product design source of truth.

This document defines the visual, interaction, content, accessibility, and responsive system for Atlas. Once approved, every new frontend surface and every material visual change must be reviewed against it. It does not override architecture, security, authorization, API, or domain rules. Those remain authoritative in the architecture and engineering documentation.

Atlas is a digital employee that learns a company's facts, speaks with its customers, and hands work to people when appropriate. It is not an administration console. The interface is the place where a business prepares, supervises, and trusts that employee.

### How To Use This Manifesto

Before designing a surface, answer these questions:

1. What job is the company preparing Atlas to do?
2. What does the user need to understand before acting?
3. What is the one consequential next action?
4. Which information is evidence, which is context, and which is implementation detail?
5. Can the surface become calmer by removing a container, control, label, or decision?

If a proposed visual decision cannot be explained with this document, it should not be introduced.

---

# 1. First Principles

## 1.1 Atlas Represents Productive Presence

Atlas is a capable colleague with bounded knowledge. It is attentive, prepared, candid about uncertainty, and never theatrical. The product must make a company feel that it is preparing a dependable member of its team, not filling out a vendor's configuration database.

The core mental model is:

```text
Company knowledge + company voice + customer channels = Atlas at work
```

The interface should make this model visible through language, sequence, and feedback. A user teaches Atlas, gives it a role, connects where it should work, and observes the work. They do not create records, publish entities, or manage adapters.

## 1.2 Emotional Contract

In the first three seconds Atlas must feel:

- Quietly premium, never ornamental.
- Intelligent without pretending to be magical.
- Warm enough for a business owner.
- Precise enough for an operator.
- Technological without using generic science-fiction signals.
- Safe enough to trust with customer conversations.

Atlas must never feel:

- Bureaucratic, audit-heavy, or ERP-like.
- Like an anonymous analytics dashboard.
- Like a template with labels placed inside rectangles.
- Loud, gamified, neon, or "AI generated".
- Overconfident about information it cannot verify.

## 1.3 The Atlas Test

A visual proposal passes only when it satisfies all six statements:

1. The user's attention lands on the work, not on the UI chrome.
2. The current company and current readiness are understandable without reading a manual.
3. One action is obviously primary.
4. Secondary detail can wait.
5. The surface remains understandable in light mode, dark mode, keyboard navigation, and 200% zoom.
6. A screenshot is recognizable as Atlas even when the wordmark is hidden.

## 1.4 Non-Negotiable Product Rules

- Server-confirmed state is truth. Visual confidence never substitutes for validation.
- Technical identifiers, provider messages, credentials, audit IDs, and internal lifecycle vocabulary are not default customer-facing content.
- A user never has to guess whether an operation is running, successful, blocked, or unavailable.
- Color communicates emphasis, never status by itself.
- Destructive or irreversible actions remain explicit even when the UI is minimalist.
- Every visible control must describe a meaningful action or state. Decoration cannot masquerade as interaction.

---

# 2. Atlas As A Person

## 2.1 Character

If Atlas were a person, it would be a composed chief of staff with excellent taste. It arrives prepared, speaks plainly, notices what needs attention, and does not fill silence to prove intelligence.

Atlas is:

- Observant rather than noisy.
- Direct rather than abrupt.
- Reassuring rather than cheerful.
- Capable rather than imposing.
- Warm rather than casual.
- Technical only when technical detail helps a person finish a job.

## 2.2 Dress

Atlas wears deep ink, soft paper, and one restrained signal of warmth. The visual equivalent is a dark navy foundation, warm off-white light surfaces, blue-violet action, and a small amber point of emphasis. The amber is a human signal: attention, readiness, and purposeful energy. It is never confetti.

## 2.3 Voice

Atlas uses short, calm, active sentences.

| Intent | Atlas says | Atlas never says |
|---|---|---|
| Start a task | “Teach Atlas something new” | “Create source revision” |
| Explain readiness | “Atlas needs published knowledge before it can answer customers.” | “Missing knowledge publication prerequisite.” |
| Confirm success | “Atlas can now use this information.” | “Publication completed.” |
| Explain waiting | “We are checking this connection.” | “Loading.” |
| Handle failure | “We could not verify this yet. Try again or check the details.” | “Provider error 400.” |
| Explain control | “Take over this conversation” | “Set control state to human_controlled.” |

### Voice Rules

- Prefer verbs that describe the customer's outcome: teach, prepare, connect, review, take over, share, pause.
- Name the consequence before the mechanism.
- Use one sentence for the current state and one sentence for the next action.
- Do not use exclamation marks in operational state messaging.
- Do not call users “admins,” “operators,” or “actors” in product copy unless their role itself is the subject.
- Translate intent, not internal field names.

## 2.4 Motion Personality

Atlas moves as if it has weight and intention. Elements settle into place; they do not fly, bounce, pulse for attention, or animate continuously without communicating state. Motion is a confirmation of hierarchy, not decoration.

---

# 3. Atlas Design Language: Quiet Orbit

## 3.1 Name

The Atlas visual language is **Quiet Orbit**.

An orbit has a center, a field, and a small number of meaningful objects. This is the composition model for Atlas:

- The task is the center.
- Context is close to the task.
- Supporting evidence or controls orbit it at lower visual weight.
- Background UI recedes.

This prevents the common dashboard failure where every object has identical visual importance.

## 3.2 Recognizable Signatures

Atlas should be recognizable by the combination of:

1. Ink-and-paper tonal contrast, not flat neutral gray.
2. A tiny amber square or point near the Atlas identity or active work signal.
3. Calm blue-violet action surfaces with controlled depth.
4. Large, optical page titles followed by concise evidence.
5. Open compositions with deliberate empty space.
6. Context labels that are small, quiet, and explicit.
7. Object surfaces that appear placed in a field, not boxed into a grid.

None of these signatures may become decorative clutter. One warm mark in a visual region is enough.

## 3.3 Anti-Patterns

Do not use:

- Card grids to compensate for unclear information hierarchy.
- A border around every group, row, list, and field.
- A separate page title, panel title, and repeated title for the same concept.
- Gray-on-gray layers with no tonal distinction.
- Colored icons merely to make a grid look interesting.
- Hero gradients, glassmorphism haze, or ambient blobs that compete with content.
- A settings page made of unrelated cards with identical headings.
- Tables when an object list or summary stack answers the job better.
- Empty-state illustrations that explain nothing.
- Spinners standing alone in empty space.

---

# 4. Composition System

## 4.1 Field, Anchor, Object

Every screen uses three compositional layers:

| Layer | Role | Visual treatment |
|---|---|---|
| Field | The page atmosphere | Canvas color, low-contrast lighting, generous outer margin |
| Anchor | The current job or decision | Large title, concise lead, primary action or current state |
| Object | A useful unit of work | Tonal surface, restrained elevation, internal rhythm |

A page may contain one anchor and several objects. It must not contain an object inside an object inside an object unless the inner object is independently actionable.

## 4.2 Grid

### Desktop

- Content canvas: 1200–1280 px maximum.
- Primary reading column: 640–760 px.
- Two-object composition: 5/7 or 4/8 columns, never equal by default.
- Three-object composition: only for comparable status items.
- Main shell sidebar: visually quiet, fixed enough to retain orientation, never wider than the work deserves.

### Tablet

- Preserve context in a compact top bar.
- Collapse multi-column object groups to one dominant object plus a supporting stack.
- Do not force desktop master-detail density into a 768 px view.

### Mobile

- One task per vertical sequence.
- Context remains available through a compact selector, not a permanently open side rail.
- Primary controls span full width only where a one-handed task benefits; avoid indiscriminate full-width buttons.
- Horizontal scrolling is reserved for a genuine compact tab strip, never form controls or card grids.

## 4.3 Spacing Rhythm

Atlas uses a base 4 px increment but exposes a practical rhythm:

| Token concept | Typical use |
|---|---|
| 4 px | icon-to-label correction, very tight internal alignment |
| 8 px | related metadata, badge composition |
| 12 px | label-to-control, compact rows |
| 16 px | normal control groups |
| 24 px | object internal sections |
| 32 px | object-to-object separation |
| 40 px | page section separation |
| 48–64 px | anchor-to-main-content separation |
| 72–96 px | intentional page breathing room on large screens |

Rules:

- Use 24 px or more between unrelated concepts.
- Use 8–16 px between parts of the same concept.
- Never use a margin merely because a component needs “some space.” Name the relationship first.
- Large screens should gain outer breathing room before gaining denser multi-column layouts.

## 4.4 Alignment

- Align titles, descriptions, object edges, and primary actions to a shared vertical axis.
- Use optical alignment for icons; do not center a small icon mechanically when its visible mass requires adjustment.
- Metadata aligns to reading edges, not arbitrarily to the far edge of a card.
- A page should not have more than two competing alignment systems.

---

# 5. Typography System

## 5.1 Typeface Direction

Use a high-quality system sans stack until a licensed Atlas typeface is deliberately selected. Typography quality comes from proportion, measure, weight, and spacing, not from introducing a novelty font.

The default family must have clear numerals, readable Spanish diacritics, strong small-size rendering, and reliable platform coverage.

## 5.2 Scale

| Role | Desktop | Compact | Weight | Line height | Use |
|---|---:|---:|---:|---:|---|
| Display | 44–52 px | 34–40 px | 650–700 | 1.06 | Rare, one key onboarding or welcome moment |
| Page title | 32–38 px | 28–32 px | 650–700 | 1.12 | One per page |
| Section title | 22–26 px | 20–22 px | 650 | 1.2 | Major work object |
| Object title | 16–18 px | 16 px | 650 | 1.3 | Integration, assistant, source, conversation |
| Body | 15–16 px | 15–16 px | 400–450 | 1.5–1.6 | Explanations and reading |
| Metadata | 12–13 px | 12–13 px | 550–650 | 1.4 | Date, source, status context |
| Eyebrow | 11 px | 11 px | 700 | 1.2 | Small contextual grouping only |

## 5.3 Rules

- One page title only.
- Never place title text inside a button-like visual object.
- Use sentence case for product copy; use uppercase only for quiet eyebrows.
- Avoid 500 weight as a substitute for hierarchy. Change size, spacing, and color first.
- Secondary text should be readable, not ghosted. It must meet contrast requirements.
- Limit line length to 65–75 characters for explanatory reading.
- Numbers should use tabular figures when comparison is central; otherwise use proportional figures.

---

# 6. Palette And Semantic Color

## 6.1 Palette Intent

Atlas color is environmental before it is decorative.

- **Ink / deep navy:** trust, concentration, technical depth.
- **Warm paper:** hospitality, clarity, room to think.
- **Blue-violet action:** purposeful agency, not generic blue SaaS.
- **Amber signal:** human attention and meaningful readiness.
- **Green:** calm confirmation.
- **Amber warning:** a condition that benefits from review.
- **Red:** a problem requiring action, never ambient decoration.

## 6.2 Semantic Roles

The implementation must expose semantic roles, not component-specific color names.

| Token family | Required roles |
|---|---|
| Canvas | canvas, canvas-atmosphere |
| Surfaces | surface, surface-raised, surface-muted, surface-overlay, surface-selected |
| Text | text-primary, text-secondary, text-muted, text-disabled, text-inverse |
| Borders | border-subtle, border-default, border-strong |
| Action | accent, accent-subtle, accent-hover, accent-active, accent-border |
| Warmth | warm-highlight, warm-signal |
| Feedback | success, success-subtle, success-border, warning, warning-subtle, warning-border, danger, danger-subtle, danger-border, processing |
| Focus | focus, focus-halo |

No component may introduce a literal color. A new semantic token requires two real use cases and a named meaning.

## 6.3 Light Theme

Light mode is warm paper with ink, not white canvas with gray boxes.

- Canvas is a slightly warm neutral.
- Raised surfaces are the closest point to paper white, used sparingly.
- Muted surfaces provide grouping without an explicit border.
- Amber appears at low opacity in identity or atmosphere, never behind text without contrast verification.
- Blue-violet primary actions carry modest depth through tonal change and shadow, not a saturated gradient.

## 6.4 Dark Theme

Dark mode is blue-black architecture, not black with gray cards.

- Canvas is a deep navy field.
- Each surface level must have a perceptible but restrained luminance step.
- Overlay surfaces are brighter than raised surfaces only when they sit above them.
- Text is cool off-white, never pure white by default.
- Amber becomes a small warm counterpoint, not a glow effect.

## 6.5 Gradients

Gradients are allowed only for atmosphere or a primary object when they clarify depth.

Allowed:

- A low-opacity radial warm highlight placed away from text.
- A two-stop tonal shift inside a featured integration or primary summary.
- A subtle action depth shift where both colors are from the accent family.

Forbidden:

- Multi-color gradients.
- Full-page saturated gradients.
- Animated gradients.
- Gradients on every card.
- Gradients used to hide insufficient hierarchy.

---

# 7. Lighting, Depth, And Elevation

## 7.1 Elevation Model

Depth must correspond to relationship, not decoration.

| Level | Meaning | Treatment |
|---|---|---|
| Field | Page environment | Canvas and atmosphere only |
| Resting | Normal content | Tonal surface, often no shadow |
| Raised | Focused work object | Slightly raised surface, soft two-part shadow |
| Overlay | Menu, dialog, popover | Overlay surface, stronger shadow, explicit focus management |
| Signal | Primary action or urgent state | Color and controlled shadow; never glow by default |

## 7.2 Borders

Borders communicate containment only when containment is necessary.

- Default objects may use no border if elevation and tonal contrast are sufficient.
- Use subtle borders for adjacent objects on similar surfaces.
- Use stronger borders only for focus, selected context, or critical separation.
- Never add a border solely because a background is present.

## 7.3 Shadows

- Shadows use neutral or ink-derived color, never black at full opacity.
- Use two layers: a tight contact shadow and a larger low-opacity ambient shadow.
- Shadows disappear or reduce in high-density lists.
- Hover may lift an independently actionable object by 1–2 px; static information must not float merely because it can.

## 7.4 Blur And Glow

- Blur is reserved for overlay backdrops and optional atmospheric canvas light.
- Glow is not part of Atlas's normal visual vocabulary.
- Focus halos are accessibility feedback, not a decorative glow.

---

# 8. Motion System

## 8.1 General Rules

- Maximum standard duration: 200 ms.
- Use a calm ease-out for entrances and color changes.
- Use a faster ease-in for exits.
- Animate only opacity, transform, shadow, border color, background color, and limited height when layout continuity requires it.
- Never use `transition: all`.
- Every motion has a non-motion equivalent under `prefers-reduced-motion`.

## 8.2 Timing

| Name | Duration | Use |
|---|---:|---|
| Instant | 80–100 ms | icon press, checkbox/badge response |
| Quick | 120–140 ms | hover, focus, button state |
| Standard | 160–180 ms | menu, disclosure, object lift |
| Deliberate | 200 ms max | panel handoff, route skeleton replacement |

## 8.3 Interaction Motion

- Buttons: optional 1 px upward movement on primary hover, none on reduced motion.
- Integration cards: optional 2 px lift only when the card is actionable.
- Menus/dialogs: fade plus 2–4 px settle; do not scale from zero.
- Tabs: color and a quiet surface shift, no sliding bar that suggests a document carousel.
- Loading: skeleton shimmer at low contrast; no continuous spinner where layout can be represented.
- Success: static text confirmation first. No confetti, checkmark burst, or bouncing badge.

---

# 9. Component Library Contract

Every component definition below includes purpose, states, semantics, and visual role. It is a contract for future implementation, not a mandate to build every component now.

## 9.1 Button

### Purpose

Commit a clear action.

### Variants

- Primary: one consequential page action.
- Secondary: alternative action with equal legitimacy but lower emphasis.
- Quiet: contextual or reversible action.
- Danger: destructive confirmation only.
- Icon: compact, named action where symbol recognition is established.

### Rules

- Primary is unique within a local decision region.
- Loading keeps width stable and prevents duplicate submission.
- Disabled state explains why when the reason is not obvious.
- Icon-only buttons require an accessible name and tooltip.

## 9.2 Field And Input

### Anatomy

Label, optional concise help, control, inline error, optional contextual action.

### Rules

- Labels are always above controls.
- Controls are at least 44 px high.
- Error belongs to the field and is connected through `aria-describedby`.
- Placeholder never replaces a label.
- Group related fields only when users naturally understand the relationship.
- A field collection should read like a conversation, not a spreadsheet.

## 9.3 Select And Combobox

- Native select is preferred for short, stable option lists.
- A custom combobox requires search, keyboard model, virtualized long lists, or richer objects; do not build one for visual preference alone.
- Current Workspace and Company selectors remain explicit context controls.

## 9.4 Card And Object Surface

Use an object surface only when it represents an independently scannable unit: integration, assistant, source, workspace, or focused conversation.

Required anatomy:

- Object identity.
- Current state or meaningful metadata.
- One principal action when applicable.
- Supporting detail hidden until it helps.

Do not wrap a simple paragraph in a card.

## 9.5 List Item

Use for comparable objects that are more useful as a sequence than as cards. Examples: knowledge sources, conversations, profile choices, members.

States:

- Default.
- Hover.
- Selected.
- Disabled/unavailable.
- Attention required.

Selection should be perceptible through surface, text, and focus/selection signal, not only an accent border.

## 9.6 Tabs

Tabs switch peer views within one stable context. They are not a substitute for navigation hierarchy.

- Maximum five visible peer destinations on compact surfaces.
- Use text labels; icons are supplementary.
- Active state uses tonal surface and type, not a heavy underline alone.
- Overflow horizontally only on small screens.

## 9.7 Disclosure And Accordion

Use for implementation detail that is useful but not necessary to begin. Examples: advanced technical details, version history, webhook diagnostics.

- State whether expanded content changes user decisions.
- Preserve keyboard and screen-reader expanded state.
- Do not hide required validation behind a disclosure.

## 9.8 Dialog

Use only for a focused interruption: irreversible confirmation, short single-purpose task, or context-preserving detail.

- Trap focus.
- Return focus to the trigger.
- Escape closes unless loss of work makes that unsafe.
- Never place a full multi-step onboarding flow in a dialog.

## 9.9 Popover And Dropdown

Use for compact context, not primary workflows.

- Must dismiss on Escape and outside click.
- Must have a keyboard focus model.
- Never conceal the only way to complete the next step.

## 9.10 Badge And Status

Badges are compact state labels, not decorations.

- Always include text.
- Use one status shape and semantic palette mapping across the product.
- Avoid status badges for facts that can be presented as normal metadata.

## 9.11 Tooltip

Tooltips clarify icons or unfamiliar terms. They never contain essential instructions, error messages, or validation.

## 9.12 Toast

Toasts acknowledge completed, non-critical actions. They do not replace inline state for failed forms, long-running work, or important consequences.

## 9.13 Empty State

Every empty state contains:

1. A specific title.
2. Why the capability matters.
3. The next permitted action.
4. One primary CTA when the user can act.

Example:

> **Your first assistant is waiting for its brief**
>
> Give Atlas a role and voice so it knows how to speak for this company.
>
> **Prepare the assistant**

## 9.14 Skeleton And Loader

- Skeletons preserve expected object geometry.
- Accessible loading copy explains what is being prepared.
- Spinner is acceptable only as a compact inline confirmation next to an already-understood task.
- Full-page loading uses identity, explanation, and a quiet layout skeleton.

## 9.15 Wizard And Progress

Use a wizard when a dependency sequence is real and user understanding benefits from it.

- Name steps by outcome, not implementation.
- Show completed, current, blocked, and next states.
- Do not force linear navigation when safe editing is possible.
- A step must explain why it exists before asking for information.

## 9.16 Timeline

Use for time-based evidence: knowledge versions, channel validation history, customer conversation events. It must prioritize meaningful moments, not log every database mutation.

---

# 10. Layout Patterns

This section defines patterns, not page mockups.

## 10.1 Workspace Pattern

Use when the user works within a selected company.

- Persistent but quiet global navigation.
- Explicit Workspace and Company context.
- One page anchor.
- Company-level peer navigation below the anchor or within the current context region.
- Main work centered with an intentionally constrained reading width.

## 10.2 Prepared Employee Pattern

Use for Assistant, Knowledge, and Channels.

Sequence:

1. What Atlas is responsible for here.
2. Current readiness or capability.
3. The next most useful action.
4. Supporting objects or details.

## 10.3 Master–Detail Pattern

Use for assistants, conversations, and source history.

- Left side: scannable identity list.
- Right side: one focused object.
- Selected state is stable and obvious.
- On mobile: selected detail becomes the primary view; list is an intentional return affordance, not a crushed column.

## 10.4 Guided Connection Pattern

Use for WhatsApp and future external channels.

- Explain the outcome.
- Show prerequisite readiness.
- Ask only for the information needed at the current point.
- Pair technical fields with plain-language help.
- Validate against server state.
- Finish with a calm, factual readiness review.

## 10.5 Knowledge Library Pattern

Use for the company's learned material.

- Present sources as useful knowledge objects, not revisions.
- Group customer language by source type: website, documents, FAQ, notes, files.
- Preserve immutable history under version history or advanced details.
- Make "Atlas can use this" the human-facing publication state.

## 10.6 Conversation Pattern

Use for live customer work.

- List supplies attention and context.
- Detail supplies the customer thread.
- Automation/human state is explicit but not alarmist.
- Reply composer appears only when permitted and relevant.
- Message direction is visible in position, surface, label, and timestamp.

## 10.7 Settings Pattern

Use grouped domains rather than a long form.

Suggested domains:

- Workspace identity.
- Members and access.
- Appearance.
- Security.
- Billing only when a real billing contract exists.

Each domain has one explanation, one primary action, and an isolated danger area where appropriate.

---

# 11. Experience Blueprints

## 11.1 Preparing An Assistant

The user should feel they are briefing a new colleague.

1. Introduce the assistant's role in plain language.
2. Ask for name, customer language, and voice.
3. Offer optional context in progressive sections.
4. Show what is still needed before Atlas can work.
5. Offer a safe test once knowledge and readiness permit it.

Avoid profile-table vocabulary, lifecycle mechanics, and a wall of optional fields at first contact.

## 11.2 Teaching Atlas Knowledge

The user should feel they are adding reliable material to Atlas's memory.

1. Start with the source type, expressed in customer language.
2. Explain what Atlas will learn from it.
3. Show processing as a source-level status.
4. Surface failure as a correction opportunity.
5. Confirm when Atlas can use the material.

Default wording:

- “Add knowledge” rather than “ingest source.”
- “Update this information” rather than “create revision.”
- “Atlas can use this” rather than “publish selection.”
- “Version history” rather than “immutable revisions.”

## 11.3 Connecting WhatsApp

The user should feel accompanied, not tested.

### Step 1: Prepare

Explain what the company needs before connecting: a business number, a ready assistant, and published knowledge. Present missing prerequisites as links to the relevant work, not as opaque blockers.

### Step 2: Identify The Number

Ask for Phone Number ID with a short definition, an expected format, and a “where to find it” explanation. Never show an internal provider field name without an accompanying human description.

### Step 3: Confirm The Business Account

Ask for Business Account ID with equivalent help. Clarify that it identifies the business account associated with the number.

### Step 4: Save A Production Credential

Explain why a stable credential matters. Keep it masked, clear it from the UI after submission, and never redisplay it.

### Step 5: Verify

Show server-confirmed validation. Map errors to actions: expired credential, invalid credential, permissions, account mismatch, provider unavailable.

### Step 6: Activate

State exactly what activation enables. Do not display active status before the server confirms it.

### Step 7: Review

Present a concise factual readiness record: company, assistant, knowledge, connection, credential, validation, webhook evidence where available, and active state.

## 11.4 Handling A Conversation

The interface should make the operator feel present with the customer, not inside a database record.

- Start with the latest meaningful customer context.
- Make automation status visible near, but not above, the customer thread.
- “Take over” is the main human control action.
- When taken over, the composer becomes the active working tool.
- Delivery failure is contextual evidence, never a raw provider error.

## 11.5 Company Setup

Atlas setup is a preparation journey, not a checklist of records.

Use this narrative order:

1. Give Atlas a company context.
2. Give it a voice.
3. Teach it what the company knows.
4. Choose where it should work.
5. Test the employee before customers depend on it.

---

# 12. Navigation Model

## 12.1 Global Navigation

Global navigation is orientation, not a feature catalog.

- Use a small number of stable destinations.
- Icons support recognition; labels carry meaning.
- Active state uses a tonal resting surface, not a loud pill.
- The sidebar should recede when content is the focus.
- Do not place every future feature in navigation before it has a customer job.

## 12.2 Context Navigation

Workspace and Company are context selectors, not actions. They must be visually distinct from the global navigation and always preserve current scope clarity.

Changing company must:

- Immediately indicate that context is changing.
- Avoid showing stale company content.
- Land the user in a meaningful company workspace, not an intermediary management screen.

## 12.3 Company Navigation

Company navigation contains peer responsibilities:

- Summary.
- Assistant.
- Knowledge.
- Channels.

WhatsApp is a channel detail, not a sibling responsibility. Future channels belong under Channels.

---

# 13. Accessibility Is A Design Input

## 13.1 Keyboard

- Every action is reachable in a logical order.
- Visible focus uses the semantic focus halo in both themes.
- Menus, dialogs, drawers, selectors, tabs, and disclosures have defined Escape, Arrow, Tab, and return-focus behavior.
- Hover-only information must be available on focus or in persistent text.

## 13.2 Semantic Structure

- One page `h1`.
- Headings follow meaningful hierarchy, never styling convenience.
- Native controls are preferred.
- Form labels, help, and errors are associated programmatically.
- Status is announced with the correct live-region urgency.

## 13.3 Contrast And Color

- All text and controls meet WCAG AA minimum contrast in both themes.
- Status uses label plus color plus shape/position where relevant.
- Disabled controls remain legible and do not impersonate unavailable state.

## 13.4 Motion And Sensory Load

- `prefers-reduced-motion` removes nonessential transform, shimmer, and animated transitions.
- Loading never relies on movement alone.
- No auto-playing decorative animation.

## 13.5 Zoom And Reflow

- Support 200% zoom without clipped actions.
- Support narrow/mobile layout without horizontal body scrolling.
- Reorder visual layout without disrupting reading and keyboard order.

---

# 14. Responsive System

## 14.1 Design, Do Not Shrink

Responsive behavior is not desktop components becoming smaller. Each breakpoint has a deliberate hierarchy.

### Desktop

Use space to improve comprehension: wide anchors, constrained reading columns, and meaningful supporting objects.

### Tablet

Keep context accessible, reduce multi-column comparison, preserve touch target size, and avoid dense side-by-side forms.

### Mobile

Prioritize one decision at a time. Keep company context visible but compact. Convert master-detail layouts into intentional list/detail transitions. Keep destructive and primary actions easy to distinguish.

## 14.2 Breakpoint Responsibilities

| Range | Responsibility |
|---|---|
| Compact | Single-column task completion, drawer navigation, 44 px minimum targets |
| Medium | Two related objects where comparison helps, compact context bar |
| Wide | Full workspace composition, visible sidebar, editorial page rhythm |
| Large | More outer space and reading comfort, not more dense columns by default |

---

# 15. Token Architecture

## 15.1 Token Layers

1. **Primitive values:** raw palette, base spacing, base shadow measurements. These are implementation-private.
2. **Semantic tokens:** canvas, surface-raised, text-primary, accent, warning-subtle, focus-halo. Components consume these.
3. **Component tokens:** only when a repeated component contract needs a stable semantic decision, such as control height or overlay elevation.

## 15.2 Required Token Families

| Family | Examples |
|---|---|
| Color | canvas, surface, text, border, accent, feedback, focus, warm highlight |
| Typography | family, size scale, weight scale, line-height scale, tracking |
| Space | 4 px rhythm and named usable intervals |
| Size | controls, icon buttons, headers, sidebar, touch targets |
| Radius | control, object, overlay, pill |
| Elevation | resting, raised, overlay, action |
| Motion | instant, quick, standard, deliberate; enter and exit easing |
| Z-index | base, sticky context, drawer, overlay, toast |
| Layout | content widths, breakpoints, reading measure |

## 15.3 Token Governance

- No literal color, arbitrary shadow, radius, or spacing in feature components.
- Do not create a component token for one use.
- Delete compatibility aliases once all consumers are migrated in a deliberate refactor.
- Token names describe role, not color or a page: `accent-subtle`, never `purple-100` or `whatsapp-card-blue`.
- Review light and dark values as pairs; a token is incomplete if only one theme works.

---

# 16. Component State Matrix

Every interactive component must specify these states before implementation:

| Component | Required states |
|---|---|
| Button | default, hover, active, focus-visible, disabled, loading |
| Input | default, hover, focus, filled, invalid, disabled, read-only |
| Select | default, focus, disabled, long-label truncation |
| Object card | resting, hover if actionable, selected, disabled, attention |
| Tab | default, hover, active, focus-visible, overflow |
| Dialog | opening, open, validation error, pending, closing, reduced motion |
| Toast | information, success, warning, danger, dismissal |
| Empty state | unavailable, no data yet, no permission, next action |
| Loader | inline, object-level, route-level, unavailable fallback |
| Wizard step | complete, current, blocked, unavailable, optional |

No component is considered finished after its default state alone.

---

# 17. Visual Quality Review Checklist

Review every material UI change against this list.

## Composition

- Is there one clear anchor?
- Can one container be removed?
- Is the most important object visually first?
- Does every card represent an independent object or decision?

## Typography

- Is the title doing more organizational work than borders?
- Is metadata quieter but still readable?
- Are line lengths intentional?

## Interaction

- Is the primary action unambiguous?
- Is a secondary action competing visually?
- Does pending state prevent duplicate work?
- Does failure explain recovery in customer language?

## Brand

- Does the surface use Quiet Orbit rather than a generic dashboard pattern?
- Is amber used as a signal, not a decoration?
- Is the color hierarchy purposeful in both themes?

## Accessibility

- Can a keyboard user complete it?
- Is focus visible?
- Is meaning preserved without color or motion?
- Does reduced motion remain calm and clear?

---

# 18. Implementation Roadmap After Approval

This manifesto must be approved before implementing the following sequence.

## Phase A: Foundation Reconciliation

1. Consolidate semantic token layers and remove obsolete visual aliases.
2. Build visual regression fixtures for light, dark, compact, and wide contexts.
3. Stabilize button, field, surface, feedback, navigation, overlay, and status primitives.
4. Publish component state matrices and accessibility contracts.

## Phase B: First Impression

1. Authentication and startup state.
2. Public chat surface.
3. Global shell, context selectors, and navigation.

## Phase C: Preparing The Employee

1. Company context and setup narrative.
2. Assistant briefing experience.
3. Knowledge library and source creation experience.
4. Readiness model and guided next action.

## Phase D: Putting Atlas To Work

1. Channels hub.
2. Guided WhatsApp connection.
3. Web Chat integration.
4. Future channel pattern.

## Phase E: Operating The Employee

1. Conversation inbox and human takeover.
2. Delivery and attention states.
3. Analytics only after a server-authoritative metrics model exists.
4. Settings domains and account safety.

## Phase F: Hardening

1. Full keyboard and screen-reader audit.
2. Light/dark contrast audit.
3. Responsive intent review at compact, medium, wide, and large sizes.
4. Reduced-motion and slow-network review.
5. Remove visual debt and duplicate legacy styles.

Each implementation phase must reference the relevant sections of this manifesto in its design review and acceptance criteria.

---

# 19. Final Definition Of Done

Atlas is visually complete only when:

- It reads as a system for preparing and supervising a digital employee.
- It never requires a customer to understand an internal implementation model to complete normal work.
- It carries a recognizable Quiet Orbit signature without relying on a logo.
- It is calmer after each new feature, not busier.
- It respects the same hierarchy in light, dark, desktop, tablet, mobile, keyboard, and reduced-motion contexts.
- It maintains honest server-derived state and secure handling of credentials.
- A future team can rebuild the frontend from this manifesto, the architecture, and the typed contracts without inventing a new design language.

**Atlas is not software to configure. It is an employee to prepare.**

---

# Appendix A. Detailed Component Recipes

This appendix turns the component contract into implementation-ready visual specifications. It intentionally describes behavior and composition, not framework APIs or CSS.

## A.1 Brand Mark

### Purpose

Give Atlas a recognizable point of origin without making the logo a hero illustration.

### Form

- One compact geometric mark: a soft-cornered amber square, point, or paired-axis shape.
- The mark may sit before the wordmark in navigation, startup, and selected high-trust moments.
- It never appears beside every heading.
- It has no independent click behavior unless it is part of a home link.

### Placement

- Sidebar: mark plus wordmark and quiet product descriptor.
- Startup: mark plus wordmark before the loading explanation.
- Authentication: mark plus wordmark; do not add an illustration.
- Empty state: only if the empty state is a first-use moment, not a failure.

## A.2 Icon System

### Rules

- Icons are 16, 18, 20, or 24 px only.
- Use a consistent rounded stroke family.
- Stroke weight is stable within a surface.
- Icons inherit semantic text color unless status meaning is necessary.
- Icons never replace labels in primary navigation unless a compact viewport has an accessible alternative.

### Semantic Categories

| Meaning | Typical icon family |
|---|---|
| Context | workspace, building, compass |
| Work | assistant, book, conversation, channel |
| State | check, pause, attention, lock |
| Action | add, edit, send, copy, open, more |
| Navigation | home, back, close, chevron |

### Forbidden Icon Use

- Do not use a lightning bolt to mean generic AI.
- Do not use a robot, brain, sparkle cloud, or neural network as a decorative motif.
- Do not use an icon where a short word is clearer.
- Do not use a different icon style for every integration.

## A.3 Navigation Item

### Anatomy

Icon, label, optional compact count or attention signal.

### Behavior

- Resting: quiet text and transparent surface.
- Hover: muted surface, no dramatic color shift.
- Active: raised or selected tonal surface, stronger label weight, optional tiny amber signal.
- Focus: semantic halo independent of active state.
- Disabled/unavailable: only when the destination remains visible for a real product reason.

### Content

Navigation labels are nouns representing a destination: Summary, Assistant, Knowledge, Channels. They are not verbs, not marketing phrases, and not implementation categories.

## A.4 Context Selector

### Purpose

Answer “where am I working?” before the user asks it.

### Anatomy

Quiet eyebrow label, current context name, native selection affordance, optional loading state.

### Behavior

- Context is visible in desktop header and compact mobile header.
- Selection change immediately indicates transition through skeleton/context state.
- Do not show data from the former company while loading the new one.
- A long name truncates visually but remains available to assistive technology.

## A.5 Page Anchor

### Anatomy

Optional context eyebrow, page title, one-sentence lead, optional primary action.

### Rules

- Page anchor never repeats a panel title directly below it.
- A lead explains the user outcome, not the data model.
- Primary action is absent when the next action is not obvious or not permitted.
- Breadcrumb is used only when it clarifies nested context; it is not decorative metadata.

## A.6 Object Header

### Anatomy

Object title, concise state, optional supporting metadata, one optional action cluster.

### Rules

- Object state should appear before timestamps when readiness matters.
- Timestamp is secondary evidence, not a headline.
- Keep destructive actions visually away from primary preparation actions.

## A.7 Integration Card

### Purpose

Represent a place where Atlas works, such as WhatsApp or Web Chat.

### Anatomy

Provider mark, readiness/status phrase, provider name, customer benefit, primary action, optional last confirmed activity.

### States

| State | Customer language |
|---|---|
| Not configured | “Set up [channel]” |
| Ready for next step | “Continue setup” |
| Active | “[Channel] is working” |
| Needs attention | “Review this connection” |
| Coming soon | “Coming soon” with no configuration action |

### Visual Rule

Only one card in a channel region may be featured. Featuring every integration destroys hierarchy.

## A.8 Readiness Item

### Purpose

Translate dependency state into a calm next action.

### Anatomy

Text state, short explanation, optional next-action link.

### Rules

- Never reveal raw blocker code.
- Use completion icon, label, and explanatory text together.
- “Blocked” is not enough; state what Atlas needs.
- Do not show a success state based on local optimistic state.

## A.9 Profile Object

### Purpose

Represent the prepared voice and responsibility of Atlas.

### Anatomy

Name, readiness status, language/tone metadata, last meaningful update, selected detail.

### Visual Direction

Profile lists are quiet object lists. The selected profile becomes the working surface. It is not a table row and not a gallery of equal marketing cards.

## A.10 Source Object

### Purpose

Represent one meaningful piece of business knowledge.

### Anatomy

Source name, source category, Atlas-use state, last update, optional compact source detail, actions.

### Rules

- The source name is the visual anchor.
- Version terminology is hidden until version history is opened.
- Processing uses a visible but calm state with an explanation.
- Failure supplies retry or correction guidance.

## A.11 Status Badge

### Anatomy

Optional mark plus short label.

### Vocabulary

- Ready.
- Preparing.
- Needs attention.
- Paused.
- Not connected.
- Active.
- Coming soon.

Avoid “healthy,” “degraded,” “pending,” and “invalid” when a customer-oriented equivalent is available. Technical detail can remain in an advanced disclosure.

## A.12 Timeline Event

### Purpose

Show a meaningful change over time.

### Anatomy

Moment, title, one-line explanation, timestamp, optional actor context.

### Rules

- One event per meaningful customer understanding, not one per backend mutation.
- Collapse repeated events.
- Use timeline only when chronological order changes a decision.

## A.13 Alert

### Purpose

Communicate a state requiring attention in the current context.

### Types

- Information: context that helps complete work.
- Success: confirmed completion with durable consequence.
- Warning: review recommended before proceeding.
- Danger: action failed or must be corrected.

### Rules

- Alert begins with the human consequence.
- A danger alert has a recovery action when one exists.
- Do not turn every inline hint into an alert.

## A.14 Confirmation

### Purpose

Protect an irreversible action.

### Rules

- Name the object affected.
- State the consequence in ordinary language.
- Use a danger action only after the consequence is understood.
- Do not require confirmation for safe, reversible preference changes.

## A.15 Avatar And Identity

Atlas does not need decorative user avatars everywhere. Use identity marks only when a person, customer, company, or assistant needs disambiguation. Generated initials must be stable, accessible, and never communicate status through color alone.

## A.16 Data Table

Tables are exceptional. Use only when users compare several attributes across many homogeneous objects and need column scanning. A table must include responsive strategy, sticky/accessible headers where needed, row keyboard behavior, and a non-table compact alternative. Never use a table merely because data is structured.

---

# Appendix B. Page Pattern Acceptance Criteria

## B.1 Authentication Pattern

### Required Impression

The user should feel they are entering a trusted place of work, not submitting a generic login form.

### Required Elements

- Atlas identity.
- Clear “welcome back” style anchor.
- One explanation sentence.
- Email and password fields with visible labels.
- Password reveal with accessible state.
- One primary action.
- Quiet recovery link.
- Tertiary account prompt.
- Compact appearance toggle.

### Rejection Criteria

- A full-width secondary button competes with sign-in.
- The card floats alone in an excessive blank canvas.
- The form uses browser-default form controls.
- The page uses a generic illustration to manufacture personality.

## B.2 Dashboard Pattern

### Required Impression

The user should understand the current company situation, not consume a generic KPI wall.

### Required Hierarchy

1. Company/workspace context.
2. Current readiness interpretation.
3. The next recommended action.
4. Supporting connection and activity evidence.

### Metrics Rule

Do not invent metrics, tiny charts, conversion rates, or trend lines. Analytics requires a server-authoritative projection. Until then, readiness and activity may be shown honestly as available or unavailable.

## B.3 Company Pattern

### Required Impression

The user is choosing which employee context to prepare.

### Required Hierarchy

1. Current company selector.
2. Current company identity and state.
3. Company responsibility navigation.
4. Secondary creation affordance.

### Rejection Criteria

- A list of “Manage company” buttons.
- Creation form above the current company.
- A company card grid where a selector answers the job faster.

## B.4 Assistant Pattern

### Required Impression

The user is writing a brief for Atlas.

### Required Hierarchy

1. What the assistant is responsible for.
2. Existing assistant choices.
3. Focused assistant detail.
4. Readiness guidance.
5. Testing and advanced operations.

### Form Rule

Start with the minimum role, language, and voice information. Optional business nuance belongs in subsequent sections, not an intimidating first wall of fields.

## B.5 Knowledge Pattern

### Required Impression

The user is building a reliable memory for Atlas.

### Required Hierarchy

1. Knowledge library explanation.
2. Source categories.
3. Source objects and their Atlas-use status.
4. Add/update knowledge action.
5. Advanced history or raw processing detail when required.

### Rejection Criteria

- A raw list of revisions as the landing state.
- Publication checkboxes as the primary customer workflow.
- A source form that visually outweighs existing company knowledge.

## B.6 Channels Pattern

### Required Impression

The user is deciding where Atlas should work.

### Required Hierarchy

1. Customer-channel promise.
2. Available integrations.
3. Current connection state.
4. One setup path.
5. Future providers without false affordances.

## B.7 WhatsApp Pattern

### Required Impression

The product is accompanying the user through a real setup dependency.

### Required Behavior

- Steps use outcomes, not internal field categories.
- Help appears before a technical field creates anxiety.
- Saved token is never redisplayed.
- Verification is visibly server-confirmed.
- Missing prerequisites link to meaningful work.

## B.8 Conversation Pattern

### Required Impression

The user is stepping into a customer interaction.

### Required Hierarchy

1. Customer/conversation choice.
2. Recent thread and current ownership.
3. Human control action.
4. Reply only when it is permitted.
5. Delivery evidence as compact context.

## B.9 Settings Pattern

### Required Impression

The user is caring for a workspace, not editing a database.

### Required Hierarchy

1. Current workspace identity.
2. Members and access.
3. Invitations.
4. Security-sensitive actions.
5. Danger zone.

### Rejection Criteria

- One unstructured form containing unrelated settings.
- Member role controls embedded in a dense paragraph.
- Destructive controls presented with normal visual weight.

---

# Appendix C. Content Grammar

## C.1 State Sentence Formula

Use this formula for operational state:

> **Current fact.** What it means. What to do next.

Examples:

> **Atlas is waiting for knowledge.** Publish the information you want it to use before connecting a customer channel. **Add knowledge.**

> **WhatsApp is ready to verify.** We saved the connection details. Check the credential to continue. **Verify connection.**

> **This conversation needs a person.** Atlas has paused automated replies. **Take over.**

## C.2 Action Grammar

| Intent | Preferred verb |
|---|---|
| Add facts | Teach, add, update |
| Make usable | Let Atlas use, make ready |
| Start connection | Connect, prepare, continue setup |
| Verify | Check, verify |
| Human intervention | Take over, release, resolve |
| Reversal | Pause, disconnect, archive |
| Recovery | Try again, review details, return to setup |

## C.3 Technical Term Policy

Technical terms are allowed when they identify a value users must retrieve. In that case pair them with:

- A plain-language definition.
- Why Atlas needs it.
- Where the user can find it.
- Expected format if helpful.
- What Atlas will not do with it, when trust requires reassurance.

## C.4 Error Policy

Never expose:

- Raw provider exception text.
- Endpoint paths.
- Credential fragments.
- Internal codes as default user copy.

May expose under advanced diagnostics for authorized troubleshooting:

- Safe category.
- Time observed.
- Retryability.
- Non-sensitive correlation context.

---

# Appendix D. Design Review Templates

## D.1 New Surface Brief

Every new surface proposal must answer:

1. Which Atlas responsibility does this support?
2. Who uses it and at what confidence level?
3. What is the page anchor?
4. What is the primary action?
5. What server-confirmed state is shown?
6. What is hidden through progressive disclosure?
7. What is the empty, loading, unavailable, and error experience?
8. What changes at compact width?
9. Which manifesto sections govern the decision?

## D.2 Component Proposal Brief

Every component proposal must answer:

1. Which existing primitive is insufficient?
2. Does this have at least two valid product uses?
3. What semantic states does it support?
4. What is its keyboard model?
5. What are its localized content responsibilities?
6. What reduced-motion behavior applies?
7. Which semantic tokens does it consume?

## D.3 Visual QA Pass

Review at minimum:

- Light and dark themes.
- English and Spanish locale expansion.
- 320 px compact width.
- 768 px medium width.
- 1280 px wide workspace.
- 200% zoom.
- Keyboard-only flow.
- Reduced motion.
- Empty, loading, unavailable, error, and populated data.

---

# Appendix E. Migration Rules

## E.1 Existing Product Surfaces

The existing frontend is not permission to preserve visual debt. During migration:

- Preserve data flow and API contracts first.
- Replace local literal values with semantic tokens.
- Remove duplicate headings before adding styling.
- Convert generic panels into the appropriate Quiet Orbit pattern.
- Preserve user-tested behavior while changing presentation.

## E.2 Avoiding Incremental Drift

Do not add one-off “v2” styles indefinitely. A visual migration is complete only when the old competing pattern is removed or explicitly quarantined with a replacement plan.

## E.3 No Fake Product

The design system must not manufacture product confidence with invented charts, false health, optimistic completion, fake activity, or disabled controls that imply unavailable features. Premium means honest, not embellished.

## E.4 Documentation Maintenance

When a new approved pattern is introduced:

1. Update this manifesto.
2. Add or amend the component contract.
3. Record its accessibility and responsive behavior.
4. Add implementation tests where behavior is involved.
5. Remove conflicting guidance.

This keeps Atlas coherent as it grows.
