import type { IntegrationConnectionId } from "../domain/integrationConnection.js";
import type { WorkspaceContext } from "../../types/workspaceContext.js";

export interface ExternalProviderCredentialMaterial { readonly version: "v1"; readonly opaqueSecret: string; }
export type ExternalProviderCredentialResolution = { readonly kind: "resolved"; readonly provider: string; readonly integrationKind: string; readonly material: ExternalProviderCredentialMaterial } | { readonly kind: "not_found" | "unavailable" | "validation_error" };
export interface ExternalProviderCredentialResolverPort { resolve(context: WorkspaceContext, companyId: number, connectionId: IntegrationConnectionId): Promise<ExternalProviderCredentialResolution>; }
