# EPIC 008 — Identity & Membership Domain Design

**Milestone:** Atlas Beta 1  
**Status:** Approved domain specification

This document defines ownership, lifecycle, authorization, and compatibility rules for EPIC 008. It distinguishes current Atlas behavior, Beta 1 scope, and approved future direction. It is not an implementation plan.

## 1. Domain map and bounded contexts

### Ownership map

```text
Workspace
├── Memberships
├── Companies
│   ├── Knowledge
│   ├── Onboarding
│   ├── Company-aware Chat
│   ├── Future Assistant Profile
│   ├── Future Channel Connections
│   └── Future Conversations
├── Future Workspace Secret References
└── Future Audit Events
```

Workspace is the tenant and administrative isolation boundary. Company already exists as an aggregate root under Workspace. Company-owned business data must not move into Identity. Identity and Membership establish who may access Workspace-owned business data; they do not own that data.

The currently implemented domain includes the default Workspace foundation, Company management, Knowledge, Onboarding, company-aware Chat, and mandatory `WorkspaceContext` scoping. EPIC 008 adds Identity, Authentication, Authorization, Workspace administration, Memberships, Invitations, Sessions, and the controlled claim of the default Workspace. Items labeled future remain outside EPIC 008.

### Identity

Identity owns the durable `User`, user status, canonical user attributes, portal locale preference, and links to Authentication Identities. It must not own Workspace roles, Memberships, Sessions, Invitations, authorization decisions, or Workspace-owned business data.

### Workspace Administration

Workspace Administration owns Workspace creation and administration, Memberships, Membership roles and status, Invitations, ownership transfer, the last-Owner invariant, and the one-time default Workspace claim. It must not own credentials, Sessions, global User status, or Company business behavior.

### Authentication

Authentication establishes that an actor controls a recognized Authentication Identity. It owns credential-validation state, email Verification, Password Reset, and Sessions. It does not own Membership, Role, Permission, Active Workspace, or tenant data. Successful authentication establishes identity only.

### Authorization

Authorization evaluates whether an authenticated User may exercise an application capability in a trusted Workspace context. It owns role-to-permission policy, current-Membership validation, Active Workspace validation, deny-by-default behavior, and cross-Workspace non-disclosure. It neither authenticates credentials nor owns identity or membership state.

## 2. Ubiquitous language

- **User:** The durable Atlas representation of one human. A User may have zero or more Memberships and has no global Workspace role.
- **Identity:** Who the human is within Atlas, represented by a User. It is not a credential, Session, Role, or Membership.
- **Authentication Identity:** A means by which a User proves control of an identity, such as a verified email identity. It belongs to one User.
- **Workspace:** The durable tenant and administrative isolation boundary. It is not a Company.
- **Membership:** The relationship granting one User access to one Workspace. It owns Role and Membership status for that relationship.
- **Role:** A named application-policy classification on Membership: Owner, Administrator, Operator, or Viewer.
- **Permission:** An application capability derived from current policy. It is not UI visibility and is not persisted as a user-configurable record in Beta 1.
- **Invitation:** A time-bounded offer for one NormalizedEmail to join one Workspace with a proposed non-Owner Role. It is not a pending Membership.
- **Session:** A revocable, expiring authentication-continuity record. It establishes identity, not Workspace authority.
- **Verification:** A one-time, expiring workflow proving control of an Authentication Identity's email.
- **Password Reset:** A one-time, expiring workflow authorizing replacement of authentication confirmation data.
- **Workspace Claim:** The one-time controlled bootstrap operation that gives the existing default Workspace its initial verified Owner.
- **Active Workspace:** A contextual Workspace selection validated against a current active Membership. It is a preference and context, not an authority grant.

The following terms must not be used interchangeably: User and Membership; Identity and Authentication Identity; Authentication and Authorization; Invitation and Membership; Workspace and Company; Role and Permission; Session and Active Workspace; Verification and Password Reset; Workspace Claim and Workspace creation; disabled User and suspended Membership; deleted User and removed Membership.

## 3. Aggregate roots

### User

**Responsibilities:** Represent one human, enforce the User lifecycle, own user-level attributes and Authentication Identity links, and control account disablement and deletion.

