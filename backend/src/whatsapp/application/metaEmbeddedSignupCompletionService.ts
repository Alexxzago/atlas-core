import type { UserId } from "../../identity/domain/user.js";
import { integrationConnectionId, type IntegrationConnectionId, type IntegrationFailureCode } from "../../integrations/domain/integrationConnection.js";
import { IntegrationConnectionConflictError, IntegrationConnectionNotFoundError, IntegrationConnectionService, IntegrationConnectionValidationError } from "../../integrations/services/integrationConnectionService.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { MetaEmbeddedSignupAttempt } from "../domain/metaEmbeddedSignupAttempt.js";
import { reconstructMetaWhatsAppVerifiedAsset, type MetaWhatsAppVerifiedAsset } from "./metaEmbeddedSignup.js";
import { MetaEmbeddedSignupAttemptService } from "./metaEmbeddedSignupAttemptService.js";
import type { MetaEmbeddedSignupOperationalAuditPort } from "./metaEmbeddedSignupAudit.js";
import type { MetaEmbeddedSignupCompletionFinalizer, FinalizeMetaEmbeddedSignupOutcome } from "./metaEmbeddedSignupCompletionFinalizer.js";
import { metaWhatsAppIntegrationSecret, reconstructMetaWhatsAppIntegrationConfiguration, type MetaWhatsAppIntegrationConfiguration } from "./metaEmbeddedSignupIntegration.js";
import type { MetaEmbeddedSignupProvider } from "../providers/MetaEmbeddedSignupProvider.js";

export interface CompleteMetaEmbeddedSignupInput {
  readonly workspaceId: number;
  readonly companyId: number;
  readonly actorId: UserId;
  readonly attemptId: string;
  readonly state: string;
  readonly authorizationCode: string;
  readonly whatsappBusinessAccountIdHint?: string;
  readonly phoneNumberIdHint?: string;
}

export type MetaEmbeddedSignupCompletionOutcome =
  | { readonly kind: "completed" | "replayed"; readonly attemptId: string; readonly whatsAppConnectionId: string; readonly verifiedAsset: MetaWhatsAppVerifiedAsset }
  | { readonly kind: "reconnect_required" | "asset_change_required" | "conflict" | "expired" | "unauthorized" | "forbidden" | "not_found" | "rate_limited" | "unavailable" | "timeout" | "invalid_response" | "validation_error" | "unready" };

interface DurableIntegrationAuthority {
  readonly id: IntegrationConnectionId;
  readonly configuration: MetaWhatsAppIntegrationConfiguration;
  readonly validated: boolean;
}

export class MetaEmbeddedSignupCompletionService {
  public constructor(
    private readonly attempts: MetaEmbeddedSignupAttemptService,
    private readonly provider: MetaEmbeddedSignupProvider,
    private readonly integrations: IntegrationConnectionService,
    private readonly finalizer: MetaEmbeddedSignupCompletionFinalizer,
    private readonly clock: { now(): string },
    private readonly graphApiVersion = "v26.0",
    private readonly audit?: MetaEmbeddedSignupOperationalAuditPort,
  ) {
    if (!/^v[1-9]\d*\.\d+$/.test(graphApiVersion)) throw new Error("Meta Embedded Signup Graph version is invalid.");
  }

