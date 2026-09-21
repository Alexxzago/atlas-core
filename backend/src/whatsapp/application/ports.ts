import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { WhatsAppConnection, WhatsAppConnectionId, WhatsAppConnectionStatus, WhatsAppConversationBinding } from "../domain/whatsappConnection.js";
import type { EncryptedWhatsAppConnectionCredentials, WhatsAppConnectionFailureCode, WhatsAppConnectionOperationalState } from "../domain/whatsappConnectionOnboarding.js";

export interface WhatsAppConnectionRepositoryPort {
  create(context: WorkspaceContext, connection: WhatsAppConnection): WhatsAppConnection | null;
  findById(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): WhatsAppConnection | null;
  findByIdForRecovery(connectionId: WhatsAppConnectionId): WhatsAppConnection | null;
  findByPhoneNumberId(phoneNumberId: string): WhatsAppConnection | null;
  listByCompany(context: WorkspaceContext, companyId: number): WhatsAppConnection[];
  updateStatus(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId, expectedUpdatedAt: string, status: WhatsAppConnectionStatus, updatedAt: string): WhatsAppConnection | null;
  updateAssistantProfile(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId, expectedUpdatedAt: string, assistantProfileId: WhatsAppConnection["assistantProfileId"], updatedAt: string): WhatsAppConnection | null;
  updateConfiguration(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId, expectedUpdatedAt: string, assistantProfileId: WhatsAppConnection["assistantProfileId"], phoneNumberId: string, whatsappBusinessAccountId: string, updatedAt: string): WhatsAppConnection | null;
  replaceCredentialsAndDeactivate(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId, expectedUpdatedAt: string, credentials: EncryptedWhatsAppConnectionCredentials, state: WhatsAppConnectionOperationalState, updatedAt: string): WhatsAppConnection | null;
}

export interface AsyncWhatsAppConnectionRepositoryPort {
  create(context: WorkspaceContext, connection: WhatsAppConnection): Promise<WhatsAppConnection | null>;
  findById(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): Promise<WhatsAppConnection | null>;
  findByIdForRecovery(connectionId: WhatsAppConnectionId): Promise<WhatsAppConnection | null>;
  findByPhoneNumberId(phoneNumberId: string): Promise<WhatsAppConnection | null>;
  listByCompany(context: WorkspaceContext, companyId: number): Promise<WhatsAppConnection[]>;
  updateStatus(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId, expectedUpdatedAt: string, status: WhatsAppConnectionStatus, updatedAt: string): Promise<WhatsAppConnection | null>;
  updateAssistantProfile(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId, expectedUpdatedAt: string, assistantProfileId: WhatsAppConnection["assistantProfileId"], updatedAt: string): Promise<WhatsAppConnection | null>;
  updateConfiguration(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId, expectedUpdatedAt: string, assistantProfileId: WhatsAppConnection["assistantProfileId"], phoneNumberId: string, whatsappBusinessAccountId: string, updatedAt: string): Promise<WhatsAppConnection | null>;
  replaceCredentialsAndDeactivate(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId, expectedUpdatedAt: string, credentials: EncryptedWhatsAppConnectionCredentials, state: WhatsAppConnectionOperationalState, updatedAt: string): Promise<WhatsAppConnection | null>;
}

export interface WhatsAppConversationRepositoryPort {
  findBinding(connectionId: WhatsAppConnectionId, waId: string): WhatsAppConversationBinding | null;
  findBindingByConversation(context: WorkspaceContext, companyId: number, conversationId: import("../../conversation/domain/conversation.js").ConversationId): WhatsAppConversationBinding | null;
  createBinding(binding: WhatsAppConversationBinding): WhatsAppConversationBinding | null;
}

// Raw provider access tokens are confined to this port and the provider validation port.
export interface WhatsAppConnectionCredentialRepositoryPort {
  findCredentials(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): EncryptedWhatsAppConnectionCredentials | null;
  replaceCredentials(context: WorkspaceContext, companyId: number, credentials: EncryptedWhatsAppConnectionCredentials): EncryptedWhatsAppConnectionCredentials | null;
}

export interface AsyncWhatsAppConversationRepositoryPort {
  findBinding(connectionId: WhatsAppConnectionId, waId: string): Promise<WhatsAppConversationBinding | null>;
  findBindingByConversation(context: WorkspaceContext, companyId: number, conversationId: import("../../conversation/domain/conversation.js").ConversationId): Promise<WhatsAppConversationBinding | null>;
  createBinding(binding: WhatsAppConversationBinding): Promise<WhatsAppConversationBinding | null>;
}

export interface AsyncWhatsAppConnectionCredentialRepositoryPort {
  findCredentials(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): Promise<EncryptedWhatsAppConnectionCredentials | null>;
  replaceCredentials(context: WorkspaceContext, companyId: number, credentials: EncryptedWhatsAppConnectionCredentials): Promise<EncryptedWhatsAppConnectionCredentials | null>;
}

export interface WhatsAppCredentialCipherPort {
  encrypt(accessToken: string): string;
  decrypt(encryptedAccessToken: string): string;
}

export interface WhatsAppConnectionOperationalStateRepositoryPort {
  findOperationalState(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): WhatsAppConnectionOperationalState | null;
  replaceOperationalState(context: WorkspaceContext, companyId: number, state: WhatsAppConnectionOperationalState): WhatsAppConnectionOperationalState | null;
}

export interface AsyncWhatsAppConnectionOperationalStateRepositoryPort {
  findOperationalState(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): Promise<WhatsAppConnectionOperationalState | null>;
  replaceOperationalState(context: WorkspaceContext, companyId: number, state: WhatsAppConnectionOperationalState): Promise<WhatsAppConnectionOperationalState | null>;
}

export interface WhatsAppConnectionProviderValidationInput {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly whatsappBusinessAccountId: string;
}

export type WhatsAppConnectionProviderValidationResult =
  | { readonly status: "valid" }
  | { readonly status: "invalid"; readonly failureCode: WhatsAppConnectionFailureCode };

export interface WhatsAppConnectionProviderValidationPort {
  validateConnection(input: WhatsAppConnectionProviderValidationInput): Promise<WhatsAppConnectionProviderValidationResult>;
}

// The only port consumers use for access tokens. Its implementation owns fallback selection.
export interface WhatsAppCredentialResolverPort {
  resolve(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): string | null;
}

export interface AsyncWhatsAppCredentialResolverPort {
  resolve(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): Promise<string | null>;
}

/** Resolves a linked Integration Connection synchronously so WhatsApp runtime callers remain fail-closed. */
export interface WhatsAppLinkedIntegrationCredentialRepositoryPort {
  findIntegrationConnectionId(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): string | null;
  findLinkedIntegrationSecret(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): string | null;
  findReadyLinkedIntegrationSecret(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): string | null;
}

export interface AsyncWhatsAppLinkedIntegrationCredentialRepositoryPort {
  findIntegrationConnectionId(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): Promise<string | null>;
  findWhatsAppConnectionIdByIntegrationConnectionId(context: WorkspaceContext, companyId: number, integrationConnectionId: string): Promise<string | null>;
  findLinkedIntegrationSecret(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): Promise<string | null>;
  findReadyLinkedIntegrationSecret(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): Promise<string | null>;
}
