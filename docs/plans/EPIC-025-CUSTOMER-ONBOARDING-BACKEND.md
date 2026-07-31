# EPIC-025 - Customer Onboarding Backend Contracts

**Status:** Proposed implementation plan. No implementation is included.  
**Scope:** Identity, Workspace onboarding, and the minimal Company onboarding contract required for a first-time customer.  
**Out of scope:** Frontend implementation, provider integrations, Channels, Knowledge, Assistant, Conversations, Analytics, Billing, Notifications, and Audit UI.

## Goal

Allow a new customer to complete this server-authoritative flow:

```text
register with name, email, password, and confirmation
-> verify email
-> authenticate
-> create first workspace
-> create first company
-> enter onboarding dashboard
```

Password recovery must be a separate, secure proof flow:

```text
request password reset
-> receive reset proof by email
-> set a new password once
-> authenticate
```

The frontend supplies intent and displays outcomes. The backend remains authoritative for identity state, email verification, passwords, tenancy, Company ownership, and authorization.

## Existing Contract Assessment

| Area | Current behavior | Required change |
|---|---|---|
| Registration | Accepts only `email` and `locale`; creates a pending User and sends verification email | Accept full name, password, confirmation, email, locale; persist password credential before verification without creating an authenticated session |
| Email verification | Activates User and returns `verified` | Return safe next-step state so the client can continue to authentication without inferring credential status |
| Credential enrollment | Separate proof flow after an existing identity is eligible | Retain for administrative/legacy enrollment only; registration becomes its own atomic account-creation flow |
| Password reset | Not implemented; `password_reset` is not a valid verification purpose | Add reset request and completion contracts with single-use, expiring proof workflows |
| Workspace creation | Accepts only name | Add optional persisted timezone and default locale under Workspace ownership |
| Company creation | Company Core requires name, slug, and valid website | Requires an explicit Company-domain decision; unsafe placeholder websites are prohibited |

## Non-Negotiable Security Rules

1. Passwords are accepted only over the existing same-origin HTTPS application boundary and are never returned, logged, placed in events, or stored in client-side persistence.
2. Password hashing remains in the existing `ScryptPasswordProvider`; controllers never hash or inspect passwords.
3. Registration, verification resend, and password-reset request responses remain enumeration-safe.
4. Verification and reset proofs remain opaque, high-entropy, one-time, purpose-separated, hashed at rest, expiry-bound, and invalidated after use.
5. A verified email does not itself establish a session. Authentication creates the session only after credential verification.
6. Workspace IDs, membership roles, Company IDs, lifecycle state, readiness, and account status remain server-owned.
7. All state-changing authenticated requests continue to require the existing same-origin origin policy and CSRF validation.

## Proposed Public Identity Contracts

### Registration

`POST /identity/register`

Request allowlist:

```text
fullName: string
email: string
password: string
confirmation: string
locale: "en" | "es"
```

Response:

```text
202 { "status": "verification_requested" }
400 { "error": "Invalid registration input." }
```

Behavior:

- Validate name bounds, email, locale, password policy, and confirmation before persistence.
- Atomically create the pending User, verified-email workflow, and password credential.
- Do not create a session.
- Duplicate and delivery-failure responses remain generic `202` where required to avoid account enumeration.
- The pending User cannot authenticate until verification activates it.

### Email Verification

`GET /identity/verify-email?proof=...`

Success response:

```text
200 { "status": "verified", "nextStep": "login" }
```

Invalid or expired proof:

```text
400 { "status": "invalid_or_expired" }
```

`nextStep` is a safe workflow result, not User data. For the new registration contract it is always `login`. Retain `create_password` only if legacy credential-enrollment links remain supported and the server can prove that state.

### Password Reset Request

`POST /identity/password-reset/request`

Request allowlist:

```text
email: string
locale: "en" | "es"
```

Response, regardless of account existence or eligibility:

```text
202 { "status": "password_reset_requested" }
```

Behavior:

- Issue a reset workflow only for active, verified, credential-bearing Users.
- Supersede prior active reset workflows for the same User.
- Record delivery outcomes without exposing them to the caller.

### Password Reset Completion

`POST /identity/password-reset/complete`

Request allowlist:

