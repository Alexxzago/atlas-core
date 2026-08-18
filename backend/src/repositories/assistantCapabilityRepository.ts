import { randomUUID } from "node:crypto";
import type { SqlDatabase } from "../config/sqlDatabase.js";
import { assistantCapabilityKey, type AssistantCapabilityKey } from "../assistant/domain/assistantCapability.js";
import type { AssistantProfileCapabilityRepositoryPort } from "../assistant/application/toolContracts.js";

export class AssistantCapabilityRepository implements AssistantProfileCapabilityRepositoryPort {
  public constructor(private readonly database: SqlDatabase) {}

  public async listForProfile(context: { readonly workspaceId: number }, companyId: number, profileId: string): Promise<readonly AssistantCapabilityKey[]> {
    const rows = await this.database.query<{ capability_key: string }>(`
      SELECT capability_key FROM assistant_profile_capabilities
      WHERE workspace_id=? AND company_id=? AND assistant_profile_id=? ORDER BY capability_key
    `, [context.workspaceId, companyId, profileId]);
    return Object.freeze(rows.map((row) => assistantCapabilityKey(row.capability_key)));
  }

  public async existsForProfile(context: { readonly workspaceId: number }, companyId: number, profileId: string): Promise<boolean> {
    const rows = await this.database.query<{ id: string }>(`SELECT p.id FROM assistant_profiles p INNER JOIN companies c ON c.id=p.company_id WHERE p.id=? AND p.company_id=? AND c.workspace_id=?`, [profileId, companyId, context.workspaceId]);
    return rows.length === 1;
  }

  public async replaceForProfile(context: { readonly workspaceId: number }, companyId: number, profileId: string, capabilities: readonly AssistantCapabilityKey[], actorUserId: string, at: string): Promise<boolean> {
    return this.database.transaction(async (database) => {
      const profile = await database.query<{ id: string }>(`
        SELECT p.id FROM assistant_profiles p INNER JOIN companies c ON c.id=p.company_id
        WHERE p.id=? AND p.company_id=? AND c.workspace_id=?
      `, [profileId, companyId, context.workspaceId]);
      if (profile.length !== 1) return false;
      const existing = await database.query<{ capability_key: string }>(`
        SELECT capability_key FROM assistant_profile_capabilities WHERE workspace_id=? AND company_id=? AND assistant_profile_id=?
      `, [context.workspaceId, companyId, profileId]);
      const wanted = new Set(capabilities), current = new Set(existing.map((row) => row.capability_key));
      for (const capability of current) if (!wanted.has(capability as AssistantCapabilityKey)) {
        const deleted = await database.execute(`DELETE FROM assistant_profile_capabilities WHERE workspace_id=? AND company_id=? AND assistant_profile_id=? AND capability_key=?`, [context.workspaceId, companyId, profileId, capability]);
        if (Number(deleted.rowsAffected) !== 1) throw new Error("Assistant capability removal changed unexpectedly.");
        await audit(database, context.workspaceId, companyId, profileId, capability, actorUserId, "removed", at);
      }
      for (const capability of wanted) if (!current.has(capability)) {
        await database.execute(`INSERT INTO assistant_profile_capabilities(workspace_id,company_id,assistant_profile_id,capability_key,assigned_by_actor_id,assigned_at) VALUES(?,?,?,?,?,?)`, [context.workspaceId, companyId, profileId, capability, actorUserId, at]);
        await audit(database, context.workspaceId, companyId, profileId, capability, actorUserId, "assigned", at);
      }
      return true;
    });
  }
}

async function audit(database: SqlDatabase, workspaceId: number, companyId: number, profileId: string, capability: string, actorUserId: string, eventType: "assigned" | "removed", at: string): Promise<void> {
  await database.execute(`INSERT INTO assistant_capability_audit_events(id,workspace_id,company_id,assistant_profile_id,capability_key,actor_user_id,event_type,occurred_at) VALUES(?,?,?,?,?,?,?,?)`, [randomUUID(), workspaceId, companyId, profileId, capability, actorUserId, eventType, at]);
}
