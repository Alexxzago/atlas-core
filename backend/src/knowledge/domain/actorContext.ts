import type { UserId } from "../../identity/domain/user.js";
import type { MembershipId, MembershipRole, PermissionSet } from "../../workspace/domain/membership.js";

export interface ActorContext {
  readonly userId: UserId; readonly membershipId: MembershipId;
  readonly role: MembershipRole; readonly capabilities: PermissionSet;
}

export function createActorContext(value: ActorContext): ActorContext { return Object.freeze({ ...value }); }
export function createSystemActorContext(purpose:string):ActorContext{return Object.freeze({userId:`system:${purpose}` as UserId,membershipId:`system:${purpose}` as MembershipId,role:"owner",capabilities:Object.freeze(new Set()) as PermissionSet});}
