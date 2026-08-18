import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "../config/sqlDatabase.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import type { IntegrationConnectionRepositoryPort } from "../integrations/application/ports.js";
import { integrationConnectionId, reconstructIntegrationConnection, reconstructIntegrationOperationalState, type IntegrationConnection, type IntegrationConnectionAuditEventType, type IntegrationConnectionId, type IntegrationOperationalState } from "../integrations/domain/integrationConnection.js";

interface ConnectionRow extends Record<string, unknown> { id: string; workspace_id: number; company_id: number; provider: string; kind: string; configuration_json: string; status: IntegrationConnection["status"]; version: number; created_at: string; updated_at: string; }
interface StateRow extends Record<string, unknown> { integration_connection_id: string; validation_state: IntegrationOperationalState["validationState"]; validated_at: string | null; validation_failure_code: IntegrationOperationalState["validationFailureCode"]; health_state: IntegrationOperationalState["healthState"]; health_failure_code: IntegrationOperationalState["healthFailureCode"]; last_provider_activity_at: string | null; updated_at: string; }

export class IntegrationConnectionRepository implements IntegrationConnectionRepositoryPort {
  public constructor(private readonly database: SqlDatabase) {}
  public async create(context: WorkspaceContext, value: IntegrationConnection, state: IntegrationOperationalState): Promise<IntegrationConnection | null> {
    return this.database.transaction(async (database) => {
      const inserted = await database.execute(`INSERT INTO integration_connections(id,workspace_id,company_id,provider,kind,configuration_json,status,version,created_at,updated_at) SELECT ?,c.workspace_id,c.id,?,?,?,?,?,?,? FROM companies c WHERE c.id=? AND c.workspace_id=?`, [value.id, value.provider, value.kind, JSON.stringify(value.configuration), value.status, value.version, value.createdAt, value.updatedAt, value.companyId, context.workspaceId]);
       if (Number(inserted.rowsAffected) !== 1) return null;
       await this.insertState(database, state);
       await this.insertAuditEvent(database, context, value, "created");
       return this.findByIdOn(database, context, value.companyId, value.id);
    });
  }
  public async findById(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId): Promise<IntegrationConnection | null> {
    return this.findByIdOn(this.database, context, companyId, id);
  }
  public async listByCompany(context: WorkspaceContext, companyId: number): Promise<readonly IntegrationConnection[]> {
    const rows = await this.database.query<ConnectionRow>(`SELECT i.* FROM integration_connections i JOIN companies c ON c.id=i.company_id AND c.workspace_id=i.workspace_id WHERE i.company_id=? AND i.workspace_id=? ORDER BY i.created_at DESC,i.id DESC`, [companyId, context.workspaceId]);
    return Object.freeze(rows.map(connection));
  }
  public async compareAndSet(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId, expectedVersion: number, value: IntegrationConnection, state: IntegrationOperationalState, eventType: Exclude<IntegrationConnectionAuditEventType, "created">): Promise<IntegrationConnection | null> {
    return this.database.transaction(async (database) => {
      const updated = await database.execute(`UPDATE integration_connections SET configuration_json=?,status=?,version=?,updated_at=? WHERE id=? AND company_id=? AND workspace_id=? AND version=?`, [JSON.stringify(value.configuration), value.status, value.version, value.updatedAt, id, companyId, context.workspaceId, expectedVersion]);
      if (Number(updated.rowsAffected) !== 1) return null;
      await this.insertState(database, state);
      await this.insertAuditEvent(database, context, value, eventType);
      return this.findByIdOn(database, context, companyId, id);
    });
  }
  public async findState(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId): Promise<IntegrationOperationalState | null> {
    const rows = await this.database.query<StateRow>(`SELECT s.* FROM integration_connection_operational_states s JOIN integration_connections i ON i.id=s.integration_connection_id WHERE s.integration_connection_id=? AND i.company_id=? AND i.workspace_id=?`, [id, companyId, context.workspaceId]);
    return rows[0] ? state(rows[0]) : null;
  }
  public async compareAndSetWithSecret(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId, expectedVersion: number, value: IntegrationConnection, state: IntegrationOperationalState, encryptedSecret: string, eventType: "secret_configured"): Promise<IntegrationConnection | null> {
    return this.database.transaction(async (database) => {
      const updated = await database.execute(`UPDATE integration_connections SET configuration_json=?,status=?,version=?,updated_at=? WHERE id=? AND company_id=? AND workspace_id=? AND version=?`, [JSON.stringify(value.configuration), value.status, value.version, value.updatedAt, id, companyId, context.workspaceId, expectedVersion]);
      if (Number(updated.rowsAffected) !== 1) return null;
      await database.execute(`INSERT INTO integration_connection_secrets(integration_connection_id,encrypted_secret,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(integration_connection_id) DO UPDATE SET encrypted_secret=excluded.encrypted_secret,updated_at=excluded.updated_at`, [id, encryptedSecret, value.updatedAt, value.updatedAt]);
      await this.insertState(database, state);
      await this.insertAuditEvent(database, context, value, eventType);
      return this.findByIdOn(database, context, companyId, id);
    });
  }
  public async findSecret(context: WorkspaceContext, companyId: number, id: IntegrationConnectionId): Promise<string | null> {
    const rows = await this.database.query<{ encrypted_secret: string }>(`SELECT s.encrypted_secret FROM integration_connection_secrets s JOIN integration_connections i ON i.id=s.integration_connection_id WHERE i.id=? AND i.company_id=? AND i.workspace_id=?`, [id, companyId, context.workspaceId]);
    return rows[0]?.encrypted_secret ?? null;
  }
  public async isReadyForTool(context: { readonly workspaceId: number }, companyId: number, provider: string, kind: string): Promise<boolean> {
    const rows = await this.database.query<{ id: string }>(`SELECT i.id FROM integration_connections i JOIN integration_connection_operational_states s ON s.integration_connection_id=i.id JOIN integration_connection_secrets secret ON secret.integration_connection_id=i.id WHERE i.workspace_id=? AND i.company_id=? AND i.provider=? AND i.kind=? AND i.status='active' AND s.validation_state='valid' AND s.health_state='healthy' LIMIT 1`, [context.workspaceId, companyId, provider, kind]);
    return rows.length === 1;
  }
  private async insertState(database: SqlDatabase, value: IntegrationOperationalState): Promise<void> {
    await database.execute(`INSERT INTO integration_connection_operational_states(integration_connection_id,validation_state,validated_at,validation_failure_code,health_state,health_failure_code,last_provider_activity_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(integration_connection_id) DO UPDATE SET validation_state=excluded.validation_state,validated_at=excluded.validated_at,validation_failure_code=excluded.validation_failure_code,health_state=excluded.health_state,health_failure_code=excluded.health_failure_code,last_provider_activity_at=excluded.last_provider_activity_at,updated_at=excluded.updated_at`, [value.connectionId, value.validationState, value.validatedAt, value.validationFailureCode, value.healthState, value.healthFailureCode, value.lastProviderActivityAt, value.updatedAt]);
  }
  private async insertAuditEvent(database: SqlDatabase, context: WorkspaceContext, value: IntegrationConnection, eventType: IntegrationConnectionAuditEventType): Promise<void> {
    const payload = JSON.stringify({ provider: value.provider, kind: value.kind, status: value.status, version: value.version });
    await database.execute(`INSERT INTO integration_connection_audit_events(id,workspace_id,company_id,integration_connection_id,event_type,payload_json,version,occurred_at) VALUES(?,?,?,?,?,?,?,?)`, [`ica_${randomUUID().replaceAll("-", "")}`, context.workspaceId, value.companyId, value.id, eventType, payload, value.version, value.updatedAt]);
  }
  private async findByIdOn(database: SqlDatabase, context: WorkspaceContext, companyId: number, id: IntegrationConnectionId): Promise<IntegrationConnection | null> {
    const rows = await database.query<ConnectionRow>(`SELECT i.* FROM integration_connections i JOIN companies c ON c.id=i.company_id AND c.workspace_id=i.workspace_id WHERE i.id=? AND i.company_id=? AND i.workspace_id=?`, [id, companyId, context.workspaceId]);
    return rows[0] ? connection(rows[0]) : null;
  }
}
function connection(row: ConnectionRow): IntegrationConnection { return reconstructIntegrationConnection({ id: integrationConnectionId(row.id), workspaceId: row.workspace_id, companyId: row.company_id, provider: row.provider, kind: row.kind, configuration: JSON.parse(row.configuration_json) as Record<string, unknown>, status: row.status, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at }); }
function state(row: StateRow): IntegrationOperationalState { return reconstructIntegrationOperationalState({ connectionId: integrationConnectionId(row.integration_connection_id), validationState: row.validation_state, validatedAt: row.validated_at, validationFailureCode: row.validation_failure_code, healthState: row.health_state, healthFailureCode: row.health_failure_code, lastProviderActivityAt: row.last_provider_activity_at, updatedAt: row.updated_at }); }
