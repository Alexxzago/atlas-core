import type { UserId } from "../../identity/domain/user.js";

export type MembershipId=string&{readonly __brand:"MembershipId"};
export type WorkspacePublicId=string&{readonly __brand:"WorkspacePublicId"};
export type MembershipRole="owner"|"administrator"|"operator"|"viewer";
export type MembershipStatus="active"|"suspended"|"removed";
export type Permission="workspace:read"|"workspace:manage"|"company:read"|"company:manage"|"onboarding:run"|"chat:use"|"membership:list"|"membership:invite"|"membership:manage"|"administrator:manage"|"owner:manage"|"owner:transfer";
export interface PermissionSet extends Iterable<Permission>{readonly size:number;has(value:Permission):boolean;}

export interface Membership{readonly id:MembershipId;readonly workspaceId:number;readonly userId:UserId;readonly role:MembershipRole;readonly status:MembershipStatus;readonly version:number;readonly createdAt:string;readonly activatedAt:string;readonly suspendedAt:string|null;readonly reactivatedAt:string|null;readonly removedAt:string|null;readonly roleChangedAt:string|null;}
export class MembershipPolicyError extends Error{}
export function membershipRole(value:string):MembershipRole{if(value!=="owner"&&value!=="administrator"&&value!=="operator"&&value!=="viewer")throw new MembershipPolicyError("Unknown Membership role.");return value;}
export function membershipStatus(value:string):MembershipStatus{if(value!=="active"&&value!=="suspended"&&value!=="removed")throw new MembershipPolicyError("Unknown Membership status.");return value;}

export class PermissionPolicy{
  public derive(role:MembershipRole):PermissionSet{const read:Permission[]=["workspace:read","company:read"];const operator:Permission[]=[...read,"company:manage","onboarding:run","chat:use"];const administrator:Permission[]=[...operator,"workspace:manage","membership:list","membership:invite","membership:manage"];const values:Permission[]=role==="owner"?[...administrator,"administrator:manage","owner:manage","owner:transfer"]:role==="administrator"?administrator:role==="operator"?operator:role==="viewer"?read:[];return new ImmutablePermissionSet(values);}
  public allows(role:MembershipRole,permission:Permission):boolean{return this.derive(role).has(permission);}
}
class ImmutablePermissionSet implements PermissionSet{private readonly items:Set<Permission>;public constructor(values:readonly Permission[]){this.items=new Set(values);Object.freeze(this);}public get size(){return this.items.size;}public has(value:Permission){return this.items.has(value);}[Symbol.iterator](){return this.items[Symbol.iterator]();}}

export class LastOwnerPolicy{
  public assertFinalOwnerCount(count:number):void{if(!Number.isInteger(count)||count<1)throw new MembershipPolicyError("Workspace must retain an active Owner.");}
  public assertTransition(current:Membership,proposedRole:MembershipRole,proposedStatus:MembershipStatus,currentActiveOwners:number):void{const losesOwner=current.role==="owner"&&current.status==="active"&&(proposedRole!=="owner"||proposedStatus!=="active");this.assertFinalOwnerCount(currentActiveOwners-(losesOwner?1:0));}
}

export function mayManageMembership(actor:Membership,target:Membership):boolean{if(actor.status!=="active"||actor.workspaceId!==target.workspaceId)return false;if(actor.role==="owner")return true;if(actor.role!=="administrator")return false;return target.role==="operator"||target.role==="viewer";}
