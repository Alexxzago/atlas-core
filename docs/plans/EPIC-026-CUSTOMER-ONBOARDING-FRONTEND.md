# EPIC-026 - Customer Onboarding Frontend Architecture

## Status

Architecture frozen. This document defines the frontend implementation boundary for the customer onboarding experience. It creates no React components, routes, or API calls.

## Objective

An unauthenticated customer completes this server-authoritative path without assistance:

```text
Landing -> Create Account -> Verify Email -> Sign In -> Create Workspace -> Create First Company
-> Welcome and Activation -> First Knowledge Source Added or Explicitly Skipped
-> Activation Dashboard -> First Successful Assistant Interaction -> Product Dashboard
```

The frontend supplies intent, validates presentation-level input, preserves navigation state, and renders safe backend outcomes. It must not infer verification, session, Workspace ownership, Company ownership, lifecycle, or readiness.

## 1. Information Architecture

### Route Families

| Family | Paths | Access | Layout |
|---|---|---|---|
| Public marketing | `/` | Public | `PublicLayout` |
| Account | `/register`, `/verify-email`, `/sign-in`, `/forgot-password`, `/reset-password` | Public, with authenticated redirects | `AccountLayout` |
| Authenticated setup | `/onboarding/workspace`, `/onboarding/company` | Authenticated, progress-guarded | `OnboardingLayout` |
| Product | Existing portal routes, including `/dashboard`, `/companies`, and Company routes | Authenticated, context-guarded | Existing `AppShell` |
| Not found | Unmatched route | Public or authenticated | Minimal safe not-found presentation |

The existing portal route parser remains the product-route authority. EPIC-026 adds a separate public/account/onboarding route model rather than overloading `PortalRoute` with unauthenticated states.

### Navigation

- Landing exposes Create Account and Sign In.
- Account pages expose only relevant reciprocal links: register/sign-in, sign-in/forgot-password, reset/sign-in.
- Verification pages do not expose a proof in navigation, persisted storage, titles, analytics, or notices.
- Setup uses a linear two-step progress indicator: Workspace then Company. It has no product navigation, Workspace switcher, Company selector, assistant, channel, or Knowledge navigation.
- Company creation leads to a post-Company activation welcome rather than directly to the operational product dashboard. The activation experience uses the existing product route family and AppShell shell after Company context has been established; it does not add a new route family.
- The activation Dashboard guides the customer to add a first Knowledge source or explicitly skip that step, then to complete a first assistant interaction. Existing full product navigation remains progressively available according to existing authorization and readiness behavior.

### Redirect and Guard Rules

| Condition | Destination | Rule |
|---|---|---|
| Auth state booting | Current route skeleton | Do not redirect before session bootstrap resolves. |
| Unauthenticated request for setup/product route | `/sign-in?next=<safe-local-path>` | Preserve only recognized local destinations; never follow external URLs. |
| Authenticated request for `/`, `/register`, `/sign-in`, `/forgot-password`, or `/reset-password` | Progress destination | `/onboarding/workspace` when no Workspace, `/onboarding/company` when selected Workspace has no Company, otherwise `/dashboard`, which renders the activation Dashboard until activation is complete. |
| Authenticated request for verification route | Progress destination | Verification is not a session; an authenticated user has no verification task. |
| Authenticated user with no Workspace | `/onboarding/workspace` | Applies before product route rendering. |
| Authenticated user with Workspaces but none selected | Select existing Workspace when exactly one; otherwise show a Workspace selection state before Company setup. Do not silently choose among multiple Workspaces. |
| Selected Workspace with no Company | `/onboarding/company` | Applies before dashboard/product routes. |
| Requested Company outside selected Workspace or unavailable | Existing non-disclosing portal handling; clear invalid selection and return to the applicable setup/product destination. |
| Valid `next` after sign-in | Requested protected local route only after progress guards pass. | Progress guard wins over `next`. |

The guard order is: session bootstrap, authentication, Workspace context, Company context, page render. Activation is a Dashboard presentation state, not a new routing guard or route. A 401 follows the existing API recovery policy; a final unauthenticated result clears portal state and redirects to sign-in.

