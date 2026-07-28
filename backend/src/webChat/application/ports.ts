import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { WebChatConnection, WebChatConnectionId, WebChatConnectionPublicId, WebChatConnectionStatus } from "../domain/webChatConnection.js";

export interface WebChatConnectionRepositoryPort {
  create(context: WorkspaceContext, connection: WebChatConnection): WebChatConnection | null;
  findById(context: WorkspaceContext, companyId: number, connectionId: WebChatConnectionId): WebChatConnection | null;
  listByCompany(context: WorkspaceContext, companyId: number): WebChatConnection[];
  updateStatus(context: WorkspaceContext, companyId: number, connectionId: WebChatConnectionId, status: WebChatConnectionStatus, updatedAt: string): WebChatConnection | null;
  findActiveByPublicId(publicId: WebChatConnectionPublicId): WebChatConnection | null;
  findActiveById(connectionId: WebChatConnectionId): WebChatConnection | null;
}
