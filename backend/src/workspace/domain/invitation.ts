import type { NormalizedEmail } from "../../identity/domain/email.js";
import type { UserId } from "../../identity/domain/user.js";
import type { MembershipId, MembershipRole } from "./membership.js";
export type InvitationStatus="pending"|"accepted"|"rejected"|"revoked"|"expired"|"superseded";
export type InvitationDeliveryStatus="pending"|"accepted"|"temporary_failure"|"permanent_failure"|"uncertain";
export interface Invitation{readonly id:string;readonly workspaceId:number;readonly issuerMembershipId:MembershipId;readonly issuerUserId:UserId;readonly recipient:NormalizedEmail;readonly proposedRole:Exclude<MembershipRole,"owner">;readonly purpose:"workspace_invitation";readonly digestVersion:"sha256-v1";readonly proofDigest:string;readonly status:InvitationStatus;readonly deliveryStatus:InvitationDeliveryStatus;readonly version:number;readonly issuedAt:string;readonly expiresAt:string;readonly acceptedAt:string|null;readonly acceptedByUserId:UserId|null;readonly acceptedIp:string|null;readonly acceptedUserAgent:string|null;readonly rejectedAt:string|null;readonly revokedAt:string|null;readonly supersededAt:string|null;readonly updatedAt:string;}
export class InvitationPolicyError extends Error{}
export function invitationRole(value:string):Exclude<MembershipRole,"owner">{if(value!=="administrator"&&value!=="operator"&&value!=="viewer")throw new InvitationPolicyError("Invitation role is invalid.");return value;}
export function invitationCurrent(value:Invitation,now:string):boolean{return value.status==="pending"&&Date.parse(now)<Date.parse(value.expiresAt);}