## 2. User Flows

### Registration and Verification

1. Landing Create Account opens `/register`.
2. Registration submits full name, email, password, confirmation, and selected UI locale.
3. On `202 verification_requested`, replace the form with a confirmation state. Do not state whether the address already exists.
4. The confirmation state offers resend verification and Sign In. Resend is generic and does not disclose account state.
5. Email link opens `/verify-email?proof=...`. The page reads the proof once from the URL, immediately replaces browser history with `/verify-email`, and submits the proof.
6. `200 verified, nextStep: login` presents success and a primary Sign In CTA. It does not authenticate the customer.
7. Invalid or expired verification shows a neutral invalid-or-expired state with Resend Verification and Sign In. It does not reveal an account.
8. An already verified user who signs in proceeds through progress guards. A repeated email verification proof is treated as invalid/expired.

### Authentication and Recovery

1. Sign In submits email and password.
2. On authentication success, store only the server-issued CSRF token and generation in authentication reducer state; the session remains the HttpOnly cookie.
3. Run Workspace bootstrap after sign-in, then apply progress guards.
4. Forgot Password requests email and locale. Every valid-shaped request shows the same requested state.
5. Reset Password consumes the proof from the URL once, removes it from history, and submits password plus confirmation.
6. Reset success directs to Sign In. It does not create a session.
7. Invalid/expired reset proof renders a neutral state with Forgot Password and Sign In.
8. Session expiry on a GET uses existing one-time bootstrap recovery. If recovery fails, clear authentication/portal/onboarding state and route to Sign In with a session-expired notice. State-changing requests are never replayed automatically.
9. An already authenticated visitor to public account pages is redirected by the progress rules above.

### Workspace and Company Setup

1. First authenticated login loads the Workspace list and selection state.
2. No Workspace: render Workspace creation with required name and optional timezone/default locale.
3. Successful Workspace create uses the returned Workspace and owner membership, then selects/loads its Company list. It is pessimistic: no Workspace is shown until server success.
4. Existing Workspace(s): do not create a duplicate setup Workspace. Select the sole Workspace automatically; when several exist, require selection before Company onboarding.
5. Selected Workspace with no Company: render First Company creation.
6. First Company submits name, optional website, and optional logo asset reference to the onboarding endpoint. No slug, ID, lifecycle, readiness, or ownership fields are displayed or sent.
7. Successful Company creation stores the returned Company, selects it, and replaces history with `/dashboard`.
8. Dashboard renders the activation welcome for a newly created Company. It explains that the assistant needs customer-approved Knowledge before it can answer safely.
9. The activation primary path opens the existing Knowledge experience to add one manual-text, public-URL, or PDF source. On successful source ingestion, the activation state records that a first source exists from server data. It must not assume that ingestion is publication or readiness.
10. The activation secondary path explicitly skips first Knowledge. Skip is a customer choice held only in page/session state; it must not fabricate Knowledge, publish a source, mutate Company lifecycle, or persist a completion flag.
11. After source addition or explicit skip, activation presents the first assistant interaction. The customer can use the existing assistant preview/test surface only when its existing server requirements are met; otherwise the activation experience explains the unavailable prerequisite and links to the applicable existing setup surface.
12. A successful assistant answer or safe fallback returned by the server completes the activation journey for the current browser session. It is not stored as a server-owned product state.
13. Returning login loads server Workspace/Company context before choosing a route. It never relies on a local completion flag; Dashboard re-derives its activation presentation from server Knowledge/assistant availability and current-session interaction state.

## 3. Screen Inventory

Every screen uses semantic headings, one primary action, a live region for async status, and safe server error mapping.