  public async complete(input: CompleteMetaEmbeddedSignupInput): Promise<MetaEmbeddedSignupCompletionOutcome> {
    const context: WorkspaceContext = Object.freeze({ workspaceId: input.workspaceId, workspaceKey: "meta-embedded-signup" });
    let claim: Awaited<ReturnType<MetaEmbeddedSignupAttemptService["claimCompletion"]>>;
    try { claim = await this.attempts.claimCompletion(context, input.actorId, input.companyId, input.attemptId, input.state, input.authorizationCode); }
    catch { return { kind: "validation_error" }; }
    if (claim.kind === "not_found") return { kind: "not_found" };
    if (claim.kind === "expired") return { kind: "expired" };
    if (claim.kind === "replay_mismatch") return { kind: "conflict" };
    const attempt = claim.kind === "claimed"
      ? claim.authority.attempt
      : await this.attempts.findAttempt(context, input.actorId, input.companyId, input.attemptId);
    if (!attempt) return { kind: "not_found" };
    if (attempt.status === "completed") return this.resumeDurable(context, input, attempt, true);
    if (attempt.status !== "completing") return attempt.status === "expired" ? { kind: "expired" } : { kind: "conflict" };

    if (attempt.resolvedIntegrationConnectionId) {
      const durable = await this.inspectDurable(context, input.companyId, attempt.resolvedIntegrationConnectionId);
      if (durable) return this.validateAndFinalize(context, input, attempt, durable);
    }

    const exchanged = await this.provider.exchangeAuthorizationCode({ authorizationCode: input.authorizationCode, signal: new AbortController().signal });
    if (exchanged.kind !== "success") {
      if (claim.kind === "already_claimed_same_completion" && (exchanged.kind === "unauthorized" || exchanged.kind === "forbidden" || exchanged.kind === "validation_error")) return { kind: "reconnect_required" };
      return { kind: exchanged.kind };
    }
    if (!input.whatsappBusinessAccountIdHint || !input.phoneNumberIdHint) return { kind: "validation_error" };
    const verified = await this.provider.verifyAssets({ whatsappBusinessAccountId: input.whatsappBusinessAccountIdHint, phoneNumberId: input.phoneNumberIdHint, accessToken: exchanged.credential.accessToken, signal: new AbortController().signal });
    if (verified.kind !== "success") return { kind: verified.kind };
    let asset: MetaWhatsAppVerifiedAsset;
    try { asset = reconstructMetaWhatsAppVerifiedAsset(verified.asset); } catch { return { kind: "invalid_response" }; }
    if (asset.whatsappBusinessAccountId !== input.whatsappBusinessAccountIdHint || asset.phoneNumberId !== input.phoneNumberIdHint) return { kind: "validation_error" };

    let current = attempt;
    if (!current.resolvedIntegrationConnectionId) {
      const reserved = await this.attempts.reserveIntegrationConnection(context, input.actorId, input.companyId, input.attemptId, current.version);
      if (reserved.kind === "not_found") return { kind: "not_found" };
      if ((reserved.kind !== "applied" && reserved.kind !== "replayed") || !reserved.attempt?.resolvedIntegrationConnectionId) return { kind: "conflict" };
      current = reserved.attempt;
    }
    const id = current.resolvedIntegrationConnectionId!;
    const configuration = this.configuration(asset);
    try {
      const existing = await this.integrations.inspect(context, input.companyId, id);
      if (existing) {
        const durable = await this.inspectDurable(context, input.companyId, id);
        if (!durable || !sameConfiguration(durable.configuration, configuration)) return { kind: "conflict" };
        return this.validateAndFinalize(context, input, current, durable);
      }
      await this.integrations.createWithReservedId(context, input.companyId, id, { provider: "meta_whatsapp", kind: "cloud_api", configuration: { ...configuration }, plaintextSecret: metaWhatsAppIntegrationSecret(exchanged.credential.accessToken) });
    } catch (error: unknown) { return integrationError(error); }
    const durable = await this.inspectDurable(context, input.companyId, id);
    return durable ? this.validateAndFinalize(context, input, current, durable) : { kind: "unready" };
  }

  private async resumeDurable(context: WorkspaceContext, input: CompleteMetaEmbeddedSignupInput, attempt: MetaEmbeddedSignupAttempt, replay: boolean): Promise<MetaEmbeddedSignupCompletionOutcome> {
    if (!attempt.resolvedIntegrationConnectionId) return { kind: "conflict" };
    const durable = await this.inspectDurable(context, input.companyId, attempt.resolvedIntegrationConnectionId);
    if (!durable) return { kind: "unready" };
    return this.finalize(context, input, attempt, durable, replay);
  }

  private async inspectDurable(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId): Promise<DurableIntegrationAuthority | null> {
    const inspected = await this.integrations.inspect(context, companyId, integrationConnectionId(id));
    if (!inspected || !inspected.hasCurrentSecret || inspected.connection.provider !== "meta_whatsapp" || inspected.connection.kind !== "cloud_api") return null;
    try {
      const configuration = reconstructMetaWhatsAppIntegrationConfiguration(inspected.connection.configuration);
      return Object.freeze({ id, configuration, validated: inspected.state?.validationState === "valid" && inspected.state.healthState === "healthy" });
    } catch { return null; }
  }

