import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "../../config/sqlDatabase.js";
import { reconstructMetaWhatsAppIntegrationConfiguration } from "./metaEmbeddedSignupIntegration.js";

export interface MetaEmbeddedSignupCompletionFinalizer {
  finalize(input: FinalizeMetaEmbeddedSignupInput): Promise<FinalizeMetaEmbeddedSignupOutcome>;
}
export interface FinalizeMetaEmbeddedSignupInput {
  readonly workspaceId: number; readonly companyId: number; readonly actorId: string; readonly attemptId: string; readonly expectedAttemptVersion: number;
  readonly integrationConnectionId: string; readonly whatsappBusinessAccountId: string; readonly phoneNumberId: string; readonly assistantProfileId: string; readonly reconnectWhatsAppConnectionId: string | null; readonly at: string;
}
export type FinalizeMetaEmbeddedSignupOutcome = { readonly kind: "applied" | "replayed"; readonly whatsAppConnectionId: string } | { readonly kind: "conflict" | "not_found" | "expired" | "unready" | "asset_change_required" };

/** Local-only durable finalization. Provider exchange, encryption, and network validation happen before this boundary. */
export class SqlMetaEmbeddedSignupCompletionFinalizer implements MetaEmbeddedSignupCompletionFinalizer {
  public constructor(private readonly database: SqlDatabase) {}
  public async finalize(input: FinalizeMetaEmbeddedSignupInput): Promise<FinalizeMetaEmbeddedSignupOutcome> {
    return this.database.transaction(async database => {
      const attempts = await database.query<Row>("SELECT * FROM meta_embedded_signup_attempts WHERE id=? AND workspace_id=? AND company_id=? AND initiating_user_id=?", [input.attemptId, input.workspaceId, input.companyId, input.actorId]);
      const attempt = attempts[0]; if (!attempt) return { kind: "not_found" };
      if (attempt.status === "completed") return this.replay(database, input, attempt);
      if (attempt.status === "expired" || attempt.expires_at <= input.at) return { kind: "expired" };
      if (attempt.status !== "completing" || attempt.version !== input.expectedAttemptVersion || attempt.resolved_integration_connection_id !== input.integrationConnectionId || attempt.assistant_profile_id !== input.assistantProfileId || (attempt.target_whatsapp_connection_id ?? null) !== input.reconnectWhatsAppConnectionId) return { kind: "conflict" };
      const integrations = await database.query<IntegrationRow>("SELECT i.*,s.validation_state,s.health_state,secret.encrypted_secret FROM integration_connections i LEFT JOIN integration_connection_operational_states s ON s.integration_connection_id=i.id LEFT JOIN integration_connection_secrets secret ON secret.integration_connection_id=i.id WHERE i.id=? AND i.workspace_id=? AND i.company_id=?", [input.integrationConnectionId, input.workspaceId, input.companyId]);
      const integration = integrations[0]; if (!integration) return { kind: "not_found" };
      if (integration.provider !== "meta_whatsapp" || integration.kind !== "cloud_api") return { kind: "conflict" };
      try { const configuration = reconstructMetaWhatsAppIntegrationConfiguration(JSON.parse(integration.configuration_json) as Record<string, unknown>); if (configuration.wabaId !== input.whatsappBusinessAccountId || configuration.phoneNumberId !== input.phoneNumberId) return { kind: "conflict" }; } catch { return { kind: "unready" }; }
      if (!integration.encrypted_secret || integration.validation_state !== "valid" || integration.health_state !== "healthy") return { kind: "unready" };
      if (input.reconnectWhatsAppConnectionId) return this.reconnect(database, input);
      const existingPhone = await database.query<{ id: string }>("SELECT id FROM whatsapp_connections WHERE phone_number_id=?", [input.phoneNumberId]);
      if (existingPhone.length) return { kind: "conflict" };
      const existingLink = await database.query<{ id: string }>("SELECT id FROM whatsapp_connections WHERE integration_connection_id=?", [input.integrationConnectionId]);
      if (existingLink.length) return { kind: "conflict" };
      const id = `wac_${randomUUID().replaceAll("-", "")}`;
      const inserted = await database.execute("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,integration_connection_id,status,created_at,updated_at) SELECT ?,c.workspace_id,c.id,p.id,?,?,?,'inactive',?,? FROM companies c JOIN assistant_profiles p ON p.id=? AND p.company_id=c.id WHERE c.id=? AND c.workspace_id=?", [id, input.phoneNumberId, input.whatsappBusinessAccountId, input.integrationConnectionId, input.at, input.at, input.assistantProfileId, input.companyId, input.workspaceId]);
      if (Number(inserted.rowsAffected) !== 1) return { kind: "conflict" };
      await database.execute("INSERT INTO whatsapp_connection_operational_states(whatsapp_connection_id,validation_state,validated_at,validation_failure_code,health_state,last_provider_activity_at,last_webhook_activity_at,health_failure_code,updated_at) VALUES(?,'not_validated',NULL,NULL,'inactive',NULL,NULL,NULL,?) ON CONFLICT(whatsapp_connection_id) DO NOTHING", [id, input.at]);
      const complete = await database.execute("UPDATE meta_embedded_signup_attempts SET status='completed',completed_at=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND initiating_user_id=? AND status='completing' AND version=?", [input.at, input.at, input.attemptId, input.workspaceId, input.companyId, input.actorId, input.expectedAttemptVersion]);
      return Number(complete.rowsAffected) === 1 ? { kind: "applied", whatsAppConnectionId: id } : { kind: "conflict" };
    });
  }
  private async reconnect(database: SqlDatabase, input: FinalizeMetaEmbeddedSignupInput): Promise<FinalizeMetaEmbeddedSignupOutcome> { const rows = await database.query<Row>("SELECT * FROM whatsapp_connections WHERE id=? AND workspace_id=? AND company_id=?", [input.reconnectWhatsAppConnectionId!, input.workspaceId, input.companyId]); const connection = rows[0]; if (!connection) return { kind: "not_found" }; if (connection.phone_number_id !== input.phoneNumberId || connection.whatsapp_business_account_id !== input.whatsappBusinessAccountId) return { kind: "asset_change_required" }; if (connection.integration_connection_id !== null && connection.integration_connection_id !== input.integrationConnectionId) return { kind: "conflict" }; const linked = await database.execute("UPDATE whatsapp_connections SET integration_connection_id=?,updated_at=? WHERE id=? AND integration_connection_id IS NULL", [input.integrationConnectionId, input.at, connection.id]); if (connection.integration_connection_id === null && Number(linked.rowsAffected) !== 1) return { kind: "conflict" }; const complete = await database.execute("UPDATE meta_embedded_signup_attempts SET status='completed',completed_at=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND company_id=? AND initiating_user_id=? AND status='completing' AND version=?", [input.at, input.at, input.attemptId, input.workspaceId, input.companyId, input.actorId, input.expectedAttemptVersion]); return Number(complete.rowsAffected) === 1 ? { kind: "applied", whatsAppConnectionId: connection.id } : { kind: "conflict" }; }
  private async replay(database: SqlDatabase, input: FinalizeMetaEmbeddedSignupInput, attempt: Row): Promise<FinalizeMetaEmbeddedSignupOutcome> { if (attempt.resolved_integration_connection_id !== input.integrationConnectionId || attempt.assistant_profile_id !== input.assistantProfileId || (attempt.target_whatsapp_connection_id ?? null) !== input.reconnectWhatsAppConnectionId) return { kind: "conflict" }; const rows = await database.query<Row>("SELECT * FROM whatsapp_connections WHERE integration_connection_id=? AND workspace_id=? AND company_id=?", [input.integrationConnectionId, input.workspaceId, input.companyId]); const connection = rows[0]; return connection && connection.phone_number_id === input.phoneNumberId && connection.whatsapp_business_account_id === input.whatsappBusinessAccountId && (!input.reconnectWhatsAppConnectionId || connection.id === input.reconnectWhatsAppConnectionId) ? { kind: "replayed", whatsAppConnectionId: connection.id } : { kind: "conflict" }; }
}
interface Row extends Record<string, unknown> { id: string; status: string; version: number; expires_at: string; resolved_integration_connection_id: string | null; assistant_profile_id: string; target_whatsapp_connection_id: string | null; phone_number_id: string; whatsapp_business_account_id: string; integration_connection_id: string | null; }
interface IntegrationRow extends Record<string, unknown> { provider: string; kind: string; configuration_json: string; encrypted_secret: string | null; validation_state: string | null; health_state: string | null; }