**Owned entities:** Authentication Identity.

**Lifecycle:** `pending_verification → active ↔ locked → disabled → deleted`, subject to the transitions in Section 6.

**Invariants:** An authentication identifier belongs to at most one non-deleted Authentication Identity; an Authentication Identity belongs to one User; deleted Users cannot authenticate; User status conveys no Workspace authority; material identity changes invalidate affected confirmation and continuity state.

**Allowed commands:** Register, verify email, change supported identity attributes, lock, unlock, disable, restore where permitted, request deletion, complete deletion, and eventually link or unlink an Authentication Identity.

**Forbidden responsibilities:** Workspace roles, Membership authorization, Active Workspace selection, Workspace business-data ownership, and durable raw passwords or tokens.

### Workspace

**Responsibilities:** Represent the tenant boundary, own Membership relationships, preserve an active Owner, and control Membership roles and states.

**Owned entities:** Workspace Membership.

**Lifecycle:** Active after creation or successful claim. Workspace deletion behavior is not implemented by EPIC 008; this epic defines only its authorization constraints and interaction with last-Owner and account-deletion rules.

**Invariants:** One Membership per User and Workspace; every active Workspace has an active Owner; Role belongs to Membership; inactive Membership grants nothing; only Owners alter Owner status; no transition may remove the last active Owner.

**Allowed commands:** Create Workspace with initial Owner, claim the default Workspace, activate an invited Membership, change Role, suspend, reactivate, remove, leave, and transfer ownership.

**Forbidden responsibilities:** Authentication, Sessions, global User status, Company business behavior, and treating client-provided Workspace identity as authority.

### Company

Company is an existing aggregate root owned by one Workspace. It owns or anchors Company Knowledge, Onboarding behavior, and company-aware Chat. Future Company-owned concepts include Assistant Profile, Channel Connections, and Conversations. Identity and Membership must not absorb these responsibilities.

### Invitation

**Responsibilities:** Bind one join offer to one Workspace, NormalizedEmail, proposed Role, and expiration; enforce one terminal outcome.

**Owned entities:** None.

**Lifecycle:** `pending → accepted | rejected | revoked | expired`.

**Invariants:** Only a pending, unexpired Invitation can be acted on; acceptance requires a verified matching identity; it cannot create a duplicate Membership; it is consumed once; and it may grant Administrator, Operator, or Viewer, never Owner.

**Allowed commands:** Create, accept, reject, revoke, and expire.

**Forbidden responsibilities:** Authenticating the invitee, representing Membership before acceptance, granting pending access, or transferring ownership.

### Session

**Responsibilities:** Represent authenticated continuity, expiration, revocation, and invalidation after security-sensitive identity changes.

**Lifecycle:** `active → expired | revoked`.

**Invariants:** An active Session references a usable User and Authentication Identity; expiration is mandatory; terminal Sessions cannot authenticate; Session state never grants Workspace authority.

**Allowed commands:** Create after successful authentication, validate, expire, revoke, and revoke applicable Sessions after material identity changes.

**Forbidden responsibilities:** Granting Workspace access, permanently caching Role authority, or overriding current Membership state.

Email Verification, Password Reset, and Workspace Claim are security-sensitive application workflow records rather than additional aggregates in Beta 1. Their state and atomic one-time consumption remain mandatory.

## 4. Entity classification

| Concept | Classification | Identity |
|---|---|---|
| User | Aggregate root | `UserId` |
| Authentication Identity | Entity inside User | Stable AuthenticationIdentity identifier |
| Workspace Membership | Entity inside Workspace | `MembershipId` |
| Invitation | Aggregate root | Stable Invitation identifier |
| Session | Aggregate root | Stable Session identifier |
| Email Verification | Application workflow record | Workflow identity and non-reversible token reference |
| Password Reset | Application workflow record | Workflow identity and non-reversible token reference |
| Workspace Claim | Application workflow record | Singleton claim identity for the default Workspace |
| Workspace | Aggregate root | `WorkspaceId` |
| Company | Existing aggregate root under Workspace | Existing Company identity |
| Assistant Profile | Intentionally postponed Company-owned aggregate direction | Not decided in EPIC 008 |