| Screen | Purpose and responsibilities | Actions | States and accessibility |
|---|---|---|---|
| Landing | Explain Atlas and start account access. | Primary Create Account; secondary Sign In. | No data loading. Landmark-based public layout; CTAs are keyboard reachable. |
| Create Account | Collect full name, email, password, confirmation, locale. Submit exact registration contract. | Primary Create Account; secondary Sign In. | Submit disabled while pending; inline field errors; generic submission outcome; focus first invalid field or confirmation heading. |
| Registration Requested | Confirm next action without enumeration. | Primary Open email app only when safe as an external affordance; secondary Resend, Sign In. | Resend pending/accepted/error-neutral states; `role=status`; no email address repetition unless user entered it locally in current form. |
| Verify Email | Consume a verification proof and show safe result. | Success: Sign In. Invalid: Resend Verification, Sign In. | Loading while proof is consumed; malformed/missing proof is invalid state; focus result heading; proof removed from URL/history. |
| Sign In | Authenticate and begin context bootstrap. | Primary Sign In; secondary Forgot Password, Create Account. | Field validation; generic authentication error; pending button; focus error summary; no optimistic authenticated state. |
| Forgot Password | Request a reset proof enumeration-safely. | Primary Send reset link; secondary Sign In. | Valid-shape validation only; generic requested state for all server outcomes; focus confirmation. |
| Reset Password | Consume reset proof and set password/confirmation. | Primary Reset Password; secondary Sign In. | Loading, invalid/expired, password-policy error, success states; strip proof from URL; no password retention after submit/unmount. |
| Workspace Setup | Create first Workspace or select an existing one. | Primary Continue/Create Workspace; secondary Sign Out. | Initial list skeleton; empty state is creation form; retry on availability failure; inline timezone/locale validation; focus new step heading after success. |
| Company Setup | Create first draft Company for selected Workspace. | Primary Create Company; secondary Back to Workspace selection, Sign Out. | Company-list loading; empty state is form; conflict/validation retry; optional website must be clearly optional; focus dashboard heading after success. |
| Activation Welcome | Introduce the new Company and explain the next customer-controlled activation steps. | Primary Add Knowledge; secondary Skip for now. | Company context loading, unavailable state, and safe generic error state; focus `h1`; no claim that the assistant is ready. |
| First Knowledge Activation | Add the first source through the existing Knowledge flow, or return to the activation Dashboard. | Primary Add source; secondary Back to activation. | Reuses existing manual/URL/PDF loading, validation, availability, and accessibility states. A successfully ingested source is the completion signal; no automatic publication is implied. |
| First Assistant Interaction | Guide one initial assistant preview/test only when existing server eligibility permits it. | Primary Send test message; secondary Back to activation. | Reuses existing preview/execution validation and safe fallback handling. The success state requires a server answer or safe fallback, not a client-generated response. |
| Activation Dashboard | Replace the empty first-run operational dashboard with an ordered activation checklist: Company created, Knowledge source added or skipped, first assistant interaction. | Contextual next activation CTA; existing dashboard actions after completion. | Derives completion safely; checklist supports loading and unavailable prerequisites; uses descriptive status rather than readiness claims. |
| Dashboard Arrival | Render the existing operational dashboard after activation completion or for returning customers with sufficient server context. | Existing dashboard actions. | Existing loading/empty/error behavior; no artificial readiness claim. |
| Not Found | Recover from invalid local path without exposing resources. | Primary Landing or Dashboard according to auth/progress. | `404` semantic presentation and focusable primary action. |

## 4. Frontend State

### Provider Ownership

| State | Owner | Persistence | Notes |
|---|---|---|---|
| UI locale | Existing `I18nProvider` | Existing `atlas.locale` local storage | Registration/reset request locale is this value at submit time. |
| Route/history | Existing `RouterProvider` plus EPIC-026 route parser | Browser history only | Proof query values are removed immediately after capture. |
| Session, current user, CSRF | Existing authentication Context + reducer | Memory only | Cookie is server-owned; never store password, proof, or session identifier. |
| Workspace list, selected Workspace, Company list, selected Company | Existing authenticated portal Context + reducer | Existing selected-Workspace policy only, subject to server validation | Retain request generations and abort behavior. |
| Onboarding progress | Derived selector, not persisted state | None | `needsWorkspace`, `needsWorkspaceSelection`, `needsCompany`, `complete`, derived from authenticated state and server lists. |
| Activation progress | Dashboard-local derived selector plus current-session interaction state | No durable client persistence | `companyCreated`, `firstKnowledgeSourceAdded`, `knowledgeExplicitlySkipped`, and `firstAssistantInteractionCompleted`; source presence is server-derived, skip/interaction are current-session UX facts only. |
| Account form fields/pending/errors | Page-local reducer/state | None | Clear password, confirmation, and proof-derived state on completion/unmount. |
| Setup form fields/pending/errors | Page-local reducer/state coordinated with portal actions | None | Server success updates portal state pessimistically. |
| Navigation guard result | Pure selectors/hooks | None | Must not duplicate backend authority. |

