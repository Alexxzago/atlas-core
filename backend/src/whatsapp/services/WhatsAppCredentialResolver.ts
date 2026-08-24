import type { WhatsAppConnectionCredentialRepositoryPort, WhatsAppCredentialCipherPort, WhatsAppCredentialResolverPort, WhatsAppLinkedIntegrationCredentialRepositoryPort } from "../application/ports.js";
import type { IntegrationSecretCipherPort } from "../../integrations/application/ports.js";
import type { WhatsAppConnectionId } from "../domain/whatsappConnection.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export class WhatsAppCredentialResolver implements WhatsAppCredentialResolverPort {
  public constructor(private readonly credentials: WhatsAppConnectionCredentialRepositoryPort, private readonly cipher: WhatsAppCredentialCipherPort, private readonly platformAccessToken: string, private readonly linked?: { readonly repository: WhatsAppLinkedIntegrationCredentialRepositoryPort; readonly cipher: IntegrationSecretCipherPort }) {}

  public resolve(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): string | null {
    if (this.linked && this.linked.repository.findIntegrationConnectionId(context, companyId, connectionId) !== null) {
      const encrypted = this.linked.repository.findReadyLinkedIntegrationSecret(context, companyId, connectionId);
      if (!encrypted) return null;
      try { return linkedToken(this.linked.cipher.decrypt(encrypted)); } catch { return null; }
    }
    const stored = this.credentials.findCredentials(context, companyId, connectionId);
    if (stored) return this.cipher.decrypt(stored.encryptedAccessToken);
    return this.platformAccessToken.trim() || null;
  }
}

function linkedToken(value: string): string | null { try { const parsed: unknown = JSON.parse(value); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null; const material = parsed as Record<string, unknown>; return material.version === "v1" && typeof material.opaqueSecret === "string" && material.opaqueSecret.trim() ? material.opaqueSecret : null; } catch { return null; } }
