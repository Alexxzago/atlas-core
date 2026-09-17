import type { WorkspaceContext } from "../../types/workspaceContext.js";

export type ActivationVerificationAttemptStatus = "pending" | "succeeded" | "failed" | "expired";

export interface ActivationVerificationAttempt {
  readonly id: string;
  readonly workspaceId: number;
  readonly companyId: number;
  readonly webChatConnectionId: string;
  readonly tokenDigest: string;
  readonly status: ActivationVerificationAttemptStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly claimedAt: string | null;
  readonly webChatSessionId: string | null;
  readonly conversationId: string | null;
  readonly inboundMessageId: string | null;
  readonly executionRecordId: string | null;
  readonly outcomeRef: "answered" | "safe_fallback" | null;
  readonly completedAt: string | null;
  readonly failureCode: "runtime_failure" | null;
}

export interface ActivationVerificationAttemptRepositoryPort {
  create(context: WorkspaceContext, value: ActivationVerificationAttempt): ActivationVerificationAttempt;
  findLatest(context: WorkspaceContext, companyId: number, webChatConnectionId: string): ActivationVerificationAttempt | null;
  hasSucceeded(context: WorkspaceContext, companyId: number, webChatConnectionId: string): boolean;
  findClaimableByTokenDigest(tokenDigest: string): ActivationVerificationAttempt | null;
  claim(id: string, webChatSessionId: string, conversationId: string, at: string): ActivationVerificationAttempt | null;
  succeedForTurn(webChatSessionId: string, conversationId: string, inboundMessageId: string, executionRecordId: string, outcomeRef: "answered" | "safe_fallback", at: string): ActivationVerificationAttempt | null;
  failForSession(webChatSessionId: string, conversationId: string, at: string): ActivationVerificationAttempt | null;
  expire(id: string, at: string): ActivationVerificationAttempt | null;
}