No new global store, URL-token store, account cache, onboarding-complete local-storage flag, durable activation flag, or client-owned authorization state is permitted.

### Request Safety

Reuse `RequestContext`, generations, and active-request matching from `AuthenticatedPortalState` for Workspace/Company loads and mutations. Account pages use an abort controller per submit and ignore late completions after unmount/navigation. A stale response must never select a Workspace, Company, or redirect the customer.

## 5. Component Hierarchy

```text
App
  I18nProvider
    RouterProvider
      AuthenticationProvider
        OnboardingRouteResolver
          PublicLayout
            LandingPage
          AccountLayout
            RegisterPage / RegistrationRequestedPage
            VerifyEmailPage
            SignInPage
            ForgotPasswordPage
            ResetPasswordPage
          OnboardingLayout
            OnboardingProgress
            WorkspaceSetupPage
            CompanySetupPage
          AuthenticatedPortalProvider
            AppShell
              ActivationDashboard / Existing dashboard and product pages
```

Planned shared presentation components are form-field primitives already provided by the design system, error summary, async button, password field, account status panel, onboarding progress, activation checklist, and route guard. They consume existing tokens and primitives; EPIC-026 does not redesign them.

Planned hooks are narrowly scoped: session bootstrap/recovery, onboarding progress selector, safe next-path resolver, proof query consumer, and form submission hooks. Hooks do not call persistence directly or duplicate server policy.

## 6. API Integration

| Contract | Frontend use | Update and retry policy |
|---|---|---|
| `POST /identity/register` | Register form sends exact `{fullName,email,password,confirmation,locale}`. | Pessimistic. `202` moves to requested state. `400` maps to validation. No automatic retry. |
| `POST /identity/resend-verification` | Requested/invalid verification state. | Pessimistic generic `202`; manual retry only after completion. |
| `GET /identity/verify-email?proof` | Verification page only. | One-shot request after proof capture. No automatic retry, because proof is single-use. |
| `POST /identity/login` | Sign-in form. | Pessimistic. On success dispatch authentication then bootstrap context. `401` generic error; no automatic retry. |
| `POST /identity/session/bootstrap` | Initial auth resolution and GET recovery only. | Existing bootstrap behavior; no body fields; no automatic navigation until resolved. |
| `POST /identity/password-reset/request` | Forgot-password form. | Pessimistic generic `202`; manual resubmit only. |
| `POST /identity/password-reset/complete` | Reset-password page. | One-shot; `204` routes to sign-in. `400` maps password-policy versus invalid/expired proof safely. |
| `GET /workspaces`, `GET /workspaces/selected` | Determine progress and current context after authentication. | GET may use existing one-time session recovery. Retry availability errors manually. |
| `POST /workspaces` | Workspace setup sends `{name, timezone?, defaultLocale?}` with current CSRF token. | Pessimistic. No mutation replay. `201` inserts returned Workspace/membership then loads/selects context. |
| `POST /workspaces/:workspaceId/select` | Explicit multiple-Workspace selection. | Pessimistic, CSRF-protected, request-generation guarded. |
| `GET /workspaces/:workspaceId/companies` | Determine Company setup progress. | GET recovery allowed; stale responses ignored. |
| `POST /workspaces/:workspaceId/companies/onboarding` | First Company setup sends `{name, website?, logoAssetReference?}`. | Pessimistic, CSRF-protected, no mutation replay. On `201`, add/select returned Company and navigate dashboard. |
| Existing Knowledge source create/list contracts | Activation Dashboard determines first-source presence from server data and directs source creation through the existing manual, public URL, or PDF source flows. | Pessimistic ingestion. A source is counted only after successful server creation; never infer publication/readiness. |
| Existing assistant preview/execution contracts | First assistant interaction uses the existing eligible assistant surface and accepts only its server answer or safe fallback as completion. | Pessimistic. No retry of state-changing assistant execution; show prerequisite/availability errors safely. |