A removed Membership is historical and terminal. If that person is invited again later, acceptance creates a new Membership identity; removed Memberships are never reactivated.

## 5. Value objects

- **UserId, WorkspaceId, MembershipId:** Opaque, type-specific identifiers. They identify but never authorize.
- **EmailAddress:** A validated email suitable for display and communication.
- **NormalizedEmail:** The deterministic, case-insensitive comparison form for identity uniqueness and Invitation matching. It must not apply provider-specific mailbox assumptions.
- **Role:** Closed Beta 1 set: Owner, Administrator, Operator, Viewer.
- **PermissionSet:** An immutable application-policy result derived from a current Role; not persisted as user configuration in Beta 1.
- **MembershipStatus:** `active`, `suspended`, or `removed`.
- **UserStatus:** `pending_verification`, `active`, `locked`, `disabled`, or `deleted`.
- **InvitationStatus:** `pending`, `accepted`, `rejected`, `revoked`, or `expired`.
- **SessionStatus:** `active`, `expired`, or `revoked`.
- **VerificationToken, ResetToken, WorkspaceClaimToken:** Ephemeral proofs visible only at issuance and presentation boundaries.
- **TokenDigest:** A non-reversible durable reference; it is not a usable token.
- **Locale:** A supported portal locale, separate from assistant language.
- **Timestamp and Expiration:** Instants evaluated against an authoritative application clock; validity ends at the expiration boundary.

## 6. Lifecycles and state transitions

### User

```text
pending_verification ──verify──> active
pending_verification ──disable──> disabled
active ──security lock──> locked
locked ──approved recovery──> active
active | locked ──disable──> disabled
disabled ──approved restore──> active
pending_verification | active | locked | disabled ──delete──> deleted
```

Email verification is mandatory before normal login and all Workspace access. `pending_verification` cannot use normal login, claim a Workspace, create a Workspace, or accept Workspace access. `locked` is temporary authentication denial; `disabled` is account-level denial; `deleted` is terminal for normal product behavior.

### Membership

```text
active ──suspend──> suspended
suspended ──reactivate──> active
active | suspended ──remove──> removed
```

Only active Membership grants authorization eligibility. Invitation pending is not a Membership state. Removed is terminal. Owner transitions must preserve another active Owner whenever Owner capability would be lost.

### Invitation

```text
pending ──accept──> accepted
pending ──reject──> rejected
pending ──revoke──> revoked
pending ──time expires──> expired
```

Terminal states are final. Acceptance atomically consumes the Invitation and creates an active Membership. Concurrent terminal actions allow at most one success. A replacement Invitation supersedes an applicable pending predecessor.

### Session

```text
active ──expiry boundary──> expired
active ──logout or invalidation──> revoked
```

Terminal Sessions cannot be reactivated. Normal login requires a verified, active User and creates a new Session.

### Verification and Password Reset

Each workflow is one-time and expiring. Successful consumption, expiry, explicit invalidation, supersession, or a material identity-data change makes it unusable. Consumption and the protected state change form one controlled outcome. Replay fails without state change.

Completing Password Reset consumes the reset, replaces the applicable confirmation data, invalidates related outstanding workflows, revokes affected Sessions, and produces an auditable fact. Request behavior must not reveal whether an identity exists.

### Workspace Claim

```text
unclaimed ──authorized successful claim──> claimed
unclaimed ──failed attempt──> unclaimed
```

Claimed is permanent. Claim success requires the default Workspace, an active verified claimant, valid setup authorization, no prior claim, and atomic creation of its initial Owner Membership. Concurrent attempts allow at most one success.

## 7. Domain invariants