```text
proof: string
password: string
confirmation: string
```

Response:

```text
204
400 { "error": "Password does not meet policy." }
400 { "error": "Reset proof is invalid or expired." }
```

Behavior:

- Validate and consume the exact reset proof in one identity transaction.
- Replace the credential only after proof validation and password-policy success.
- Invalidate/supersede every remaining current reset proof for that User.
- Do not create a session or reveal account details.

### Existing Password Replacement

Keep `POST /identity/password/replace` for authenticated credential rotation. It remains distinct from reset completion and continues to require session, origin, and CSRF validation.

## Identity Domain And Persistence Plan

### User Full Name

Add `fullName` to the User aggregate and `users` persistence schema.

Rules:

- Trimmed, required at registration, Unicode code-point bounded.
- Stored as a presentation identity only; it does not replace email identity or authorization identifiers.
- Included in authenticated safe identity responses only if a concrete frontend need exists. It is not needed in verification, reset, or public responses.
- Existing Users migrate with `full_name = NULL`; no false name is backfilled.

### Password Credential During Registration

Extend the identity transaction port so RegistrationService can atomically persist:

1. Pending User
2. Password credential record
3. Email verification workflow

If any write fails, none persist. The existing credential repository and password provider remain the sole credential persistence/hashing boundary.

### Password Reset Verification Purpose

Add `password_reset` as an explicit verification-workflow purpose rather than overloading email-verification or credential-enrollment proofs.

Required purpose isolation:

- Purpose-specific proof parsing and hashing context.
- Independent workflow retrieval and currentness checks.
- Reset workflow cannot activate a User.
- Email-verification workflow cannot reset a password.
- Credential-enrollment workflow cannot reset a password.

### Migration

Add one ordered, checksummed additive migration for:

- nullable `users.full_name` for legacy compatibility;
- any required reset-workflow/index/schema additions, reusing existing verification storage when it already supports a purpose discriminator;
- required indexes for current reset-workflow lookup;
- no plaintext passwords, proof values, or bootstrap users.

The migration must be restart-safe, transactional where SQLite permits, and covered by upgrade/idempotency tests.

## Identity Service Plan

### RegistrationService

Change only its command contract and transaction orchestration:

- Accept a typed registration command containing full name, email, locale, password, and confirmation.
- Validate through existing email, locale, and password-policy domain services plus a new User-name value validator.
- Hash through the password provider.
- Persist all registration state atomically.
- Keep delivery outside the transaction and record outcome with the current delivery discipline.

### VerifyEmailService

- Preserve activation and single-use proof semantics.
- Return a typed result with `status` and safe `nextStep`.
- Never expose whether a duplicate registration exists.

### PasswordResetService

Introduce a focused service with:

- `request(email, locale)` for enumeration-safe issuance/delivery;
- `complete(proof, password, confirmation)` for atomic credential replacement and proof consumption.

It must depend on identity ports and providers only. No controller, HTTP, or SQLite code belongs in the service.

## Workspace Onboarding Contract

### Endpoint

Extend the existing authenticated `POST /workspaces` allowlist:

```text
name: string
timezone?: string
defaultLocale?: "en" | "es"
```

Response:

```text
201 {
  "workspace": { "id": string, "name": string, "timezone": string | null, "defaultLocale": "en" | "es" | null },
  "membership": { "id": string, "role": "owner", "status": "active" }
}
```

Rules:

- Name remains required.
- Timezone uses the existing IANA validation approach; locale uses the existing supported locale contract.
- Optional values persist under Workspace ownership, not User or Company ownership.
- The creator remains the active owner and only initial member.
- No selected Workspace or client-supplied role is accepted.

### Workspace Changes

- Add optional `timezone` and `default_locale` to Workspace persistence through an additive migration.
- Extend Workspace aggregate/type, repository port, repository mapper, service command, controller DTO, and safe workspace response DTO consistently.
- Preserve existing Workspace API callers by allowing omitted optional values.

## Company Onboarding Contract

### Required Architecture Decision

The frozen Company aggregate requires a valid identity containing name, slug, and absolute public website. Therefore, the requested first-company contract of **name required, logo optional** cannot create a valid Company today.

Do not use placeholder websites, generated fake domains, or client-controlled lifecycle shortcuts.

