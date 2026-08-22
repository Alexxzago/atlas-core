import type { IntegrationConnectionRepositoryPort, IntegrationSecretCipherPort } from "../application/ports.js";
import type { ExternalProviderCredentialResolution, ExternalProviderCredentialResolverPort } from "../application/externalProviderCredentials.js";
import type { IntegrationConnectionId } from "../domain/integrationConnection.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

/** Decrypts a current scoped connection secret only for provider adapter consumption. */
export class ScopedExternalProviderCredentialResolver implements ExternalProviderCredentialResolverPort {
  public constructor(private readonly connections: IntegrationConnectionRepositoryPort, private readonly cipher: IntegrationSecretCipherPort) {}
  public async resolve(context: WorkspaceContext, companyId: number, connectionId: IntegrationConnectionId): Promise<ExternalProviderCredentialResolution> {
    const connection = await this.connections.findById(context, companyId, connectionId);
    if (!connection) return { kind: "not_found" };
    const state = await this.connections.findState(context, companyId, connectionId);
    if (connection.status !== "active" || state?.validationState !== "valid" || state.healthState !== "healthy") return { kind: "unavailable" };
    const encrypted = await this.connections.findSecret(context, companyId, connectionId);
    if (!encrypted) return { kind: "unavailable" };
    try { const material = parse(this.cipher.decrypt(encrypted)); return { kind: "resolved", provider: connection.provider, integrationKind: connection.kind, material }; }
    catch { return { kind: "validation_error" }; }
  }
}
function parse(value: string): { readonly version: "v1"; readonly opaqueSecret: string } { if (value.length > 16_384) throw new Error("invalid"); const parsed: unknown = JSON.parse(value); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid"); const record = parsed as Record<string, unknown>; if (Object.keys(record).length !== 2 || record.version !== "v1" || typeof record.opaqueSecret !== "string" || !record.opaqueSecret.trim() || record.opaqueSecret.length > 16_000) throw new Error("invalid"); return Object.freeze({ version: "v1", opaqueSecret: record.opaqueSecret }); }
