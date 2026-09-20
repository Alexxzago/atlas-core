import type { SafeConversationAttachment } from "../application/safeConversationAttachment.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export interface SafeConversationAttachmentProjectionPort {
  getSafeConversationAttachments(context: WorkspaceContext, companyId: number, conversationMessageId: string): readonly SafeConversationAttachment[] | Promise<readonly SafeConversationAttachment[]>;
}

export class SafeConversationAttachmentService {
  public constructor(private readonly repository: SafeConversationAttachmentProjectionPort) {}
  public getSafeConversationAttachments(context: WorkspaceContext, companyId: number, conversationMessageId: string): readonly SafeConversationAttachment[] | Promise<readonly SafeConversationAttachment[]> { return this.repository.getSafeConversationAttachments(context, companyId, conversationMessageId); }
}
