import { assistantProfileId } from "../assistant/domain/assistantProfile.js";
import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import type { WhatsAppConnectionRepositoryPort } from "../whatsapp/application/ports.js";
import { reconstructWhatsAppConnection, whatsAppConnectionId, type WhatsAppConnection, type WhatsAppConnectionId, type WhatsAppConnectionStatus } from "../whatsapp/domain/whatsappConnection.js";

interface Row { id:string; workspace_id:number; company_id:number; assistant_profile_id:string; phone_number_id:string; whatsapp_business_account_id:string; status:WhatsAppConnectionStatus; created_at:string; updated_at:string; }
function connection(row: Row): WhatsAppConnection { return reconstructWhatsAppConnection({ id: row.id as WhatsAppConnectionId, workspaceId: row.workspace_id, companyId: row.company_id, assistantProfileId: assistantProfileId(row.assistant_profile_id), phoneNumberId: row.phone_number_id, whatsappBusinessAccountId: row.whatsapp_business_account_id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }); }

export class WhatsAppConnectionRepository implements WhatsAppConnectionRepositoryPort {
  public constructor(private readonly db: SynchronousDatabase) {}

  public create(context: WorkspaceContext, value: WhatsAppConnection): WhatsAppConnection | null {
    const result = this.db.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) SELECT ?,c.workspace_id,c.id,p.id,?,?,?,?,? FROM companies c JOIN assistant_profiles p ON p.id=? AND p.company_id=c.id WHERE c.workspace_id=? AND c.id=? AND c.workspace_id=?").run(value.id, value.phoneNumberId, value.whatsappBusinessAccountId, value.status, value.createdAt, value.updatedAt, value.assistantProfileId, context.workspaceId, value.companyId, value.workspaceId);
    return result.changes === 1 ? this.findById(context, value.companyId, value.id) : null;
  }

  public findById(context: WorkspaceContext, companyId: number, id: WhatsAppConnectionId): WhatsAppConnection | null {
    const row = this.db.prepare("SELECT wc.* FROM whatsapp_connections wc JOIN companies c ON c.id=wc.company_id WHERE wc.id=? AND wc.company_id=? AND wc.workspace_id=? AND c.workspace_id=?").get(id, companyId, context.workspaceId, context.workspaceId) as Row | undefined;
    return row ? connection(row) : null;
  }

  public findByPhoneNumberId(phoneNumberId: string): WhatsAppConnection | null {
    const row = this.db.prepare("SELECT wc.* FROM whatsapp_connections wc JOIN companies c ON c.id=wc.company_id AND c.workspace_id=wc.workspace_id JOIN assistant_profiles p ON p.id=wc.assistant_profile_id AND p.company_id=c.id WHERE wc.phone_number_id=?").get(phoneNumberId) as Row | undefined;
    return row ? connection(row) : null;
  }

  public listByCompany(context: WorkspaceContext, companyId: number): WhatsAppConnection[] {
    return (this.db.prepare("SELECT wc.* FROM whatsapp_connections wc JOIN companies c ON c.id=wc.company_id WHERE wc.company_id=? AND wc.workspace_id=? AND c.workspace_id=? ORDER BY wc.created_at DESC,wc.id DESC").all(companyId, context.workspaceId, context.workspaceId) as unknown as Row[]).map(connection);
  }

  public updateStatus(context: WorkspaceContext, companyId: number, id: WhatsAppConnectionId, expectedUpdatedAt: string, status: WhatsAppConnectionStatus, updatedAt: string): WhatsAppConnection | null {
    const result = this.db.prepare("UPDATE whatsapp_connections SET status=?,updated_at=? WHERE id=? AND company_id=? AND workspace_id=? AND updated_at=? AND company_id IN (SELECT id FROM companies WHERE id=? AND workspace_id=?)").run(status, updatedAt, id, companyId, context.workspaceId, expectedUpdatedAt, companyId, context.workspaceId);
    return result.changes === 1 ? this.findById(context, companyId, id) : null;
  }

  public updateAssistantProfile(context: WorkspaceContext, companyId: number, id: WhatsAppConnectionId, expectedUpdatedAt: string, profileId: WhatsAppConnection["assistantProfileId"], updatedAt: string): WhatsAppConnection | null {
    const result = this.db.prepare("UPDATE whatsapp_connections SET assistant_profile_id=?,updated_at=? WHERE id=? AND company_id=? AND workspace_id=? AND status='inactive' AND updated_at=? AND EXISTS (SELECT 1 FROM assistant_profiles p WHERE p.id=? AND p.company_id=?) AND company_id IN (SELECT id FROM companies WHERE id=? AND workspace_id=?)").run(profileId, updatedAt, id, companyId, context.workspaceId, expectedUpdatedAt, profileId, companyId, companyId, context.workspaceId);
    return result.changes === 1 ? this.findById(context, companyId, id) : null;
  }
}
