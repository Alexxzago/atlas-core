import type { NormalizedEmail } from "../../identity/domain/email.js";
import type { User,UserId } from "../../identity/domain/user.js";
import type { Workspace } from "../../types/workspace.js";
import type { Invitation,InvitationDeliveryStatus } from "../domain/invitation.js";
import type { Membership,MembershipId,WorkspacePublicId } from "../domain/membership.js";
type MaybePromise<T>=T|Promise<T>;
export interface MembershipRepositoryPort{findById(id:MembershipId):MaybePromise<Membership|null>;findCurrent(userId:UserId,workspaceId:number):MaybePromise<Membership|null>;listForUser(userId:UserId):MaybePromise<readonly Membership[]>;listForWorkspace(workspaceId:number):MaybePromise<readonly Membership[]>;countActiveOwners(workspaceId:number):MaybePromise<number>;create(value:Membership):MaybePromise<Membership>;update(value:Membership,expectedVersion:number):MaybePromise<boolean>;}
export interface InvitationRepositoryPort{findById(id:string):MaybePromise<Invitation|null>;findByDigest(digest:string):MaybePromise<Invitation|null>;findCurrent(workspaceId:number,email:NormalizedEmail):MaybePromise<Invitation|null>;listForWorkspace(workspaceId:number):MaybePromise<readonly Invitation[]>;create(value:Invitation):MaybePromise<Invitation>;update(value:Invitation,expectedVersion:number):MaybePromise<boolean>;setDeliveryStatus(id:string,status:InvitationDeliveryStatus,at:string):MaybePromise<boolean>;}
export interface WorkspaceSelectionRepository{find(userId:UserId):MaybePromise<number|null>;save(userId:UserId,workspaceId:number,at:string):MaybePromise<void>;clear(userId:UserId,workspaceId?:number):MaybePromise<void>;}
export interface WorkspaceAdministrationWorkspaceRepository{findById(id:number):MaybePromise<Workspace|null>;findByPublicId(id:WorkspacePublicId):MaybePromise<Workspace|null>;findByKey(key:string):MaybePromise<Workspace|null>;create(input:{publicId:WorkspacePublicId;key:string;name:string;timezone:string|null;defaultLocale:"en"|"es"|null}):MaybePromise<Workspace>;}
export interface WorkspaceAdministrationUserRepository{findById(id:UserId):MaybePromise<User|null>;findByNormalizedEmail(email:NormalizedEmail):MaybePromise<User|null>;}
export interface WorkspaceCommercialRepository{ownedWorkspaceCount(userId:UserId):MaybePromise<number>;ownedWorkspaceLimit(userId:UserId):MaybePromise<number>;}
export interface WorkspaceAdministrationRepositories{users:WorkspaceAdministrationUserRepository;workspaces:WorkspaceAdministrationWorkspaceRepository;memberships:MembershipRepositoryPort;invitations:InvitationRepositoryPort;selections:WorkspaceSelectionRepository;commercial:WorkspaceCommercialRepository;}
export interface WorkspaceAdministrationTransactionPort{execute<T>(operation:(repositories:WorkspaceAdministrationRepositories)=>Promise<T>):Promise<T>;}
export interface LegacyWorkspaceAdministrationTransactionPort{execute<T>(operation:(repositories:WorkspaceAdministrationRepositories)=>MaybePromise<T>):MaybePromise<T>;}
export interface InvitationProof{raw:string;digest:string;version:"sha256-v1";}
export interface InvitationProofProvider{create():InvitationProof;parse(raw:string):InvitationProof|null;}
export interface InvitationDeliveryRequest{recipient:string;workspaceName:string;role:string;acceptanceUrl:string;expiresAt:string;invitationId:string;}
export interface InvitationDeliveryPort{deliver(request:InvitationDeliveryRequest):Promise<InvitationDeliveryStatus>;}