1. Every active Workspace has at least one active Owner.
2. Multiple Owners are supported, but organizations should minimize Owner assignments according to least privilege.
3. One User has at most one current Membership identity per Workspace; historical removed Memberships remain terminal and a later return creates a new identity.
4. Role belongs to Membership, never the global User.
5. Invitation pending is not Membership pending.
6. An Invitation is bound to exactly one Workspace and one NormalizedEmail.
7. Acceptance requires a verified Authentication Identity matching the invited NormalizedEmail.
8. Invitations may grant Administrator, Operator, or Viewer, never Owner.
9. Only an Owner may grant, revoke, or transfer Owner.
10. An Administrator cannot grant or revoke Owner and cannot modify an Administrator or Owner.
11. Administrators may suspend or remove Operators and Viewers only.
12. Removing, suspending, demoting, disabling, deleting, or allowing the departure of the last active Owner is forbidden.
13. Cross-Workspace access is indistinguishable from not found.
14. Client-supplied Workspace identity and resource identifiers never grant authority.
15. Authentication establishes identity only; authorization requires a usable User, valid Session, active Membership, trusted Workspace context, and required Permission.
16. Suspended or removed Memberships grant no permissions.
17. Identity deletion and Membership removal cannot delete Workspace-owned business data.
18. One-time tokens cannot be replayed; expired, consumed, invalidated, and superseded tokens are unusable.
19. Changing material confirmation data invalidates prior confirmation where applicable.
20. Raw reusable tokens cannot be reconstructed from durable state.
21. Accepting an Invitation cannot create a duplicate active Membership relationship.
22. Workspace creation includes its initial Owner as one outcome.
23. Default Workspace claim creates exactly one initial Owner and permanently disables claim.
24. Claim does not move or change existing Companies, Knowledge, or identifiers.
25. Active Workspace is valid only while current User, Membership, and Workspace state permit it.
26. Cached Roles, permissions, or selections cannot override authoritative current state.
27. Portal locale does not alter assistant language.
28. Every person uses an individual identity; shared human credentials are prohibited.
29. Every identity-changing action must be suitable for future audit.
30. Owners remain bounded tenant administrators, not platform-wide or infrastructure administrators.

## 8. Roles and permissions

In Beta 1, only Role is persisted on Membership. Permissions and PermissionSets are not persisted as user-configurable records. Application policy derives permissions from the current Role: Owner, Administrator, Operator, or Viewer. Unknown roles, permissions, inactive state, or incomplete context deny access. Custom roles and persisted permission sets are postponed.

| Capability | Owner | Administrator | Operator | Viewer |
|---|---:|---:|---:|---:|
| Read Workspace and Company data | Yes | Yes | Yes | Yes |
| Use company-aware Chat | Yes | Yes | Yes | No |
| Run or manage Onboarding | Yes | Yes | Yes | No |
| Manage ordinary Company operations | Yes | Yes | Yes | No |
| Invite Administrator, Operator, or Viewer | Yes | Yes | No | No |
| Suspend/remove Operator or Viewer | Yes | Yes | No | No |
| Modify Administrator | Yes | No | No | No |
| Manage ordinary Workspace settings | Yes | Yes | No | No |
| Grant, revoke, or transfer Owner | Yes, subject to LastOwnerPolicy | No | No | No |
| Authorize future Workspace deletion | Yes | No | No | No |

Operator may onboard and use Chat. Viewer is strictly read-only and cannot start processing or mutations. Owner-only actions remain Owner-only even if future custom roles are introduced. Permission checks describe application capabilities, never UI visibility.

## 9. Domain services and policies

- **LastOwnerPolicy:** Prevents an operation from leaving an active Workspace without an active Owner. Inputs: Workspace, current active Owners, proposed transition, and transactionally current state.
- **MembershipAuthorizationPolicy:** Evaluates a requested capability. Inputs: authenticated User and status, trusted Workspace context, current Membership, role policy, requested Permission, and target Membership where relevant.
- **InvitationAcceptancePolicy:** Validates acceptance. Inputs: Invitation, time, accepting User, verified NormalizedEmail, existing Membership history, target Workspace, and proposed Role.
- **WorkspaceClaimPolicy:** Controls one-time default Workspace claim. Inputs: trusted default Workspace identity, claim state, verified claimant, setup authorization, and existing Owner state.
- **AccountDeletionPolicy:** Coordinates deletion without orphaning Workspaces or deleting their data. Inputs: User, Memberships, Owner counts, transfer obligations, Sessions, identity workflows, and applicable retention rules.
- **ActiveWorkspaceSelectionPolicy:** Selects and validates context. Inputs: authenticated User, active Memberships, preference, Workspace state, and trusted server resolution.
- **SessionValidityPolicy:** Validates authentication continuity. Inputs: Session state and expiry, authoritative time, User state, Authentication Identity state, and relevant invalidation boundary.