  private async validateAndFinalize(context: WorkspaceContext, input: CompleteMetaEmbeddedSignupInput, attempt: MetaEmbeddedSignupAttempt, durable: DurableIntegrationAuthority): Promise<MetaEmbeddedSignupCompletionOutcome> {
    if (input.whatsappBusinessAccountIdHint && input.whatsappBusinessAccountIdHint !== durable.configuration.wabaId) return { kind: "conflict" };
    if (input.phoneNumberIdHint && input.phoneNumberIdHint !== durable.configuration.phoneNumberId) return { kind: "conflict" };
    let authority = durable;
    if (!authority.validated) {
      try { await this.integrations.validate(context, input.companyId, authority.id); }
      catch (error: unknown) { return integrationError(error); }
      const inspected = await this.integrations.inspect(context, input.companyId, authority.id);
      if (!inspected?.state || inspected.state.validationState !== "valid" || inspected.state.healthState !== "healthy") return validationFailure(inspected?.state?.validationFailureCode ?? null);
      authority = { ...authority, validated: true };
    }
    return this.finalize(context, input, attempt, authority, false);
  }

  private async finalize(context: WorkspaceContext, input: CompleteMetaEmbeddedSignupInput, attempt: MetaEmbeddedSignupAttempt, durable: DurableIntegrationAuthority, replay: boolean): Promise<MetaEmbeddedSignupCompletionOutcome> {
    const asset = reconstructMetaWhatsAppVerifiedAsset({ whatsappBusinessAccountId: durable.configuration.wabaId, phoneNumberId: durable.configuration.phoneNumberId, displayPhoneNumber: durable.configuration.displayPhoneNumber ?? null });
    const outcome = await this.finalizer.finalize({ workspaceId: context.workspaceId, companyId: input.companyId, actorId: input.actorId, attemptId: attempt.id, expectedAttemptVersion: attempt.version, integrationConnectionId: durable.id, whatsappBusinessAccountId: asset.whatsappBusinessAccountId, phoneNumberId: asset.phoneNumberId, assistantProfileId: attempt.assistantProfileId, reconnectWhatsAppConnectionId: attempt.targetWhatsAppConnectionId, at: this.clock.now() });
    if (outcome.kind === "applied") await this.audit?.record({ type: "meta_signup_connection_linked", workspaceId: context.workspaceId, companyId: input.companyId, attemptId: attempt.id, integrationConnectionId: durable.id, whatsAppConnectionId: outcome.whatsAppConnectionId, at: this.clock.now() });
    if (outcome.kind === "applied" || outcome.kind === "replayed") return Object.freeze({ kind: replay || outcome.kind === "replayed" ? "replayed" : "completed", attemptId: attempt.id, whatsAppConnectionId: outcome.whatsAppConnectionId, verifiedAsset: asset });
    if (outcome.kind === "asset_change_required" || outcome.kind === "conflict" || outcome.kind === "expired" || outcome.kind === "not_found" || outcome.kind === "unready") return finalizerFailure(outcome);
    return { kind: "conflict" };
  }

  private configuration(asset: MetaWhatsAppVerifiedAsset): MetaWhatsAppIntegrationConfiguration {
    return reconstructMetaWhatsAppIntegrationConfiguration({ wabaId: asset.whatsappBusinessAccountId, phoneNumberId: asset.phoneNumberId, graphApiVersion: this.graphApiVersion, ...(asset.displayPhoneNumber === null ? {} : { displayPhoneNumber: asset.displayPhoneNumber }) });
  }
}

function sameConfiguration(left: MetaWhatsAppIntegrationConfiguration, right: MetaWhatsAppIntegrationConfiguration): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function validationFailure(code: IntegrationFailureCode | null): MetaEmbeddedSignupCompletionOutcome {
  if (code === "credentials_invalid") return { kind: "reconnect_required" };
  if (code === "provider_timeout") return { kind: "timeout" };
  if (code === "provider_unavailable") return { kind: "unavailable" };
  return code === "provider_identity_mismatch" || code === "provider_rejected" ? { kind: "validation_error" } : { kind: "unready" };
}
function integrationError(error: unknown): MetaEmbeddedSignupCompletionOutcome {
  if (error instanceof IntegrationConnectionNotFoundError) return { kind: "not_found" };
  if (error instanceof IntegrationConnectionConflictError) return { kind: "conflict" };
  if (error instanceof IntegrationConnectionValidationError) return { kind: "unready" };
  return { kind: "unavailable" };
}
function finalizerFailure(outcome: Exclude<FinalizeMetaEmbeddedSignupOutcome, { readonly kind: "applied" | "replayed"; readonly whatsAppConnectionId: string }>): MetaEmbeddedSignupCompletionOutcome {
  return { kind: outcome.kind };
}
