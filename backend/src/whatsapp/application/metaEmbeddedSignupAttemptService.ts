import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { UserId } from "../../identity/domain/user.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import { assistantProfileId } from "../../assistant/domain/assistantProfile.js";
import { integrationConnectionId, type IntegrationConnectionId } from "../../integrations/domain/integrationConnection.js";
import { whatsAppConnectionId } from "../domain/whatsappConnection.js";
import { metaEmbeddedSignupAttemptFailureCode, metaEmbeddedSignupAttemptId, reconstructMetaEmbeddedSignupAttempt, type MetaEmbeddedSignupAttempt, type MetaEmbeddedSignupAttemptFailureCode, type MetaEmbeddedSignupAttemptId } from "../domain/metaEmbeddedSignupAttempt.js";

export interface MetaEmbeddedSignupDigestProvider { issueState(): { readonly raw: string; readonly digest: string }; digestCompletionCode(value: string): string; matchesState(raw: string, digest: string): boolean; matchesCompletionCode(raw: string, digest: string): boolean; }
export interface MetaEmbeddedSignupAttemptRepositoryPort { create(context: WorkspaceContext, attempt: MetaEmbeddedSignupAttempt): Promise<MetaEmbeddedSignupAttempt | null>; find(context: WorkspaceContext, companyId: number, initiatingUserId: UserId, id: MetaEmbeddedSignupAttemptId): Promise<MetaEmbeddedSignupAttempt | null>; reserveIntegrationConnection(context: WorkspaceContext, companyId: number, initiatingUserId: UserId, id: MetaEmbeddedSignupAttemptId, expectedVersion: number, reservedId: IntegrationConnectionId, at: string): Promise<MetaEmbeddedSignupTransitionOutcome>; claim(context: WorkspaceContext, companyId: number, initiatingUserId: UserId, id: MetaEmbeddedSignupAttemptId, completionCodeDigest: string, at: string): Promise<MetaEmbeddedSignupClaimOutcome>; markCompleted(context: WorkspaceContext, companyId: number, initiatingUserId: UserId, id: MetaEmbeddedSignupAttemptId, expectedVersion: number, at: string): Promise<MetaEmbeddedSignupTransitionOutcome>; markFailed(context: WorkspaceContext, companyId: number, initiatingUserId: UserId, id: MetaEmbeddedSignupAttemptId, expectedVersion: number, failureCode: MetaEmbeddedSignupAttemptFailureCode, at: string): Promise<MetaEmbeddedSignupTransitionOutcome>; expire(context: WorkspaceContext, companyId: number, initiatingUserId: UserId, id: MetaEmbeddedSignupAttemptId, expectedVersion: number, at: string): Promise<MetaEmbeddedSignupTransitionOutcome>; }
export type MetaEmbeddedSignupClaimOutcome = { readonly kind: "claimed" | "already_claimed_same_completion" | "already_completed" | "replay_mismatch" | "expired" | "not_found"; readonly attempt?: MetaEmbeddedSignupAttempt };
export type MetaEmbeddedSignupTransitionOutcome = { readonly kind: "applied" | "replayed" | "conflict" | "not_found"; readonly attempt?: MetaEmbeddedSignupAttempt };
export type MetaEmbeddedSignupCompletionClaimResult = { readonly kind: "claimed"; readonly authority: MetaEmbeddedSignupCompletionClaimAuthority } | { readonly kind: "already_claimed_same_completion" | "already_completed" | "replay_mismatch" | "expired" | "not_found" };
export type MetaEmbeddedSignupAuditEventType = "meta_signup_started" | "meta_signup_completion_claimed" | "meta_signup_completed" | "meta_signup_failed" | "meta_signup_expired" | "meta_signup_replay_detected" | "meta_signup_state_mismatch";
export interface MetaEmbeddedSignupAuditPort { record(event: { readonly type: MetaEmbeddedSignupAuditEventType; readonly workspaceId: number; readonly companyId: number; readonly attemptId: MetaEmbeddedSignupAttemptId; readonly at: string }): Promise<void> | void; }
export interface MetaEmbeddedSignupClock { now(): string; }

