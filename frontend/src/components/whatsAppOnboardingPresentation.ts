import type { WhatsAppConnectionOperationalStatus } from "../types/api";

export type WhatsAppStageId = "meta" | "connection" | "credential" | "validation" | "activation" | "working";
export type WhatsAppStageState = "complete" | "current" | "future" | "blocked";
export type WhatsAppNextAction = "create" | "saveCredential" | "validate" | "activate" | "test" | "replaceCredential";
export type WhatsAppFailureKind = "credential" | "permission" | "identity" | "rateLimited" | "providerUnavailable" | "providerRejected" | "unknown";
export interface WhatsAppStage { readonly id: WhatsAppStageId; readonly state: WhatsAppStageState; }
export interface WhatsAppOnboardingViewModel { readonly stages: readonly WhatsAppStage[]; readonly currentStage: WhatsAppStageId; readonly nextAction: WhatsAppNextAction; readonly failure: WhatsAppFailureKind | null; readonly lastActivityAt: string | null; }

export function mapWhatsAppFailureToCustomerMessage(code: string | null): WhatsAppFailureKind | null {
  if (!code) return null;
  if (code === "credentials_invalid" || code === "invalid_credentials") return "credential";
  if (code === "insufficient_permissions") return "permission";
  if (code === "provider_identity_mismatch" || code === "phone_number_not_found" || code === "business_account_mismatch") return "identity";
  if (code === "rate_limited") return "rateLimited";
  if (code === "provider_unavailable" || code === "provider_timeout") return "providerUnavailable";
  if (code === "provider_rejected") return "providerRejected";
  return "unknown";
}

export function buildWhatsAppOnboardingViewModel(status: WhatsAppConnectionOperationalStatus): WhatsAppOnboardingViewModel {
  const valid = status.validationState === "valid";
  const active = status.connection.status === "active";
  const currentStage: WhatsAppStageId = !status.credentialsConfigured || status.validationState === "invalid" ? "credential" : !valid ? "validation" : !active ? "activation" : "working";
  const ordered: readonly WhatsAppStageId[] = ["meta", "connection", "credential", "validation", "activation", "working"];
  const stages = ordered.map((id): WhatsAppStage => ({ id, state: buildWhatsAppStageState(id, currentStage, status) }));
  const nextAction: WhatsAppNextAction = currentStage === "credential" ? "saveCredential" : currentStage === "validation" ? "validate" : currentStage === "activation" ? "activate" : "test";
  return { stages, currentStage, nextAction, failure: mapWhatsAppFailureToCustomerMessage(status.validationFailureCode ?? status.healthFailureCode), lastActivityAt: latest(status.lastProviderActivityAt, status.lastWebhookActivityAt) };
}

export function buildWhatsAppStageState(id:WhatsAppStageId,current:WhatsAppStageId,status:WhatsAppConnectionOperationalStatus):WhatsAppStageState {
  if(id===current)return "current";
  if(id==="connection")return "complete";
  if(id==="meta")return status.validationState==="valid"?"complete":"future";
  if(id==="credential")return status.credentialsConfigured?"complete":"future";
  if(id==="validation")return status.validationState==="valid"?"complete":"future";
  if(id==="activation")return status.connection.status==="active"?"complete":"future";
  return "future";
}

function latest(first: string | null, second: string | null): string | null {
  if (!first) return second; if (!second) return first; return Date.parse(first) >= Date.parse(second) ? first : second;
}
