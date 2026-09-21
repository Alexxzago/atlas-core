import { randomUUID } from "node:crypto";
import type { Clock } from "../../identity/application/ports.js";
import { abuseScope } from "../../abuse/sharedRateLimitRepository.js";
import {
  workspaceInvitationActorLimit,
  workspaceInvitationWorkspaceLimit,
  type RateLimitService,
} from "../../abuse/rateLimitService.js";
import {
  createEmailAddress,
  createNormalizedEmail,
} from "../../identity/domain/email.js";
import type { UserId } from "../../identity/domain/user.js";
import type {
  InvitationDeliveryPort,
  InvitationProofProvider,
  LegacyWorkspaceAdministrationTransactionPort,
  WorkspaceAdministrationRepositories,
  WorkspaceAdministrationTransactionPort,
} from "../application/ports.js";
import type { Workspace } from "../../types/workspace.js";
import {
  invitationCurrent,
  invitationRole,
  type Invitation,
} from "../domain/invitation.js";
import {
  LastOwnerPolicy,
  mayManageMembership,
  membershipRole,
  type Membership,
  type MembershipId,
  type MembershipRole,
  type WorkspacePublicId,
} from "../domain/membership.js";
export class WorkspaceAdministrationError extends Error {}
export class WorkspaceAdministrationConflict extends Error {}
export class WorkspaceAdministrationService {
  private readonly owners = new LastOwnerPolicy();
  public constructor(
    private readonly tx:
      | WorkspaceAdministrationTransactionPort
      | LegacyWorkspaceAdministrationTransactionPort,
    private readonly proofs: InvitationProofProvider,
    private readonly clock: Clock,
    private readonly delivery: InvitationDeliveryPort,
    private readonly invitationOrigin: string,
    private readonly invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000,
    private readonly limits?: RateLimitService,
  ) {}
  public async createWorkspace(
    userId: UserId,
    nameValue: string,
    settings: { timezone?: string; defaultLocale?: string } = {},
  ) {
    const name = nameValue.trim(),
      timezone = this.timezone(settings.timezone),
      defaultLocale = this.defaultLocale(settings.defaultLocale);
    if (name.length < 2 || name.length > 100)
      throw new WorkspaceAdministrationError();
    return this.tx.execute(async (r) => {
      const user = await r.users.findById(userId);
      if (!user || user.status !== "active" || !(await this.mayOwn(r, userId)))
        throw new WorkspaceAdministrationError();
      const now = this.clock.now(),
        publicId = this.id("wsp") as WorkspacePublicId,
        workspace = await r.workspaces.create({
          publicId,
          key: publicId,
          name,
          timezone,
          defaultLocale,
        }),
        member = this.membership(workspace.id, userId, "owner", now);
      await r.memberships.create(member);
      this.owners.assertFinalOwnerCount(
        await r.memberships.countActiveOwners(workspace.id),
      );
      return { workspace, member };
    });
  }
  public async listWorkspaces(userId: UserId) {
    return this.tx.execute(async (r) =>
      Promise.all(
        (await r.memberships.listForUser(userId)).map(async (member) => {
          const workspace = await r.workspaces.findById(member.workspaceId);
          if (!workspace) throw new WorkspaceAdministrationError();
          return {
            publicId: workspace.publicId,
            name: workspace.name,
            role: member.role,
          };
        }),
      ),
    );
  }
  public async select(userId: UserId, publicId: string) {
    return this.tx.execute(async (r) => {
      const workspace = await r.workspaces.findByPublicId(
          publicId as WorkspacePublicId,
        ),
        member = workspace
          ? await r.memberships.findCurrent(userId, workspace.id)
          : null;
      if (!workspace || !member || member.status !== "active") {
        await r.selections.clear(userId);
        throw new WorkspaceAdministrationError();
      }
      await r.selections.save(userId, workspace.id, this.clock.now());
      return {
        publicId: workspace.publicId,
        name: workspace.name,
        role: member.role,
      };
    });
  }
  public async selected(userId: UserId) {
    return this.tx.execute(async (r) => {
      const id = await r.selections.find(userId);
      if (id === null) return null;
      const member = await r.memberships.findCurrent(userId, id),
        workspace = await r.workspaces.findById(id);
      if (!member || member.status !== "active" || !workspace) {
        await r.selections.clear(userId);
        return null;
      }
      return {
        publicId: workspace.publicId,
        name: workspace.name,
        role: member.role,
      };
    });
  }
  public async listMemberships(actor: UserId, workspacePublicId: string) {
    return this.withActor(actor, workspacePublicId, async (r, _w, a) => {
      if (a.role !== "owner" && a.role !== "administrator")
        throw new WorkspaceAdministrationError();
      return (await r.memberships.listForWorkspace(a.workspaceId)).map((m) => ({
        id: m.id,
        role: m.role,
        status: m.status,
        userId: m.userId,
      }));
    });
  }
  public async listInvitations(actor: UserId, workspacePublicId: string) {
    return this.withActor(actor, workspacePublicId, async (r, _w, a) => {
      if (a.role !== "owner" && a.role !== "administrator")
        throw new WorkspaceAdministrationError();
      const now = this.clock.now();
      return Promise.all(
        (await r.invitations.listForWorkspace(a.workspaceId)).map(async (i) => {
          if (
            i.status === "pending" &&
            Date.parse(now) >= Date.parse(i.expiresAt)
          ) {
            await r.invitations.update(
              { ...i, status: "expired", updatedAt: now },
              i.version,
            );
            return {
              id: i.id,
              recipient: i.recipient,
              role: i.proposedRole,
              status: "expired" as const,
              expiresAt: i.expiresAt,
            };
          }
          return {
            id: i.id,
            recipient: i.recipient,
            role: i.proposedRole,
            status: i.status,
            expiresAt: i.expiresAt,
          };
        }),
      );
    });
  }
  public async invite(
    actor: UserId,
    workspacePublicId: string,
    emailValue: string,
    roleValue: string,
  ): Promise<void> {
    const email = createNormalizedEmail(createEmailAddress(emailValue)),
      role = invitationRole(roleValue);
    let proof!: ReturnType<InvitationProofProvider["create"]>;
    const issued = await this.withActor(
        actor,
        workspacePublicId,
        async (r, w, a) => {
          if (a.role !== "owner" && a.role !== "administrator")
            throw new WorkspaceAdministrationError();
          await this.limits?.enforce(
            abuseScope("workspace", w.id, "actor", actor),
            "actor",
            workspaceInvitationActorLimit,
          );
          await this.limits?.enforce(
            abuseScope("workspace", w.id),
            "company",
            workspaceInvitationWorkspaceLimit,
          );
          proof = this.proofs.create();
          const now = this.clock.now(),
            current = await r.invitations.findCurrent(w.id, email);
          if (
            current &&
            !(await r.invitations.update(
              {
                ...current,
                status: "superseded",
                supersededAt: now,
                updatedAt: now,
              },
              current.version,
            ))
          )
            throw new WorkspaceAdministrationConflict();
          const invitation: Invitation = {
            id: this.id("inv"),
            workspaceId: w.id,
            issuerMembershipId: a.id,
            issuerUserId: actor,
            recipient: email,
            proposedRole: role,
            purpose: "workspace_invitation",
            digestVersion: "sha256-v1",
            proofDigest: proof.digest,
            status: "pending",
            deliveryStatus: "pending",
            version: 1,
            issuedAt: now,
            expiresAt: new Date(
              Date.parse(now) + this.invitationLifetimeMs,
            ).toISOString(),
            acceptedAt: null,
            acceptedByUserId: null,
            acceptedIp: null,
            acceptedUserAgent: null,
            rejectedAt: null,
            revokedAt: null,
            supersededAt: null,
            updatedAt: now,
          };
          await r.invitations.create(invitation);
          return { invitation, workspaceName: w.name };
        },
      ),
      outcome = await this.delivery.deliver({
        recipient: email,
        workspaceName: issued.workspaceName,
        role,
        acceptanceUrl: `${this.invitationOrigin}/accept-invitation?proof=${encodeURIComponent(proof.raw)}`,
        expiresAt: issued.invitation.expiresAt,
        invitationId: issued.invitation.id,
      });
    await this.tx.execute(async (r) => {
      await r.invitations.setDeliveryStatus(
        issued.invitation.id,
        outcome,
        this.clock.now(),
      );
      if (outcome === "permanent_failure") {
        const current = await r.invitations.findById(issued.invitation.id);
        if (
          current?.status === "pending" &&
          !(await r.invitations.update(
            {
              ...current,
              status: "revoked",
              revokedAt: this.clock.now(),
              updatedAt: this.clock.now(),
            },
            current.version,
          ))
        )
          throw new WorkspaceAdministrationConflict();
      }
    });
  }
  public async accept(
    userId: UserId,
    rawProof: string,
    ip: string,
    userAgent: string,
  ) {
    const proof = this.proofs.parse(rawProof);
    if (!proof) throw new WorkspaceAdministrationError();
    return this.tx.execute(async (r) => {
      const now = this.clock.now(),
        user = await r.users.findById(userId),
        invitation = await r.invitations.findByDigest(proof.digest);
      if (
        !user ||
        user.status !== "active" ||
        !invitation ||
        !invitationCurrent(invitation, now) ||
        !(await r.workspaces.findById(invitation.workspaceId)) ||
        !user.authenticationIdentities.some(
          (i) => i.emailVerified && i.normalizedEmail === invitation.recipient,
        )
      )
        throw new WorkspaceAdministrationError();
      if (await r.memberships.findCurrent(user.id, invitation.workspaceId))
        throw new WorkspaceAdministrationConflict();
      const member = this.membership(
        invitation.workspaceId,
        user.id,
        invitation.proposedRole,
        now,
      );
      await r.memberships.create(member);
      if (
        !(await r.invitations.update(
          {
            ...invitation,
            status: "accepted",
            acceptedAt: now,
            acceptedByUserId: user.id,
            acceptedIp: ip.slice(0, 128),
            acceptedUserAgent: userAgent.slice(0, 512),
            updatedAt: now,
          },
          invitation.version,
        ))
      )
        throw new WorkspaceAdministrationConflict();
      return member;
    });
  }
  public async reject(userId: UserId, rawProof: string) {
    const proof = this.proofs.parse(rawProof);
    if (!proof) throw new WorkspaceAdministrationError();
    return this.tx.execute(async (r) => {
      const now = this.clock.now(),
        user = await r.users.findById(userId),
        invitation = await r.invitations.findByDigest(proof.digest);
      if (
        !user ||
        user.status !== "active" ||
        !invitation ||
        !invitationCurrent(invitation, now) ||
        !user.authenticationIdentities.some(
          (i) => i.emailVerified && i.normalizedEmail === invitation.recipient,
        ) ||
        !(await r.invitations.update(
          {
            ...invitation,
            status: "rejected",
            rejectedAt: now,
            updatedAt: now,
          },
          invitation.version,
        ))
      )
        throw new WorkspaceAdministrationError();
    });
  }
  public async invitationAction(
    actor: UserId,
    workspacePublicId: string,
    invitationId: string,
    action: "rejected" | "revoked",
  ) {
    return this.withActor(actor, workspacePublicId, async (r, w, a) => {
      const invitation = await r.invitations.findById(invitationId);
      if (
        !invitation ||
        invitation.workspaceId !== w.id ||
        invitation.status !== "pending" ||
        (action === "revoked" &&
          a.role !== "owner" &&
          a.role !== "administrator") ||
        (action === "rejected" && a.userId !== actor)
      )
        throw new WorkspaceAdministrationError();
      const now = this.clock.now();
      if (
        !(await r.invitations.update(
          {
            ...invitation,
            status: action,
            rejectedAt: action === "rejected" ? now : null,
            revokedAt: action === "revoked" ? now : null,
            updatedAt: now,
          },
          invitation.version,
        ))
      )
        throw new WorkspaceAdministrationConflict();
    });
  }
  public async changeMembership(
    actor: UserId,
    workspacePublicId: string,
    targetId: string,
    operation: "suspend" | "reactivate" | "remove" | "role",
    roleValue?: string,
  ) {
    return this.withActor(actor, workspacePublicId, async (r, w, a) => {
      const target = await r.memberships.findById(targetId as MembershipId);
      if (
        !target ||
        target.workspaceId !== w.id ||
        !mayManageMembership(a, target)
      )
        throw new WorkspaceAdministrationError();
      const now = this.clock.now();
      let role = target.role,
        status = target.status;
      if (operation === "role") {
        role = membershipRole(roleValue ?? "");
        if (
          a.role === "administrator" &&
          role !== "operator" &&
          role !== "viewer"
        )
          throw new WorkspaceAdministrationError();
        if (
          role === "owner" &&
          target.role !== "owner" &&
          !(await this.mayOwn(r, target.userId))
        )
          throw new WorkspaceAdministrationError();
      }
      if (operation === "suspend") status = "suspended";
      if (operation === "reactivate") {
        if (target.status !== "suspended")
          throw new WorkspaceAdministrationError();
        status = "active";
      }
      if (operation === "remove") status = "removed";
      if (target.status === "removed") throw new WorkspaceAdministrationError();
      this.owners.assertTransition(
        target,
        role,
        status,
        await r.memberships.countActiveOwners(w.id),
      );
      const next = {
        ...target,
        role,
        status,
        suspendedAt: operation === "suspend" ? now : target.suspendedAt,
        reactivatedAt: operation === "reactivate" ? now : target.reactivatedAt,
        removedAt: operation === "remove" ? now : target.removedAt,
        roleChangedAt: operation === "role" ? now : target.roleChangedAt,
      };
      if (!(await r.memberships.update(next, target.version)))
        throw new WorkspaceAdministrationConflict();
      if (status !== "active") await r.selections.clear(target.userId, w.id);
    });
  }
  public async leave(userId: UserId, workspacePublicId: string) {
    return this.withActor(userId, workspacePublicId, async (r, w, member) => {
      this.owners.assertTransition(
        member,
        member.role,
        "removed",
        await r.memberships.countActiveOwners(w.id),
      );
      const now = this.clock.now();
      if (
        !(await r.memberships.update(
          { ...member, status: "removed", removedAt: now },
          member.version,
        ))
      )
        throw new WorkspaceAdministrationConflict();
      await r.selections.clear(userId, w.id);
    });
  }
  public async transfer(
    actor: UserId,
    workspacePublicId: string,
    targetId: string,
    actorRole?: string,
  ) {
    return this.withActor(actor, workspacePublicId, async (r, w, a) => {
      if (a.role !== "owner") throw new WorkspaceAdministrationError();
      const target = await r.memberships.findById(targetId as MembershipId);
      if (
        !target ||
        target.workspaceId !== w.id ||
        target.status !== "active" ||
        (target.role !== "owner" && !(await this.mayOwn(r, target.userId)))
      )
        throw new WorkspaceAdministrationError();
      const nextActorRole = actorRole ? membershipRole(actorRole) : "owner",
        finalOwners =
          (await r.memberships.countActiveOwners(w.id)) +
          (target.role === "owner" ? 0 : 1) -
          (a.role === "owner" && nextActorRole !== "owner" ? 1 : 0);
      this.owners.assertFinalOwnerCount(finalOwners);
      const now = this.clock.now();
      if (
        target.role !== "owner" &&
        !(await r.memberships.update(
          { ...target, role: "owner", roleChangedAt: now },
          target.version,
        ))
      )
        throw new WorkspaceAdministrationConflict();
      if (
        nextActorRole !== a.role &&
        !(await r.memberships.update(
          { ...a, role: nextActorRole, roleChangedAt: now },
          a.version,
        ))
      )
        throw new WorkspaceAdministrationConflict();
    });
  }
  private async mayOwn(
    r: WorkspaceAdministrationRepositories,
    userId: UserId,
  ): Promise<boolean> {
    return (
      (await r.commercial.ownedWorkspaceCount(userId)) <
      (await r.commercial.ownedWorkspaceLimit(userId))
    );
  }
  private async withActor<T>(
    userId: UserId,
    publicId: string,
    operation: (
      r: WorkspaceAdministrationRepositories,
      w: Workspace,
      m: Membership,
    ) => Promise<T>,
  ): Promise<T> {
    return await this.tx.execute(async (r) => {
      const user = await r.users.findById(userId),
        workspace = await r.workspaces.findByPublicId(
          publicId as WorkspacePublicId,
        );
      if (!user || user.status !== "active" || !workspace)
        throw new WorkspaceAdministrationError();
      const member = await r.memberships.findCurrent(userId, workspace.id);
      if (!member || member.status !== "active")
        throw new WorkspaceAdministrationError();
      return operation(r, workspace, member);
    });
  }
  private timezone(value: string | undefined): string | null {
    if (value === undefined) return null;
    const normalized = value.trim();
    if (!normalized || normalized.length > 100)
      throw new WorkspaceAdministrationError();
    try {
      new Intl.DateTimeFormat("en", { timeZone: normalized });
    } catch {
      throw new WorkspaceAdministrationError();
    }
    return normalized;
  }
  private defaultLocale(value: string | undefined): "en" | "es" | null {
    if (value === undefined) return null;
    if (value !== "en" && value !== "es")
      throw new WorkspaceAdministrationError();
    return value;
  }
  private membership(
    workspaceId: number,
    userId: UserId,
    role: MembershipRole,
    now: string,
  ): Membership {
    return {
      id: this.id("mem") as MembershipId,
      workspaceId,
      userId,
      role,
      status: "active",
      version: 1,
      createdAt: now,
      activatedAt: now,
      suspendedAt: null,
      reactivatedAt: null,
      removedAt: null,
      roleChangedAt: null,
    };
  }
  private id(prefix: string): string {
    return `${prefix}_${randomUUID().replaceAll("-", "")}`;
  }
}
