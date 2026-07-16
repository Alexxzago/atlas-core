import type { NormalizedEmail } from "../../identity/domain/email.js";
import type { User,UserId } from "../../identity/domain/user.js";
import type { Workspace } from "../../types/workspace.js";
import type { Invitation,InvitationDeliveryStatus } from "../domain/invitation.js";
import type { Membership,MembershipId,WorkspacePublicId } from "../domain/membership.js";
export interface MembershipRepositoryPort{findById(id:MembershipId):Membership|null;findCurrent(userId:UserId,workspaceId:number):Membership|null;listForUser(userId:UserId):Membership[];listForWorkspace(workspaceId:number):Membership[];countActiveOwners(workspaceId:number):number;create(value:Membership):Membership;update(value:Membership,expectedVersion:number):boolean;}
export interface InvitationRepositoryPort{findById(id:string):Invitation|null;findByDigest(digest:string):Invitation|null;findCurrent(workspaceId:number,email:NormalizedEmail):Invitation|null;listForWorkspace(workspaceId:number):Invitation[];create(value:Invitation):Invitation;update(value:Invitation,expectedVersion:number):boolean;setDeliveryStatus(id:string,status:InvitationDeliveryStatus,at:string):boolean;}
export interface WorkspaceSelectionRepository{find(userId:UserId):number|null;save(userId:UserId,workspaceId:number,at:string):void;clear(userId:UserId,workspaceId?:number):void;}
export interface WorkspaceAdministrationWorkspaceRepository{findById(id:number):Workspace|null;findByPublicId(id:WorkspacePublicId):Workspace|null;create(input:{publicId:WorkspacePublicId;key:string;name:string}):Workspace;}
export interface WorkspaceAdministrationUserRepository{findById(id:UserId):User|null;findByNormalizedEmail(email:NormalizedEmail):User|null;}
export interface WorkspaceAdministrationRepositories{users:WorkspaceAdministrationUserRepository;workspaces:WorkspaceAdministrationWorkspaceRepository;memberships:MembershipRepositoryPort;invitations:InvitationRepositoryPort;selections:WorkspaceSelectionRepository;}
export interface WorkspaceAdministrationTransactionPort{execute<T>(operation:(repositories:WorkspaceAdministrationRepositories)=>T):T;}
export interface InvitationProof{raw:string;digest:string;version:"sha256-v1";}
export interface InvitationProofProvider{create():InvitationProof;parse(raw:string):InvitationProof|null;}
export interface InvitationDeliveryRequest{recipient:string;workspaceName:string;role:string;acceptanceUrl:string;expiresAt:string;invitationId:string;}
export interface InvitationDeliveryPort{deliver(request:InvitationDeliveryRequest):Promise<InvitationDeliveryStatus>;}
