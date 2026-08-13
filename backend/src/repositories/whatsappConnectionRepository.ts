import { assistantProfileId } from "../assistant/domain/assistantProfile.js";
import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import type { WhatsAppConnectionCredentialRepositoryPort, WhatsAppConnectionOperationalStateRepositoryPort, WhatsAppConnectionRepositoryPort } from "../whatsapp/application/ports.js";
import { reconstructWhatsAppConnection, whatsAppConnectionId, type WhatsAppConnection, type WhatsAppConnectionId, type WhatsAppConnectionStatus } from "../whatsapp/domain/whatsappConnection.js";
import { reconstructEncryptedWhatsAppConnectionCredentials, reconstructWhatsAppConnectionOperationalState, type EncryptedWhatsAppConnectionCredentials, type WhatsAppConnectionOperationalState } from "../whatsapp/domain/whatsappConnectionOnboarding.js";

interface Row { id:string; workspace_id:number; company_id:number; assistant_profile_id:string; phone_number_id:string; whatsapp_business_account_id:string; status:WhatsAppConnectionStatus; created_at:string; updated_at:string; }
interface CredentialRow { whatsapp_connection_id:string; encrypted_access_token:string; created_at:string; updated_at:string; }
interface OperationalStateRow { whatsapp_connection_id:string; validation_state:WhatsAppConnectionOperationalState["validationState"]; validated_at:string|null; validation_failure_code:WhatsAppConnectionOperationalState["validationFailureCode"]; health_state:WhatsAppConnectionOperationalState["healthState"]; last_provider_activity_at:string|null; last_webhook_activity_at:string|null; health_failure_code:WhatsAppConnectionOperationalState["healthFailureCode"]; updated_at:string; }
function connection(row: Row): WhatsAppConnection { return reconstructWhatsAppConnection({ id: row.id as WhatsAppConnectionId, workspaceId: row.workspace_id, companyId: row.company_id, assistantProfileId: assistantProfileId(row.assistant_profile_id), phoneNumberId: row.phone_number_id, whatsappBusinessAccountId: row.whatsapp_business_account_id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }); }
function credentials(row: CredentialRow): EncryptedWhatsAppConnectionCredentials { return reconstructEncryptedWhatsAppConnectionCredentials({ whatsAppConnectionId: whatsAppConnectionId(row.whatsapp_connection_id), encryptedAccessToken: row.encrypted_access_token, createdAt: row.created_at, updatedAt: row.updated_at }); }
function operationalState(row: OperationalStateRow): WhatsAppConnectionOperationalState { return reconstructWhatsAppConnectionOperationalState({ whatsAppConnectionId: whatsAppConnectionId(row.whatsapp_connection_id), validationState: row.validation_state, validatedAt: row.validated_at, validationFailureCode: row.validation_failure_code, healthState: row.health_state, lastProviderActivityAt: row.last_provider_activity_at, lastWebhookActivityAt: row.last_webhook_activity_at, healthFailureCode: row.health_failure_code, updatedAt: row.updated_at }); }

export class WhatsAppConnectionRepository implements WhatsAppConnectionRepositoryPort, WhatsAppConnectionCredentialRepositoryPort, WhatsAppConnectionOperationalStateRepositoryPort {
  public constructor(private readonly db: SynchronousDatabase) {}

