import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { ConversationMessage } from "../../conversation/domain/conversation.js";
import type { AudioTranscriptionRequest, ConversationAudioTranscript, VoiceAudioResponseMode, VoiceMessageReadModel, VoicePlayback, VoiceResponseVisibility, VoiceSynthesisRequest, VoiceTranscriptOutcome, VoiceWorkState, WhatsAppOutboundMediaUpload, WhatsAppVoicePolicy } from "../domain/voice.js";
import type { WhatsAppOutboundMediaUploadResult } from "./outboundMediaUploadPort.js";

export interface VoicePolicyMutation { readonly actorId:string; readonly operationId:string; readonly expectedVersion:number; readonly voiceAiEnabled:boolean; readonly audioResponseMode:VoiceAudioResponseMode; readonly occurredAt:string; }
export type VoicePolicyMutationResult = { readonly kind:"applied"|"replayed_applied"; readonly policy:WhatsAppVoicePolicy } | { readonly kind:"stale_version"|"replayed_stale"; readonly policy:WhatsAppVoicePolicy|null } | { readonly kind:"replay_mismatch"|"not_found" };
export interface TranscriptCreate { readonly id:string; readonly conversationId:string; readonly messageId:string; readonly mediaAssetId:string; readonly normalizedTranscript:string; readonly languageTag:string|null; readonly inputDigest:string; readonly outcome:VoiceTranscriptOutcome; readonly safeFailureCategory:string|null; readonly createdAt:string; }
export type TranscriptCreateResult = { readonly kind:"created"|"replayed"; readonly transcript:ConversationAudioTranscript } | { readonly kind:"conflict"|"not_found" };
export interface VoiceLease { readonly owner:string; readonly now:string; readonly expiresAt:string; readonly limit:number; }
export interface VoiceWorkSettlement { readonly state:Exclude<VoiceWorkState,"pending"|"leased">; readonly safeOutcome:string|null; readonly safeFailureCategory:string|null; readonly completedAt:string|null; readonly updatedAt:string; }
export interface TranscriptionFinalization { readonly transcript:TranscriptCreate; readonly settlement:VoiceWorkSettlement; }
export type TranscriptionFinalizationResult = { readonly kind:"opened"|"suppressed"; readonly request:AudioTranscriptionRequest; readonly transcript:ConversationAudioTranscript } | { readonly kind:"lease_lost"|"conflict" };
export type SynthesisFinalization = { readonly kind:"completed"; readonly mediaAssetId:string; readonly updatedAt:string } | { readonly kind:"failed"; readonly safeFailureCategory:string; readonly updatedAt:string } | { readonly kind:"retryable"; readonly safeFailureCategory:string; readonly updatedAt:string };
export type SynthesisAuthorizationResult = { readonly kind:"authorized"; readonly text:string } | { readonly kind:"suppressed"|"lease_lost" };
export interface VoiceRepositoryPort {
  findPolicy(context:WorkspaceContext,companyId:number,connectionId:string):WhatsAppVoicePolicy|null;
  applyPolicy(context:WorkspaceContext,companyId:number,connectionId:string,command:VoicePolicyMutation):VoicePolicyMutationResult;
  createTranscript(context:WorkspaceContext,companyId:number,value:TranscriptCreate):TranscriptCreateResult;
  findTranscriptByMessage(context:WorkspaceContext,companyId:number,messageId:string):ConversationAudioTranscript|null;
  isVoiceInboundMessage(context:WorkspaceContext,companyId:number,messageId:string):boolean;
  isAssistantMessageSemanticallyVisible(context:WorkspaceContext,companyId:number,messageId:string):boolean;
  findCompletedInboundTranscriptMessages(context:WorkspaceContext,companyId:number,limit:number):readonly ConversationMessage[];
  findVisibleDeferredAssistantMessages(context:WorkspaceContext,companyId:number,limit:number):readonly ConversationMessage[];
  recoverableSemanticScopes(limit:number):readonly {readonly workspaceId:number;readonly companyId:number}[];
  enqueueTranscription(context:WorkspaceContext,companyId:number,value:Omit<AudioTranscriptionRequest,"state"|"leaseOwner"|"leaseExpiresAt"|"attemptCount"|"safeOutcome"|"safeFailureCategory"|"completedAt">):{readonly kind:"created"|"replayed"|"conflict"|"not_found";readonly request?:AudioTranscriptionRequest};
  enqueueTranscriptionAndBlockExecution(context:WorkspaceContext,companyId:number,connectionId:string,eventId:string,value:{readonly id:string;readonly mediaAssetId:string;readonly createdAt:string;readonly updatedAt:string}):{readonly kind:"created"|"replayed"|"conflict"|"not_found";readonly request?:AudioTranscriptionRequest};
  enqueueSynthesis(context:WorkspaceContext,companyId:number,value:Omit<VoiceSynthesisRequest,"state"|"leaseOwner"|"leaseExpiresAt"|"attemptCount"|"safeOutcome"|"safeFailureCategory"|"completedAt"|"renditionSettlementId">):{readonly kind:"created"|"replayed"|"conflict"|"not_found";readonly request?:VoiceSynthesisRequest};
  leaseTranscriptions(context:WorkspaceContext,companyId:number,lease:VoiceLease):readonly AudioTranscriptionRequest[];
  leaseSynthesis(context:WorkspaceContext,companyId:number,lease:VoiceLease):readonly VoiceSynthesisRequest[];
  settleTranscription(context:WorkspaceContext,companyId:number,id:string,owner:string,settlement:VoiceWorkSettlement):AudioTranscriptionRequest|null;
  finalizeTranscription(context:WorkspaceContext,companyId:number,id:string,owner:string,value:TranscriptionFinalization):TranscriptionFinalizationResult;
  settleSynthesis(context:WorkspaceContext,companyId:number,id:string,owner:string,settlement:VoiceWorkSettlement):VoiceSynthesisRequest|null;
  authorizeSynthesis(context:WorkspaceContext,companyId:number,id:string,owner:string,at:string):SynthesisAuthorizationResult;
  finalizeSynthesis(context:WorkspaceContext,companyId:number,id:string,owner:string,value:SynthesisFinalization):VoiceSynthesisRequest|null;
  createUpload(context:WorkspaceContext,companyId:number,value:Omit<WhatsAppOutboundMediaUpload,"state"|"leaseOwner"|"leaseExpiresAt"|"attemptCount"|"providerMediaId"|"safeErrorCategory">):{readonly kind:"created"|"replayed"|"conflict"|"not_found";readonly upload?:WhatsAppOutboundMediaUpload};
  leaseUploads(context:WorkspaceContext,companyId:number,lease:VoiceLease):readonly WhatsAppOutboundMediaUpload[];
  settleUpload(context:WorkspaceContext,companyId:number,id:string,owner:string,state:Exclude<import("../domain/voice.js").VoiceUploadState,"pending_upload"|"uploading">,providerMediaId:string|null,safeErrorCategory:string|null,updatedAt:string):WhatsAppOutboundMediaUpload|null;
  authorizeUpload(context:WorkspaceContext,companyId:number,id:string,owner:string,at:string):{readonly kind:"authorized";readonly connectionId:string;readonly mediaType:string;readonly filename:string|null}|{readonly kind:"suppressed"|"lease_lost"};
  finalizeUpload(context:WorkspaceContext,companyId:number,id:string,owner:string,result:WhatsAppOutboundMediaUploadResult,at:string):WhatsAppOutboundMediaUpload|null;
  findUploadedProviderMediaId(context:WorkspaceContext,companyId:number,outboundDeliveryId:string):string|null;
  appendVisibility(context:WorkspaceContext,companyId:number,value:VoiceResponseVisibility):{readonly kind:"created"|"replayed"|"conflict"|"not_found";readonly visibility?:VoiceResponseVisibility};
  findVisibility(context:WorkspaceContext,companyId:number,messageId:string,outboundDeliveryId:string):VoiceResponseVisibility|null;
  findMessageReadModel(context:WorkspaceContext,companyId:number,conversationId:string,messageId:string):VoiceMessageReadModel|null;
  findPlayback(context:WorkspaceContext,companyId:number,conversationId:string,messageId:string):VoicePlayback|null;
}