The implementation must extend `atlasApi` and frontend API types only to represent these frozen contracts. It must not use the legacy unscoped Company create endpoint for first-time onboarding.

## 7. UX Rules

- Validate required fields on blur after first interaction and on submit. Preserve server validation as authoritative.
- Do not disable a form solely because optional fields are blank. Disable its primary CTA only while pending or when required client-side fields are invalid.
- Use `aria-invalid`, linked error text, an error summary for submit failures, and move focus to the summary or first invalid control.
- After route-changing success, focus the new page `h1`; after in-place success, focus the confirmation heading/status.
- Every control is reachable by keyboard, visible in focus order, and operable with Enter/Space as appropriate. Escape closes only dismissible UI, never discards submitted state.
- Use semantic `main`, `nav`, `form`, `fieldset`, `legend`, `label`, button, and heading hierarchy. Announce loading/success via polite live regions and errors via alert semantics.
- Forms use responsive single-column layouts on narrow screens, comfortable touch targets, no horizontal scroll, and persistent primary CTA visibility without trapping content.
- Setup progress is descriptive, not a percentage claim: `Workspace` then `Company`. It reflects only current setup stage and does not imply assistant readiness.
- Activation uses an ordered checklist rather than a completion percentage. It labels Knowledge as `added` or `skipped for now`, and assistant interaction as complete only after a server response. A skipped source is never visually equivalent to published Knowledge or an operational assistant.
- Show safe messages: no account-existence claims, proof values, raw API payloads, stack traces, or authorization diagnostics.

## 8. Internationalization

- Every visible string, accessible name, validation message, status, document title, and route-level error uses `useI18n().t(...)`.
- EPIC-026 adds typed keys to the existing translation key inventory and supplies both English and Spanish values in the existing dictionaries.
- The UI locale defaults through `I18nProvider`; registration and reset request submit only `en` or `es` from that provider.
- Backend-returned safe messages are mapped to translation keys where stable. Unknown errors use a translated generic availability message.
- Dates continue to use `formatDate`; no locale-sensitive formatting is hand-written in pages.

## 9. Acceptance Criteria Before Implementation

1. Public, account, setup, product, and not-found routes are named and have explicit guard precedence.
2. Every frozen EPIC-025 request and response above has a typed frontend API mapping and safe error policy.
3. No route, state, component, or API mapping assumes `Company.website` is present.
4. Registration, verification, login, reset, Workspace creation, and first Company creation have defined loading, validation, success, error, and accessibility behavior.
5. Single-use proof handling removes proofs from URL/history and never persists them.
6. Authentication remains cookie/server authoritative; CSRF remains memory-only and state-changing calls are never automatically replayed.
7. Workspace/Company progression is derived from server data, with multiple-Workspace selection explicit and no local completion flag.
8. Post-Company activation renders through the Dashboard, requires first Knowledge source addition or an explicit non-persistent skip, and reaches first assistant interaction only through existing server-authorized capabilities.
9. Activation does not fabricate Knowledge, publication, Company lifecycle, assistant readiness, or durable completion state.
10. Existing Context + Reducer ownership, request generations, portal tenant isolation, API recovery rules, router, i18n provider, and design-system primitives are reused.
11. Implementation test plan covers redirect guards, invalid/expired proofs, session expiry, enumeration-safe states, stale responses, CSRF use, Workspace/Company tenant boundaries, activation source/skip behavior, first assistant interaction, keyboard flow, and English/Spanish rendering.
12. No frontend implementation begins until this document and the frozen backend contracts are approved together.
