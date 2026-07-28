import type { WhatsAppConnectionCredentialRepositoryPort, WhatsAppCredentialCipherPort, WhatsAppCredentialResolverPort } from "../application/ports.js";
import type { WhatsAppConnectionId } from "../domain/whatsappConnection.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export class WhatsAppCredentialResolver implements WhatsAppCredentialResolverPort {
  public constructor(private readonly credentials: WhatsAppConnectionCredentialRepositoryPort, private readonly cipher: WhatsAppCredentialCipherPort, private readonly platformAccessToken: string) {}

  public resolve(context: WorkspaceContext, companyId: number, connectionId: WhatsAppConnectionId): string | null {
    const stored = this.credentials.findCredentials(context, companyId, connectionId);
    if (stored) return this.cipher.decrypt(stored.encryptedAccessToken);
    return this.platformAccessToken.trim() || null;
  }
}
