import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { WhatsAppConnection, WhatsAppConnectionId, WhatsAppConnectionStatus, WhatsAppConversationBinding } from "../domain/whatsappConnection.js";

export interface WhatsAppConnectionRepositoryPort {
  create(context: WorkspaceContext, connection: WhatsAppConnection): WhatsAppConnection | null;
  findById(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): WhatsAppConnection | null;
  findByPhoneNumberId(phoneNumberId: string): WhatsAppConnection | null;
  listByCompany(context: WorkspaceContext, companyId: number): WhatsAppConnection[];
  updateStatus(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId, expectedUpdatedAt: string, status: WhatsAppConnectionStatus, updatedAt: string): WhatsAppConnection | null;
  updateAssistantProfile(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId, expectedUpdatedAt: string, assistantProfileId: WhatsAppConnection["assistantProfileId"], updatedAt: string): WhatsAppConnection | null;
}

export interface WhatsAppConversationRepositoryPort {
  findBinding(connectionId: WhatsAppConnectionId, waId: string): WhatsAppConversationBinding | null;
  createBinding(binding: WhatsAppConversationBinding): WhatsAppConversationBinding | null;
}