## 10. Commands and controlled outcomes

- **RegisterUser:** Creates a pending-verification User, Authentication Identity, and Verification workflow; creates no Membership.
- **VerifyEmail:** Atomically consumes valid Verification and activates the User when all conditions hold.
- **Login:** Requires mandatory completed email Verification and an active usable User; creates a Session but no Workspace authority.
- **Logout:** Revokes the presented Session idempotently.
- **RequestPasswordReset:** Creates or supersedes an eligible reset without disclosing identity existence.
- **CompletePasswordReset:** Atomically consumes reset, changes confirmation data, invalidates related workflows, and revokes affected Sessions.
- **CreateWorkspace:** Creates an active Workspace and requesting verified User's active Owner Membership as one outcome.
- **ClaimExistingWorkspace:** Performs the controlled flow in Section 13.
- **InviteMember:** Creates a time-bounded Invitation for Administrator, Operator, or Viewer after current authorization.
- **AcceptInvitation:** Validates matching verified identity and atomically accepts the Invitation and creates a new active Membership identity.
- **RejectInvitation:** Makes a matching pending Invitation terminal without creating Membership.
- **RevokeInvitation:** Allows an authorized administrator to revoke a pending Invitation.
- **ChangeMemberRole:** Changes Role when actor scope and LastOwnerPolicy permit; Administrators cannot modify Administrators or Owners.
- **SuspendMember:** Removes authorization immediately; Administrators may target only Operators and Viewers.
- **RemoveMember:** Terminates Membership access without deleting Workspace data; Administrators may target only Operators and Viewers.
- **LeaveWorkspace:** Removes the requester's Membership if LastOwnerPolicy permits.
- **TransferOwnership:** Owner grants Owner to an eligible active member and may relinquish Owner while preserving an active Owner.
- **DeleteUserAccount:** Revokes identity access and terminates Membership access without deleting Workspace data; cannot complete for a sole Owner.
- **SelectActiveWorkspace:** Records or resolves a preference only after current active-Membership validation; it grants nothing.

## 11. Domain events

Meaningful append-oriented facts include:

- `UserRegistered`, `UserActivated`, `UserLocked`, `UserUnlocked`, `UserDisabled`, `UserDeletionRequested`, `UserDeleted`
- `AuthenticationIdentityVerified`, `AuthenticationIdentityLinked`, `AuthenticationIdentityUnlinked`
- `EmailVerificationIssued`, `EmailVerified`, `PasswordResetRequested`, `PasswordResetCompleted`
- `SessionCreated`, `SessionRevoked`, `SessionExpired`
- `WorkspaceCreated`, `WorkspaceClaimed`
- `InvitationCreated`, `InvitationAccepted`, `InvitationRejected`, `InvitationRevoked`, `InvitationExpired`
- `MembershipActivated`, `MembershipRoleChanged`, `MembershipSuspended`, `MembershipReactivated`, `MembershipRemoved`, `MemberLeftWorkspace`
- `OwnerGranted`, `OwnerRelinquished`, `OwnershipTransferred`
- `ActiveWorkspaceSelected`, `ActiveWorkspaceInvalidated`

Events support future audit, observability, and integrations. They are not the source of truth and do not introduce event sourcing. They must exclude raw credentials, raw tokens, and unnecessary personal data. Every identity-changing action must be representable as an auditable fact.

## 12. Ownership and deletion rules

- **User leaves a Workspace:** Membership becomes removed; access ends; other Memberships and the User remain. Workspace-owned data remains. Last Owner cannot leave.
- **Membership is removed:** It grants nothing and cannot remain Active Workspace. Authentication may remain valid for other Workspaces. Workspace data and historical attribution remain.
- **User account is deleted:** Sessions and workflows become unusable, Membership access terminates, and personal data follows approved retention rules. Workspace business data remains. A sole Owner must resolve ownership first.
- **Workspace is deleted:** EPIC 008 does not implement this behavior. It defines that only Owner policy may authorize it, Membership authority would end, and User identities and other Workspaces must remain unaffected. Data retention requires separate approval.
- **Invitation expires:** It becomes terminal, creates no Membership, and cannot be reused.
- **Sole Owner requests deletion:** The request may be recorded, but deletion cannot complete until ownership is resolved or a separately approved Workspace deletion occurs.
- **Authentication Identity is unlinked in the future:** User and Memberships remain; related Sessions and workflows are invalidated; unlinking cannot leave an active User without an approved authentication method.