Before implementation, approve one of these options:

1. **Recommended: require website during first Company creation.**
   Keep the Company domain frozen. The onboarding API derives a workspace-unique slug from the name server-side and accepts an optional logo asset reference. Website becomes the only additional required field.

2. **Separate Company-domain amendment: permit website absence only in `draft`.**
   This changes a frozen value-object and aggregate invariant, migration/persistence mapping, tests, and architecture documentation. It is not part of this minimal contract plan unless explicitly approved.

### Recommended Minimal Endpoint

After option 1 approval, add an onboarding-specific Company command endpoint under the existing authorized workspace route family:

`POST /workspaces/:workspaceId/companies/onboarding`

Request allowlist:

```text
name: string
website: string
logoAssetReference?: string | null
```

Behavior:

- Route authorization remains `company:manage`, trusted WorkspaceContext, CSRF, and same-origin.
- Service derives and collision-resolves the slug server-side.
- Service creates a `draft` Company through the existing Company application and repository transaction boundary.
- Branding contains only safe asset metadata; no binary upload or asset provider is introduced.
- Return the existing safe Company response DTO.

This avoids exposing Company IDs, slugs, readiness, lifecycle transitions, or advanced configuration in first-time onboarding.

## Controller And Route Responsibilities

- Controllers validate strict request DTO allowlists, invoke one application service/use case, and map typed outcomes.
- Identity controllers never contain password policy, proof currentness, credential hashing, account state transitions, or repository access.
- Workspace controller extends its allowlist only; Workspace service owns validation and creation rules.
- Company onboarding controller does not derive lifecycle/readiness or access SQLite; the Company application service owns aggregate orchestration.
- Routes wire existing authentication, CSRF/origin, permissions, and trusted WorkspaceContext middleware. They do not create authorization policy.

## Test Plan

### Identity Domain And Service

- Full-name validation and legacy nullable reconstruction.
- Registration validates confirmation and password policy before persistence.
- Registration atomically creates User, credential, and verification workflow.
- Duplicate registration remains enumeration-safe and creates no duplicate credential/workflow.
- Verification activates once and returns the safe next step.
- Reset request remains enumeration-safe for unknown, pending, disabled, and active accounts.
- Reset proof is purpose-separated, expiring, single-use, and superseded by a later reset request.
- Reset completion changes only the intended credential, consumes proof, and creates no session.
- Existing authenticated password replacement remains unchanged.

### Migration And Repository

- Legacy User rows gain nullable full name without identity, credential, or session loss.
- Verification/reset workflow migration is restart-safe and indexed.
- No plaintext password or proof is stored.

### HTTP

- Registration strict body validation, generic duplicate response, and safe malformed-body handling.
- Verification result contract and invalid/expired result.
- Reset request generic response and reset completion error mapping.
- Workspace optional timezone/defaultLocale allowlist, validation, CSRF/origin, owner membership, and response redaction.
- Company onboarding trusted workspace scope, server-side slug generation, conflict mapping, and no client identifier/lifecycle control.
- Cross-workspace Company creation and access remain non-disclosing.

### Regression

- `npm run typecheck`
- `npm test`
- `git diff --check`

## Delivery Sequence

1. Freeze the Company website decision above.
2. Add identity full-name and password-reset domain/application contracts and migration.
3. Extend identity transaction/repositories and implement registration/verification/reset services.
4. Add identity HTTP DTOs, controllers, routes, and tests.
5. Add Workspace optional onboarding settings through its aggregate/service/repository/migration/API path.
6. Add the approved minimal Company onboarding command and tests.
7. Run full backend verification and perform security review of proofs, password handling, enumeration behavior, CSRF, and tenant isolation.
8. Begin frontend EPIC-025 only after these contracts are released.

## Explicit Non-Goals

- User profile editing beyond registration full name.
- Avatar, profile image, organization logo upload, file storage, or asset processing.
- OAuth, MFA, SSO, passkeys, magic links, social login, passwordless login, or account deletion.
- Billing enrollment, Channels, WhatsApp, Knowledge, Assistant, Conversations, Analytics, Notifications, or Audit UI.
- Auto-activating Companies or inferring readiness from onboarding completion.