  public create(context: WorkspaceContext, value: WhatsAppConnection): WhatsAppConnection | null {
    const result = this.db.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) SELECT ?,c.workspace_id,c.id,p.id,?,?,?,?,? FROM companies c JOIN assistant_profiles p ON p.id=? AND p.company_id=c.id WHERE c.workspace_id=? AND c.id=? AND c.workspace_id=?").run(value.id, value.phoneNumberId, value.whatsappBusinessAccountId, value.status, value.createdAt, value.updatedAt, value.assistantProfileId, context.workspaceId, value.companyId, value.workspaceId);
    return result.changes === 1 ? this.findById(context, value.companyId, value.id) : null;
  }

  public findById(context: WorkspaceContext, companyId: number, id: WhatsAppConnectionId): WhatsAppConnection | null {
    const row = this.db.prepare("SELECT wc.* FROM whatsapp_connections wc JOIN companies c ON c.id=wc.company_id WHERE wc.id=? AND wc.company_id=? AND wc.workspace_id=? AND c.workspace_id=?").get(id, companyId, context.workspaceId, context.workspaceId) as Row | undefined;
    return row ? connection(row) : null;
  }
  public findByIdForRecovery(id: WhatsAppConnectionId): WhatsAppConnection | null {
    const commercialJoin = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_commercial_controls'").get() ? "JOIN workspace_commercial_controls cc ON cc.workspace_id=wc.workspace_id AND cc.status='active'" : "";
    const row = this.db.prepare(`SELECT wc.* FROM whatsapp_connections wc ${commercialJoin} JOIN companies c ON c.id=wc.company_id AND c.workspace_id=wc.workspace_id WHERE wc.id=?`).get(id) as Row | undefined;
    return row ? connection(row) : null;
  }

  public findByPhoneNumberId(phoneNumberId: string): WhatsAppConnection | null {
    const commercialJoin=this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_commercial_controls'").get()?"JOIN workspace_commercial_controls cc ON cc.workspace_id=wc.workspace_id AND cc.status='active'":"";
    const row = this.db.prepare(`SELECT wc.* FROM whatsapp_connections wc ${commercialJoin} JOIN companies c ON c.id=wc.company_id AND c.workspace_id=wc.workspace_id AND c.lifecycle_state!='archived' JOIN assistant_profiles p ON p.id=wc.assistant_profile_id AND p.company_id=c.id AND p.status!='archived' WHERE wc.phone_number_id=?`).get(phoneNumberId) as Row | undefined;
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

  public updateConfiguration(context: WorkspaceContext, companyId: number, id: WhatsAppConnectionId, expectedUpdatedAt: string, profileId: WhatsAppConnection["assistantProfileId"], phoneNumberId: string, whatsappBusinessAccountId: string, updatedAt: string): WhatsAppConnection | null {
    const result = this.db.prepare("UPDATE whatsapp_connections SET assistant_profile_id=?,phone_number_id=?,whatsapp_business_account_id=?,updated_at=? WHERE id=? AND company_id=? AND workspace_id=? AND status='inactive' AND updated_at=? AND EXISTS (SELECT 1 FROM assistant_profiles p WHERE p.id=? AND p.company_id=?) AND company_id IN (SELECT id FROM companies WHERE id=? AND workspace_id=?)").run(profileId, phoneNumberId, whatsappBusinessAccountId, updatedAt, id, companyId, context.workspaceId, expectedUpdatedAt, profileId, companyId, companyId, context.workspaceId);
    return result.changes === 1 ? this.findById(context, companyId, id) : null;
  }

  public replaceCredentialsAndDeactivate(context: WorkspaceContext, companyId: number, id: WhatsAppConnectionId, expectedUpdatedAt: string, value: EncryptedWhatsAppConnectionCredentials, state: WhatsAppConnectionOperationalState, updatedAt: string): WhatsAppConnection | null {
    const ownsTransaction = !this.db.isTransaction;
    if (ownsTransaction) this.db.exec("BEGIN IMMEDIATE;");
    try {
      const connection = this.db.prepare("UPDATE whatsapp_connections SET status='inactive',updated_at=? WHERE id=? AND company_id=? AND workspace_id=? AND updated_at=? AND company_id IN (SELECT id FROM companies WHERE id=? AND workspace_id=?)").run(updatedAt, id, companyId, context.workspaceId, expectedUpdatedAt, companyId, context.workspaceId);
      if (connection.changes !== 1) {
        if (ownsTransaction) this.db.exec("ROLLBACK;");
        return null;
      }
      this.db.prepare("INSERT INTO whatsapp_connection_credentials(whatsapp_connection_id,encrypted_access_token,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(whatsapp_connection_id) DO UPDATE SET encrypted_access_token=excluded.encrypted_access_token,updated_at=excluded.updated_at").run(value.whatsAppConnectionId, value.encryptedAccessToken, value.createdAt, value.updatedAt);
      this.db.prepare("INSERT INTO whatsapp_connection_operational_states(whatsapp_connection_id,validation_state,validated_at,validation_failure_code,health_state,last_provider_activity_at,last_webhook_activity_at,health_failure_code,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(whatsapp_connection_id) DO UPDATE SET validation_state=excluded.validation_state,validated_at=excluded.validated_at,validation_failure_code=excluded.validation_failure_code,health_state=excluded.health_state,last_provider_activity_at=excluded.last_provider_activity_at,last_webhook_activity_at=excluded.last_webhook_activity_at,health_failure_code=excluded.health_failure_code,updated_at=excluded.updated_at").run(state.whatsAppConnectionId, state.validationState, state.validatedAt, state.validationFailureCode, state.healthState, state.lastProviderActivityAt, state.lastWebhookActivityAt, state.healthFailureCode, state.updatedAt);
      if (ownsTransaction) this.db.exec("COMMIT;");
      return this.findById(context, companyId, id);
    } catch (error: unknown) {
      if (ownsTransaction && this.db.isTransaction) this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  public findCredentials(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): EncryptedWhatsAppConnectionCredentials | null {
    const row = this.db.prepare("SELECT credentials.* FROM whatsapp_connection_credentials credentials JOIN whatsapp_connections connection ON connection.id=credentials.whatsapp_connection_id JOIN companies company ON company.id=connection.company_id WHERE credentials.whatsapp_connection_id=? AND connection.company_id=? AND connection.workspace_id=? AND company.workspace_id=?").get(connectionId, companyId, context.workspaceId, context.workspaceId) as CredentialRow | undefined;
    return row ? credentials(row) : null;
  }

  public replaceCredentials(context: WorkspaceContext, companyId: number, value: EncryptedWhatsAppConnectionCredentials): EncryptedWhatsAppConnectionCredentials | null {
    const result = this.db.prepare("INSERT INTO whatsapp_connection_credentials(whatsapp_connection_id,encrypted_access_token,created_at,updated_at) SELECT connection.id,?,?,? FROM whatsapp_connections connection JOIN companies company ON company.id=connection.company_id WHERE connection.id=? AND connection.company_id=? AND connection.workspace_id=? AND company.workspace_id=? ON CONFLICT(whatsapp_connection_id) DO UPDATE SET encrypted_access_token=excluded.encrypted_access_token,updated_at=excluded.updated_at").run(value.encryptedAccessToken, value.createdAt, value.updatedAt, value.whatsAppConnectionId, companyId, context.workspaceId, context.workspaceId);
    return result.changes === 1 ? this.findCredentials(context, companyId, value.whatsAppConnectionId) : null;
  }

  public findOperationalState(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): WhatsAppConnectionOperationalState | null {
    const row = this.db.prepare("SELECT state.* FROM whatsapp_connection_operational_states state JOIN whatsapp_connections connection ON connection.id=state.whatsapp_connection_id JOIN companies company ON company.id=connection.company_id WHERE state.whatsapp_connection_id=? AND connection.company_id=? AND connection.workspace_id=? AND company.workspace_id=?").get(connectionId, companyId, context.workspaceId, context.workspaceId) as OperationalStateRow | undefined;
    return row ? operationalState(row) : null;
  }

  public replaceOperationalState(context: WorkspaceContext, companyId: number, value: WhatsAppConnectionOperationalState): WhatsAppConnectionOperationalState | null {
    const result = this.db.prepare("INSERT INTO whatsapp_connection_operational_states(whatsapp_connection_id,validation_state,validated_at,validation_failure_code,health_state,last_provider_activity_at,last_webhook_activity_at,health_failure_code,updated_at) SELECT connection.id,?,?,?,?,?,?,?,? FROM whatsapp_connections connection JOIN companies company ON company.id=connection.company_id WHERE connection.id=? AND connection.company_id=? AND connection.workspace_id=? AND company.workspace_id=? ON CONFLICT(whatsapp_connection_id) DO UPDATE SET validation_state=excluded.validation_state,validated_at=excluded.validated_at,validation_failure_code=excluded.validation_failure_code,health_state=excluded.health_state,last_provider_activity_at=excluded.last_provider_activity_at,last_webhook_activity_at=excluded.last_webhook_activity_at,health_failure_code=excluded.health_failure_code,updated_at=excluded.updated_at").run(value.validationState, value.validatedAt, value.validationFailureCode, value.healthState, value.lastProviderActivityAt, value.lastWebhookActivityAt, value.healthFailureCode, value.updatedAt, value.whatsAppConnectionId, companyId, context.workspaceId, context.workspaceId);
    return result.changes === 1 ? this.findOperationalState(context, companyId, value.whatsAppConnectionId) : null;
  }
}
