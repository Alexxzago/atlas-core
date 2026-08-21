import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { SafeConversationAttachment } from "../media/application/safeConversationAttachment.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

const maximumAttachments = 16;

export class SafeConversationAttachmentRepository {
  public constructor(private readonly db: SynchronousDatabase) {}

  public getSafeConversationAttachments(context: WorkspaceContext, companyId: number, conversationMessageId: string): readonly SafeConversationAttachment[] {
    if (!Number.isSafeInteger(companyId) || companyId < 1 || typeof conversationMessageId !== "string") return [];
    const rows = this.db.prepare("SELECT a.kind,a.media_type,a.safe_filename FROM media_asset_associations ma JOIN media_assets a ON a.id=ma.asset_id AND a.workspace_id=ma.workspace_id AND a.company_id=ma.company_id JOIN conversation_messages m ON m.id=ma.owner_id JOIN conversations v ON v.id=m.conversation_id JOIN companies c ON c.id=a.company_id AND c.workspace_id=a.workspace_id WHERE ma.workspace_id=? AND ma.company_id=? AND ma.owner_type='conversation_message' AND ma.owner_id=? AND a.status='ready' AND a.archived_at IS NULL AND a.deleted_at IS NULL AND v.company_id=a.company_id ORDER BY a.kind,a.safe_filename,ma.id LIMIT ?").all(context.workspaceId, companyId, conversationMessageId, maximumAttachments) as Array<{kind:string;media_type:string;safe_filename:string|null}>;
    return Object.freeze(rows.flatMap((row): SafeConversationAttachment[] => {
      if (row.kind !== "image" && row.kind !== "document" && row.kind !== "audio" || !safe(row.media_type, 160)) return [];
      const filename = row.safe_filename === null ? undefined : safe(row.safe_filename, 180);
      if (row.safe_filename !== null && !filename) return [];
      return [Object.freeze({ kind: row.kind, status: "available", mimeType: row.media_type, ...(filename ? { filename } : {}) })];
    }));
  }
}

function safe(value: string, maximum: number): string | null { const normalized = value.normalize("NFKC").trim(); return normalized && normalized.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(normalized) ? normalized : null; }
