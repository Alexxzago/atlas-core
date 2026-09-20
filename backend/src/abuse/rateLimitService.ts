import { operationalLogger } from "../observability/operationalLogger.js";
import { SharedRateLimitRepository, type RateLimitPolicy } from "./sharedRateLimitRepository.js";

export class AbuseLimitExceededError extends Error { public constructor(public readonly retryAfterSeconds: number) { super("Request rate limited."); } }

export class RateLimitService {
  public constructor(private readonly limits: SharedRateLimitRepository, private readonly now: () => string) {}
  public async enforce(scope: string, scopeType: "identity" | "actor" | "company", policy: RateLimitPolicy): Promise<void> {
    const result = await this.limits.consume(scope, policy, this.now());
    if (result.allowed) return;
    operationalLogger.warn("abuse_limit_exceeded", { operation: policy.action, scopeType, outcome: "rejected", safeErrorCategory: "rate_limited" });
    throw new AbuseLimitExceededError(result.retryAfterSeconds);
  }
}

export const registrationLimit: RateLimitPolicy = { action: "identity_registration", maximum: 3, windowMilliseconds: 60 * 60 * 1_000 };
export const resendVerificationLimit: RateLimitPolicy = { action: "identity_resend_verification", maximum: 3, windowMilliseconds: 15 * 60 * 1_000 };
export const assistantActorLimit: RateLimitPolicy = { action: "assistant_execution_actor", maximum: 5, windowMilliseconds: 60 * 1_000 };
export const assistantCompanyLimit: RateLimitPolicy = { action: "assistant_execution_company", maximum: 10, windowMilliseconds: 60 * 1_000 };
export const publicWebChatSessionLimit: RateLimitPolicy = { action: "public_web_chat_session", maximum: 5, windowMilliseconds: 60 * 1_000 };
export const publicWebChatCompanyLimit: RateLimitPolicy = { action: "public_web_chat_company", maximum: 30, windowMilliseconds: 60 * 1_000 };
export const billingActorLimit: RateLimitPolicy = { action: "billing_provider_actor", maximum: 5, windowMilliseconds: 15 * 60 * 1_000 };
export const billingWorkspaceLimit: RateLimitPolicy = { action: "billing_provider_workspace", maximum: 20, windowMilliseconds: 60 * 60 * 1_000 };
export const whatsAppValidationActorLimit: RateLimitPolicy = { action: "whatsapp_validation_actor", maximum: 5, windowMilliseconds: 15 * 60 * 1_000 };
export const whatsAppValidationCompanyLimit: RateLimitPolicy = { action: "whatsapp_validation_company", maximum: 10, windowMilliseconds: 60 * 60 * 1_000 };
export const knowledgeIngestionActorLimit: RateLimitPolicy = { action: "knowledge_ingestion_actor", maximum: 3, windowMilliseconds: 15 * 60 * 1_000 };
export const knowledgeIngestionCompanyLimit: RateLimitPolicy = { action: "knowledge_ingestion_company", maximum: 10, windowMilliseconds: 60 * 60 * 1_000 };
export const companyOnboardingActorLimit: RateLimitPolicy = { action: "company_onboarding_actor", maximum: 3, windowMilliseconds: 15 * 60 * 1_000 };
export const companyOnboardingCompanyLimit: RateLimitPolicy = { action: "company_onboarding_company", maximum: 5, windowMilliseconds: 60 * 60 * 1_000 };
export const metaEmbeddedSignupActorLimit: RateLimitPolicy = { action: "meta_embedded_signup_actor", maximum: 3, windowMilliseconds: 15 * 60 * 1_000 };
export const metaEmbeddedSignupCompanyLimit: RateLimitPolicy = { action: "meta_embedded_signup_company", maximum: 5, windowMilliseconds: 60 * 60 * 1_000 };
export const operatorMessageActorLimit: RateLimitPolicy = { action: "operator_message_actor", maximum: 10, windowMilliseconds: 60 * 1_000 };
export const operatorMessageCompanyLimit: RateLimitPolicy = { action: "operator_message_company", maximum: 30, windowMilliseconds: 60 * 1_000 };
export const credentialEnrollmentRequestLimit: RateLimitPolicy = { action: "credential_enrollment_request", maximum: 3, windowMilliseconds: 60 * 60 * 1_000 };
export const passwordResetRequestLimit: RateLimitPolicy = { action: "password_reset_request", maximum: 3, windowMilliseconds: 60 * 60 * 1_000 };
export const workspaceInvitationActorLimit: RateLimitPolicy = { action: "workspace_invitation_actor", maximum: 10, windowMilliseconds: 60 * 60 * 1_000 };
export const workspaceInvitationWorkspaceLimit: RateLimitPolicy = { action: "workspace_invitation_workspace", maximum: 30, windowMilliseconds: 60 * 60 * 1_000 };
export const assistantPreviewActorLimit: RateLimitPolicy = { action: "assistant_preview_actor", maximum: 5, windowMilliseconds: 60 * 1_000 };
export const assistantPreviewCompanyLimit: RateLimitPolicy = { action: "assistant_preview_company", maximum: 10, windowMilliseconds: 60 * 1_000 };
export const proactiveActionActorLimit: RateLimitPolicy = { action: "proactive_action_actor", maximum: 5, windowMilliseconds: 15 * 60 * 1_000 };
export const proactiveActionCompanyLimit: RateLimitPolicy = { action: "proactive_action_company", maximum: 20, windowMilliseconds: 60 * 60 * 1_000 };