/** Read-only voice persistence boundary for async production runtimes. */
export interface AsyncVoiceLookupPort {
  findPolicy(context:WorkspaceContext,companyId:number,connectionId:string):Promise<WhatsAppVoicePolicy|null>;
  findTranscriptByMessage(context:WorkspaceContext,companyId:number,messageId:string):Promise<ConversationAudioTranscript|null>;
  isVoiceInboundMessage(context:WorkspaceContext,companyId:number,messageId:string):Promise<boolean>;
  isAssistantMessageSemanticallyVisible(context:WorkspaceContext,companyId:number,messageId:string):Promise<boolean>;
  findCompletedInboundTranscriptMessages(context:WorkspaceContext,companyId:number,limit:number):Promise<readonly ConversationMessage[]>;
  findVisibleDeferredAssistantMessages(context:WorkspaceContext,companyId:number,limit:number):Promise<readonly ConversationMessage[]>;
  recoverableSemanticScopes(limit:number):Promise<readonly {readonly workspaceId:number;readonly companyId:number}[]>;
  findUploadedProviderMediaId(context:WorkspaceContext,companyId:number,outboundDeliveryId:string):Promise<string|null>;
  findMessageReadModel(context:WorkspaceContext,companyId:number,conversationId:string,messageId:string):Promise<VoiceMessageReadModel|null>;
  findPlayback(context:WorkspaceContext,companyId:number,conversationId:string,messageId:string):Promise<VoicePlayback|null>;
}