Companies, Knowledge, Onboarding results, future Assistant Profiles, Channel Connections, Conversations, Messages, Workspace settings, and business audit history remain owned by Workspace or Company, never by the administrative User who acted on them.

## 13. Workspace claim flow

The existing trusted default Workspace uses this controlled bootstrap lifecycle:

1. Atlas starts in an explicit unclaimed setup state.
2. Public self-registration cannot invoke claim.
3. The claimant must be an active User with verified email.
4. Trusted deployment or setup authorization is required.
5. The target must be the existing default Workspace, with no prior claim or initial Owner.
6. Creating the claimant's Owner Membership and marking claim permanently complete is one controlled outcome.
7. Existing Companies, identifiers, Knowledge, and Onboarding state remain unchanged.
8. The Workspace is not copied, recreated, or transferred.
9. Repeated attempts after success create no additional state.
10. Concurrent attempts permit exactly one success.
11. Failure creates neither a partial Membership nor a false claimed state and leaves a clear unclaimed setup state.
12. Success is auditable and permanently disables bootstrap claim authority.

## 14. Active Workspace behavior

- With one active Membership, Atlas may select that Workspace automatically but must validate it on use.
- With multiple active Memberships, Atlas may use a valid last-used preference or require selection among currently accessible Workspaces.
- With no active Membership, the User may remain authenticated but has no Active Workspace or Workspace-owned access.
- If the last-used Workspace is inaccessible, the preference is invalidated; Atlas may select the sole remaining accessible Workspace or require a new selection.
- A suspended Membership immediately makes that Workspace ineligible.
- A Workspace deleted during a Session invalidates Active Workspace without necessarily invalidating identity access to other Workspaces.

Every Workspace-scoped operation validates current Session, User, Workspace, Membership, Permission, and trusted `WorkspaceContext`. Navigation intent, route values, bodies, queries, headers, cached UI state, and remembered selections never establish authority.

## 15. Security-sensitive boundaries

- Passwords and raw tokens are not domain-visible after validation.
- Durable state may retain TokenDigests; raw reusable tokens must not be stored or returned later.
- Authentication establishes identity only.
- Authorization derives from current active Membership and trusted Workspace context.
- Prompts, model output, frontend controls, and cached state are never security boundaries.
- Identity, Session, Invitation, Membership, Role, ownership, and claim changes must be suitable for future audit.
- Responses must avoid account enumeration and tenant-resource disclosure.
- Every human must have an individual identity; shared human credentials are prohibited.
- Role and Membership changes affect authorization immediately.

## 16. Compatibility with current Atlas

The model preserves the existing `WorkspaceContext`, Workspace-scoped repository contracts, Company aggregate, Company/Knowledge/Onboarding/Chat behavior, existing default Workspace data, cross-Workspace not-found semantics, and the Portal's lack of client-supplied Workspace authority.

The conceptual replacement for the current fixed SaaS development context is:

```text
fixed default WorkspaceContext
            ↓
authenticated User
            ↓
validated active Membership
            ↓
server-resolved Active Workspace
            ↓
trusted WorkspaceContext
```

Downstream Company operations continue to receive the same trusted tenant concept. Trusted local/community mode is permitted only through explicit non-production configuration and must fail closed in production. It must preserve Workspace-scoped contracts and cannot become a production authorization bypass.

## 17. Future domain direction and postponed decisions

### Future bounded contexts

Atlas may evolve explicit modules for:

- Identity
- Workspace Administration
- Company Management
- Knowledge
- Assistant Configuration
- Conversations
- Channels
- Capabilities
- Secrets
- Audit
- Billing
- Analytics

These are modular-monolith boundaries, not microservices. Cross-domain behavior remains within one deployable application through explicit contracts unless a later accepted decision changes that architecture.

### Future Assistant Profile

