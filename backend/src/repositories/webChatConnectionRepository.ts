import { assistantProfileId } from "../assistant/domain/assistantProfile.js";
import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { WebChatConnectionRepositoryPort } from "../webChat/application/ports.js";
import { reconstructWebChatConnection, type WebChatConnection, type WebChatConnectionId, type WebChatConnectionPublicId, type WebChatConnectionStatus } from "../webChat/domain/webChatConnection.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

interface Row { id:string; public_id:string; workspace_id:number; company_id:number; assistant_profile_id:string; status:WebChatConnectionStatus; created_at:string; updated_at:string; }
function connection(row: Row): WebChatConnection { return reconstructWebChatConnection({ id: row.id as WebChatConnectionId, publicId: row.public_id as WebChatConnectionPublicId, workspaceId: row.workspace_id, companyId: row.company_id, assistantProfileId: assistantProfileId(row.assistant_profile_id), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }); }

export class WebChatConnectionRepository implements WebChatConnectionRepositoryPort {
  public constructor(private readonly db: SynchronousDatabase) {}

  public create(context: WorkspaceContext, value: WebChatConnection): WebChatConnection | null {
    const result = this.db.prepare("INSERT INTO web_chat_connections(id,public_id,workspace_id,company_id,assistant_profile_id,status,created_at,updated_at) SELECT ?,?,?,c.id,p.id,?,?,? FROM companies c JOIN assistant_profiles p ON p.id=? AND p.company_id=c.id WHERE c.workspace_id=? AND c.id=?").run(value.id, value.publicId, value.workspaceId, value.status, value.createdAt, value.updatedAt, value.assistantProfileId, context.workspaceId, value.companyId);
    return result.changes === 1 ? this.findById(context, value.companyId, value.id) : null;
  }

  public findById(context: WorkspaceContext, companyId: number, id: WebChatConnectionId): WebChatConnection | null {
    const row = this.db.prepare("SELECT wcc.* FROM web_chat_connections wcc JOIN companies c ON c.id=wcc.company_id WHERE wcc.workspace_id=? AND c.workspace_id=? AND wcc.company_id=? AND wcc.id=?").get(context.workspaceId, context.workspaceId, companyId, id) as Row | undefined;
    return row ? connection(row) : null;
  }

  public listByCompany(context: WorkspaceContext, companyId: number): WebChatConnection[] {
    return (this.db.prepare("SELECT wcc.* FROM web_chat_connections wcc JOIN companies c ON c.id=wcc.company_id WHERE wcc.workspace_id=? AND c.workspace_id=? AND wcc.company_id=? ORDER BY wcc.created_at DESC,wcc.id DESC").all(context.workspaceId, context.workspaceId, companyId) as unknown as Row[]).map(connection);
  }

  public updateStatus(context: WorkspaceContext, companyId: number, id: WebChatConnectionId, status: WebChatConnectionStatus, updatedAt: string): WebChatConnection | null {
    const result = this.db.prepare("UPDATE web_chat_connections SET status=?,updated_at=? WHERE id=? AND company_id=? AND workspace_id=? AND company_id IN (SELECT id FROM companies WHERE workspace_id=?)").run(status, updatedAt, id, companyId, context.workspaceId, context.workspaceId);
    return result.changes === 1 ? this.findById(context, companyId, id) : null;
  }

  public findActiveByPublicId(publicId: WebChatConnectionPublicId): WebChatConnection | null {
    const row = this.db.prepare("SELECT wcc.* FROM web_chat_connections wcc JOIN workspaces w ON w.id=wcc.workspace_id JOIN companies c ON c.id=wcc.company_id AND c.workspace_id=w.id JOIN assistant_profiles p ON p.id=wcc.assistant_profile_id AND p.company_id=c.id WHERE wcc.public_id=? AND wcc.status='active'").get(publicId) as Row | undefined;
    return row ? connection(row) : null;
  }
}
