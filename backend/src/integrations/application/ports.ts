import type { ToolAvailabilityPolicy } from "../../assistant/application/toolContracts.js";
import type { ToolDefinition } from "../../assistant/domain/tool.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { IntegrationConnection, IntegrationConnectionAuditEventType, IntegrationConnectionId, IntegrationFailureCode, IntegrationOperationalState } from "../domain/integrationConnection.js";

export interface IntegrationConnectionRepositoryPort {
  create(context: WorkspaceContext, value: IntegrationConnection, state: IntegrationOperationalState): Promise<IntegrationConnection | null>;
  findById(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId): Promise<IntegrationConnection | null>;
  listByCompany(context: WorkspaceContext, companyId: number): Promise<readonly IntegrationConnection[]>;
  compareAndSet(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId, expectedVersion: number, value: IntegrationConnection, state: IntegrationOperationalState, eventType: Exclude<IntegrationConnectionAuditEventType, "created">): Promise<IntegrationConnection | null>;
  findState(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId): Promise<IntegrationOperationalState | null>;
  compareAndSetWithSecret(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId, expectedVersion: number, value: IntegrationConnection, state: IntegrationOperationalState, encryptedSecret: string, eventType: "secret_configured"): Promise<IntegrationConnection | null>;
  findSecret(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId): Promise<string | null>;
  isReadyForTool(context: { readonly workspaceId: number }, companyId: number, provider: string, kind: string): Promise<boolean>;
}

export interface IntegrationSecretCipherPort { encrypt(value: string): string; decrypt(value: string): string; }
/** Internal-only validation authority supplied from the durable connection being validated. */
export interface IntegrationProviderValidationInput {
  readonly workspaceId: number;
  readonly companyId: number;
  readonly connectionId: IntegrationConnectionId;
  readonly provider: string;
  readonly kind: string;
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly plaintextSecret: string;
}
export interface IntegrationProviderValidationPort {
  validate(input: IntegrationProviderValidationInput): Promise<{ readonly status: "valid" } | { readonly status: "invalid"; readonly failureCode: IntegrationFailureCode }>;
}
export interface IntegrationReadinessPort { isReadyForTool(context: { readonly workspaceId: number }, companyId: number, provider: string, kind: string): Promise<boolean>; }
export interface IntegrationToolAvailabilityPolicyPort extends ToolAvailabilityPolicy { isAvailable(definition: ToolDefinition, context: { readonly workspaceId: number; readonly companyId: number; readonly assistantProfileId: string }): Promise<boolean>; }