Assistant Profile is an intentionally postponed Company-owned aggregate or aggregate direction. It may eventually own persona, response policy, assistant language policy, knowledge selection, model policy, handoff policy, and capability enablements. Beta 1 does not implement Assistant Profile or multiple assistants. Portal locale remains separate from future assistant language.

### Workspace Secret Store boundary

Workspace administratively owns future secret references. Raw secrets remain infrastructure-owned and are resolved only by appropriate adapters. Users do not own provider credentials. Membership roles may later control secret-management permissions, but secret management is outside EPIC 008.

### Channels and Conversations

Future Channel Connections belong to Company. Conversations belong to Workspace and Company, and Messages belong to Conversation. Administrative User identities may act on these records but never own customer Conversations. These domains remain outside EPIC 008.

### Other postponed decisions

- SSO, social login, MFA, passwordless login, and complex account recovery
- custom roles and persisted user-configurable PermissionSets
- company-scoped Memberships, guest Memberships, and per-user permission exceptions
- service accounts, API keys, impersonation, and SCIM
- detailed audit UI and external directory synchronization
- billing ownership and primary Owner distinction
- Workspace merge and Workspace transfer automation
- multiple assistants and general Authentication Identity linking UI
- detailed Workspace deletion, retention, restoration, and transfer behavior
- organization hierarchy, delegated platform support, and event sourcing

## 18. Implementation constraints derived from the domain

A future implementation must preserve:

- mandatory email Verification before normal login or Workspace access;
- deterministic case-insensitive NormalizedEmail identity;
- transactional LastOwnerPolicy checks;
- atomic Workspace creation with initial Owner;
- atomic default Workspace claim with initial Owner;
- atomic Invitation acceptance and new Membership creation;
- new Membership identity after prior removal;
- safe concurrent claim, Invitation, token, and ownership operations;
- one-time, expiring, superseding token semantics and replay protection;
- immediate authorization revalidation after User, Role, Membership, or Workspace changes;
- only Role persisted on Membership, with permissions derived by application policy;
- deny-by-default behavior for unknown roles, permissions, and incomplete context;
- mandatory trusted Workspace context for tenant-owned repository access;
- no resource-existence leaks across tenants;
- no client value establishing Workspace authority;
- no cascade from User or Membership deletion into Workspace-owned business data;
- auditable identity-changing operations without event sourcing;
- business rules in services and policies, persistence only in repositories, and external communication only in providers;
- current Company, Knowledge, Onboarding, and Chat contracts;
- explicit non-production local/community trust mode that fails closed in production.

## 19. Open questions

### Must decide before implementation

No remaining domain decision is known to block EPIC 008 implementation. The approved PRD remains authoritative for acceptance criteria, and any discovered conflict must be resolved before the affected implementation proceeds.

### May decide during implementation without changing this model

- exact expiration durations for Sessions, Invitations, Verification, and Password Reset;
- whether last-used Active Workspace preference is User-level or device/session-specific;
- rate limits and cooldowns for security-sensitive workflows;
- exact audit metadata for failed actions, subject to data minimization;
- user-facing treatment of safe idempotent outcomes;
- retention details for minimized identity audit attribution, if existing policy already supplies the governing rule.

### Intentionally postponed

All decisions listed in Section 17 remain outside EPIC 008.

## 20. Smallest safe implementation sequence

1. Establish User, Authentication Identity, NormalizedEmail, status, Verification, and one-time workflow semantics.
2. Add mandatory verified login, Session validity, logout, and Password Reset lifecycle behavior.
3. Introduce Membership with four fixed Roles, derived permissions, Administrator boundaries, and LastOwnerPolicy.
4. Resolve authenticated User and active Membership into the existing trusted `WorkspaceContext`, with fail-closed production behavior.
5. Implement Workspace creation with atomic initial ownership.
6. Implement the one-time default Workspace claim before ordinary multi-Workspace administration.
7. Implement Invitation lifecycle and atomic acceptance into a new Membership.
8. Implement role changes, suspension, removal, leave, and ownership transfer.
9. Implement Active Workspace selection and invalidation.
10. Coordinate account deletion without deleting Workspace-owned data.
11. Verify audit facts, concurrency safety, token replay protection, last-Owner protection, and cross-tenant non-disclosure.