export interface MetaEmbeddedSignupAttemptSafeProjection { readonly attemptId: MetaEmbeddedSignupAttemptId; readonly status: MetaEmbeddedSignupAttempt["status"]; readonly expiresAt: string; readonly completedAt: string | null; readonly safeFailureCode: MetaEmbeddedSignupAttemptFailureCode | null; readonly hasReconnectTarget: boolean; }
export interface MetaEmbeddedSignupLaunch { readonly attemptId: MetaEmbeddedSignupAttemptId; readonly state: string; readonly expiresAt: string; readonly provider: "meta_whatsapp"; readonly kind: "cloud_api"; }
/** Internal-only future exchange input. It must never be projected to HTTP or logs. */
export interface MetaEmbeddedSignupCompletionClaimAuthority { readonly attempt: MetaEmbeddedSignupAttempt; readonly completionCode: string; }

export class MetaEmbeddedSignupAttemptServiceError extends Error {}

export class HmacMetaEmbeddedSignupDigestProvider implements MetaEmbeddedSignupDigestProvider {
  public constructor(private readonly key: Buffer) { if (key.byteLength < 32) throw new MetaEmbeddedSignupAttemptServiceError("Meta Embedded Signup state HMAC key is invalid."); }
  public issueState(): { readonly raw: string; readonly digest: string } { const raw = randomBytes(32).toString("base64url"); return { raw, digest: this.digest("state", raw) }; }
  public digestCompletionCode(value: string): string { return this.digest("completion-code", completionCode(value)); }
  public matchesState(raw: string, digest: string): boolean { try { return match(this.digest("state", state(raw)), digest); } catch { return false; } }
  public matchesCompletionCode(raw: string, digest: string): boolean { return match(this.digestCompletionCode(raw), digest); }
  private digest(purpose: string, value: string): string { return createHmac("sha256", this.key).update(`atlas:meta-embedded-signup:${purpose}:v1:`).update(value).digest("hex"); }
}

/** Dedicated configuration contract for future production composition. */
export function metaEmbeddedSignupStateHmacKeyFromEnvironment(environment: NodeJS.ProcessEnv = process.env): Buffer {
  const value = environment.META_EMBEDDED_SIGNUP_STATE_HMAC_KEY?.trim();
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new MetaEmbeddedSignupAttemptServiceError("META_EMBEDDED_SIGNUP_STATE_HMAC_KEY is required.");
  const key = Buffer.from(value, "base64url");
  if (key.byteLength < 32 || key.toString("base64url") !== value) throw new MetaEmbeddedSignupAttemptServiceError("META_EMBEDDED_SIGNUP_STATE_HMAC_KEY is invalid.");
  return key;
}