/** Async write and queue boundary for production voice persistence. */
export interface AsyncVoiceRepositoryPort extends AsyncVoiceLookupPort {
  recoverableVoiceWorkScopes(limit:number):Promise<readonly {readonly workspaceId:number;readonly companyId:number}[]>;
  applyPolicy(context:WorkspaceContext,companyId:number,connectionId:string,command:VoicePolicyMutation):Promise<VoicePolicyMutationResult>;
  createTranscript(context:WorkspaceContext,companyId:number,value:TranscriptCreate):Promise<TranscriptCreateResult>;
  enqueueTranscription(context:WorkspaceContext,companyId:number,value:Omit<AudioTranscriptionRequest,"state"|"leaseOwner"|"leaseExpiresAt"|"attemptCount"|"safeOutcome"|"safeFailureCategory"|"completedAt">):Promise<{readonly kind:"created"|"replayed"|"conflict"|"not_found";readonly request?:AudioTranscriptionRequest}>;
  enqueueTranscriptionAndBlockExecution(context:WorkspaceContext,companyId:number,connectionId:string,eventId:string,value:{readonly id:string;readonly mediaAssetId:string;readonly createdAt:string;readonly updatedAt:string}):Promise<{readonly kind:"created"|"replayed"|"conflict"|"not_found";readonly request?:AudioTranscriptionRequest}>;
  enqueueSynthesis(context:WorkspaceContext,companyId:number,value:Omit<VoiceSynthesisRequest,"state"|"leaseOwner"|"leaseExpiresAt"|"attemptCount"|"safeOutcome"|"safeFailureCategory"|"completedAt"|"renditionSettlementId">):Promise<{readonly kind:"created"|"replayed"|"conflict"|"not_found";readonly request?:VoiceSynthesisRequest}>;
  leaseTranscriptions(context:WorkspaceContext,companyId:number,lease:VoiceLease):Promise<readonly AudioTranscriptionRequest[]>;
  leaseSynthesis(context:WorkspaceContext,companyId:number,lease:VoiceLease):Promise<readonly VoiceSynthesisRequest[]>;
  settleTranscription(context:WorkspaceContext,companyId:number,id:string,owner:string,settlement:VoiceWorkSettlement):Promise<AudioTranscriptionRequest|null>;
  finalizeTranscription(context:WorkspaceContext,companyId:number,id:string,owner:string,value:TranscriptionFinalization):Promise<TranscriptionFinalizationResult>;
  settleSynthesis(context:WorkspaceContext,companyId:number,id:string,owner:string,settlement:VoiceWorkSettlement):Promise<VoiceSynthesisRequest|null>;
  authorizeSynthesis(context:WorkspaceContext,companyId:number,id:string,owner:string,at:string):Promise<SynthesisAuthorizationResult>;
  finalizeSynthesis(context:WorkspaceContext,companyId:number,id:string,owner:string,value:SynthesisFinalization):Promise<VoiceSynthesisRequest|null>;
  createUpload(context:WorkspaceContext,companyId:number,value:Omit<WhatsAppOutboundMediaUpload,"state"|"leaseOwner"|"leaseExpiresAt"|"attemptCount"|"providerMediaId"|"safeErrorCategory">):Promise<{readonly kind:"created"|"replayed"|"conflict"|"not_found";readonly upload?:WhatsAppOutboundMediaUpload}>;
  leaseUploads(context:WorkspaceContext,companyId:number,lease:VoiceLease):Promise<readonly WhatsAppOutboundMediaUpload[]>;
  settleUpload(context:WorkspaceContext,companyId:number,id:string,owner:string,state:Exclude<import("../domain/voice.js").VoiceUploadState,"pending_upload"|"uploading">,providerMediaId:string|null,safeErrorCategory:string|null,updatedAt:string):Promise<WhatsAppOutboundMediaUpload|null>;
  authorizeUpload(context:WorkspaceContext,companyId:number,id:string,owner:string,at:string):Promise<{readonly kind:"authorized";readonly connectionId:string;readonly mediaType:string;readonly filename:string|null}|{readonly kind:"suppressed"|"lease_lost"}>;
  finalizeUpload(context:WorkspaceContext,companyId:number,id:string,owner:string,result:WhatsAppOutboundMediaUploadResult,at:string):Promise<WhatsAppOutboundMediaUpload|null>;
  appendVisibility(context:WorkspaceContext,companyId:number,value:VoiceResponseVisibility):Promise<{readonly kind:"created"|"replayed"|"conflict"|"not_found";readonly visibility?:VoiceResponseVisibility}>;
}
