import type { SafeConversationAttachment } from "../application/safeConversationAttachment.js";
import { SafeConversationAttachmentRepository } from "../../repositories/safeConversationAttachmentRepository.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export class SafeConversationAttachmentService {
  public constructor(private readonly repository: SafeConversationAttachmentRepository) {}
  public getSafeConversationAttachments(context: WorkspaceContext, companyId: number, conversationMessageId: string): readonly SafeConversationAttachment[] { return this.repository.getSafeConversationAttachments(context, companyId, conversationMessageId); }
}