export class MetaEmbeddedSignupAttemptService {
  public constructor(private readonly attempts: MetaEmbeddedSignupAttemptRepositoryPort, private readonly digests: MetaEmbeddedSignupDigestProvider, private readonly clock: MetaEmbeddedSignupClock, private readonly lifetimeMilliseconds = 600_000, private readonly audit?: MetaEmbeddedSignupAuditPort) { if (!Number.isSafeInteger(lifetimeMilliseconds) || lifetimeMilliseconds < 60_000 || lifetimeMilliseconds > 900_000) throw new MetaEmbeddedSignupAttemptServiceError("Meta Embedded Signup attempt lifetime is invalid."); }
  public async start(context: WorkspaceContext, initiatingUserId: UserId, companyId: number, input: { readonly assistantProfileId: string; readonly targetWhatsAppConnectionId?: string | null; readonly targetIntegrationConnectionId?: string | null }): Promise<MetaEmbeddedSignupLaunch> {
    const now = this.clock.now(), issued = this.digests.issueState(), attempt = reconstructMetaEmbeddedSignupAttempt({ id: metaEmbeddedSignupAttemptId(`msa_${randomUUID().replaceAll("-", "")}`), workspaceId: context.workspaceId, companyId: company(companyId), initiatingUserId, assistantProfileId: assistantProfileId(input.assistantProfileId), targetWhatsAppConnectionId: input.targetWhatsAppConnectionId === null || input.targetWhatsAppConnectionId === undefined ? null : whatsAppConnectionId(input.targetWhatsAppConnectionId), targetIntegrationConnectionId: input.targetIntegrationConnectionId === null || input.targetIntegrationConnectionId === undefined ? null : integrationConnectionId(input.targetIntegrationConnectionId), resolvedIntegrationConnectionId: null, provider: "meta_whatsapp", kind: "cloud_api", status: "started", stateDigest: issued.digest, completionCodeDigest: null, createdAt: now, expiresAt: new Date(Date.parse(now) + this.lifetimeMilliseconds).toISOString(), claimedAt: null, completedAt: null, failedAt: null, expiredAt: null, safeFailureCode: null, version: 1, updatedAt: now });
    if (!await this.attempts.create(context, attempt)) throw new MetaEmbeddedSignupAttemptServiceError("Meta Embedded Signup attempt could not be started.");
    await this.event("meta_signup_started", attempt, now);
    return Object.freeze({ attemptId: attempt.id, state: issued.raw, expiresAt: attempt.expiresAt, provider: "meta_whatsapp", kind: "cloud_api" });
  }
  public async claimCompletion(context: WorkspaceContext, initiatingUserId: UserId, companyId: number, attemptIdValue: string, state: string, completionCode: string): Promise<MetaEmbeddedSignupCompletionClaimResult> {
    const id = metaEmbeddedSignupAttemptId(attemptIdValue), attempt = await this.attempts.find(context, company(companyId), initiatingUserId, id);
    if (!attempt) return { kind: "not_found" };
    if (!this.digests.matchesState(state, attempt.stateDigest)) { await this.event("meta_signup_state_mismatch", attempt, this.clock.now()); return { kind: "replay_mismatch" }; }
    const outcome = await this.attempts.claim(context, companyId, initiatingUserId, id, this.digests.digestCompletionCode(completionCode), this.clock.now());
    if (outcome.kind === "claimed" && outcome.attempt) { await this.event("meta_signup_completion_claimed", outcome.attempt, outcome.attempt.claimedAt!); return { kind: "claimed", authority: Object.freeze({ attempt: outcome.attempt, completionCode }) }; }
    if (outcome.kind === "replay_mismatch" && outcome.attempt) await this.event("meta_signup_replay_detected", outcome.attempt, this.clock.now());
    if (outcome.kind === "already_claimed_same_completion" || outcome.kind === "already_completed" || outcome.kind === "replay_mismatch" || outcome.kind === "expired" || outcome.kind === "not_found") return { kind: outcome.kind };
    throw new MetaEmbeddedSignupAttemptServiceError("Meta Embedded Signup completion claim is invalid.");
  }
  /** Internal recovery authority for server-side completion orchestration. */
  public async findAttempt(context: WorkspaceContext, initiatingUserId: UserId, companyId: number, attemptIdValue: string): Promise<MetaEmbeddedSignupAttempt | null> { return this.attempts.find(context, company(companyId), initiatingUserId, metaEmbeddedSignupAttemptId(attemptIdValue)); }
  public async reserveIntegrationConnection(context: WorkspaceContext, initiatingUserId: UserId, companyId: number, attemptIdValue: string, expectedVersion: number): Promise<MetaEmbeddedSignupTransitionOutcome> { const attemptId = metaEmbeddedSignupAttemptId(attemptIdValue), current = await this.attempts.find(context, company(companyId), initiatingUserId, attemptId); if (!current) return { kind: "not_found" }; if (current.resolvedIntegrationConnectionId !== null) return current.status === "completing" ? { kind: "replayed", attempt: current } : { kind: "conflict", attempt: current }; const id = integrationConnectionId(`inc_${randomUUID().replaceAll("-", "")}`); return this.attempts.reserveIntegrationConnection(context, company(companyId), initiatingUserId, attemptId, version(expectedVersion), id, this.clock.now()); }
  public async markCompleted(context: WorkspaceContext, initiatingUserId: UserId, companyId: number, attemptIdValue: string, expectedVersion: number): Promise<MetaEmbeddedSignupTransitionOutcome> { const outcome = await this.attempts.markCompleted(context, company(companyId), initiatingUserId, metaEmbeddedSignupAttemptId(attemptIdValue), version(expectedVersion), this.clock.now()); if (outcome.kind === "applied" && outcome.attempt) await this.event("meta_signup_completed", outcome.attempt, outcome.attempt.completedAt!); return outcome; }
  public async markFailed(context: WorkspaceContext, initiatingUserId: UserId, companyId: number, attemptIdValue: string, expectedVersion: number, failureCode: string): Promise<MetaEmbeddedSignupTransitionOutcome> { const outcome = await this.attempts.markFailed(context, company(companyId), initiatingUserId, metaEmbeddedSignupAttemptId(attemptIdValue), version(expectedVersion), metaEmbeddedSignupAttemptFailureCode(failureCode), this.clock.now()); if (outcome.kind === "applied" && outcome.attempt) await this.event("meta_signup_failed", outcome.attempt, outcome.attempt.failedAt!); return outcome; }
  public async expire(context: WorkspaceContext, initiatingUserId: UserId, companyId: number, attemptIdValue: string, expectedVersion: number): Promise<MetaEmbeddedSignupTransitionOutcome> { const outcome = await this.attempts.expire(context, company(companyId), initiatingUserId, metaEmbeddedSignupAttemptId(attemptIdValue), version(expectedVersion), this.clock.now()); if (outcome.kind === "applied" && outcome.attempt) await this.event("meta_signup_expired", outcome.attempt, outcome.attempt.expiredAt!); return outcome; }
  public safeProjection(value: MetaEmbeddedSignupAttempt): MetaEmbeddedSignupAttemptSafeProjection { return Object.freeze({ attemptId: value.id, status: value.status, expiresAt: value.expiresAt, completedAt: value.completedAt, safeFailureCode: value.safeFailureCode, hasReconnectTarget: value.targetWhatsAppConnectionId !== null || value.targetIntegrationConnectionId !== null }); }
  private async event(type: MetaEmbeddedSignupAuditEventType, attempt: MetaEmbeddedSignupAttempt, at: string): Promise<void> { await this.audit?.record({ type, workspaceId: attempt.workspaceId, companyId: attempt.companyId, attemptId: attempt.id, at }); }
}

function state(value: string): string { if (!/^[A-Za-z0-9_-]{43}$/.test(value) || Buffer.from(value, "base64url").byteLength !== 32) throw new MetaEmbeddedSignupAttemptServiceError("Meta Embedded Signup state is invalid."); return value; }
function completionCode(value: string): string { if (!value || value.length > 4096) throw new MetaEmbeddedSignupAttemptServiceError("Meta Embedded Signup completion code is invalid."); return value; }
function match(actual: string, expected: string): boolean { const left = Buffer.from(actual, "hex"), right = Buffer.from(expected, "hex"); return left.byteLength === right.byteLength && timingSafeEqual(left, right); }
function company(value: number): number { if (!Number.isSafeInteger(value) || value < 1) throw new MetaEmbeddedSignupAttemptServiceError("Company is invalid."); return value; }
function version(value: number): number { if (!Number.isSafeInteger(value) || value < 1) throw new MetaEmbeddedSignupAttemptServiceError("Attempt version is invalid."); return value; }
