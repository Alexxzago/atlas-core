import type { IntegrationProviderValidationInput, IntegrationProviderValidationPort } from "../../integrations/application/ports.js";
import type { IntegrationFailureCode } from "../../integrations/domain/integrationConnection.js";
import { META_WHATSAPP_CLOUD_API_INTEGRATION_KIND, META_WHATSAPP_INTEGRATION_PROVIDER } from "./metaEmbeddedSignup.js";
import type { MetaEmbeddedSignupProvider } from "../providers/MetaEmbeddedSignupProvider.js";

export interface MetaWhatsAppIntegrationConfiguration {
  readonly wabaId: string;
  readonly phoneNumberId: string;
  readonly graphApiVersion: string;
  readonly displayPhoneNumber?: string;
  readonly verifiedDisplayName?: string;
}

export class MetaWhatsAppIntegrationConfigurationError extends Error {}

export function reconstructMetaWhatsAppIntegrationConfiguration(value: Readonly<Record<string, unknown>>): MetaWhatsAppIntegrationConfiguration {
  const keys = Object.keys(value);
  if (!keys.every(key => key === "wabaId" || key === "phoneNumberId" || key === "graphApiVersion" || key === "displayPhoneNumber" || key === "verifiedDisplayName")) throw new MetaWhatsAppIntegrationConfigurationError("Meta WhatsApp Integration configuration is invalid.");
  const wabaId = numericId(value.wabaId), phoneNumberId = numericId(value.phoneNumberId), graphApiVersion = graphVersion(value.graphApiVersion);
  const displayPhoneNumber = optionalDisplay(value.displayPhoneNumber), verifiedDisplayName = optionalDisplay(value.verifiedDisplayName);
  return Object.freeze({ wabaId, phoneNumberId, graphApiVersion, ...(displayPhoneNumber === undefined ? {} : { displayPhoneNumber }), ...(verifiedDisplayName === undefined ? {} : { verifiedDisplayName }) });
}

export function metaWhatsAppIntegrationSecret(accessToken: string): string {
  if (!token(accessToken)) throw new MetaWhatsAppIntegrationConfigurationError("Meta WhatsApp Integration secret is invalid.");
  return JSON.stringify({ version: "v1", opaqueSecret: accessToken });
}

export class MetaWhatsAppIntegrationValidationProvider implements IntegrationProviderValidationPort {
  public constructor(private readonly provider: MetaEmbeddedSignupProvider) {}
  public async validate(input: IntegrationProviderValidationInput): Promise<{ readonly status: "valid" } | { readonly status: "invalid"; readonly failureCode: IntegrationFailureCode }> {
    if (input.provider !== META_WHATSAPP_INTEGRATION_PROVIDER || input.kind !== META_WHATSAPP_CLOUD_API_INTEGRATION_KIND) return { status: "invalid", failureCode: "provider_rejected" };
    let configuration: MetaWhatsAppIntegrationConfiguration, accessToken: string;
    try { configuration = reconstructMetaWhatsAppIntegrationConfiguration(input.configuration); accessToken = secret(input.plaintextSecret); }
    catch { return { status: "invalid", failureCode: "provider_rejected" }; }
    const result = await this.provider.verifyAssets({ whatsappBusinessAccountId: configuration.wabaId, phoneNumberId: configuration.phoneNumberId, accessToken, signal: new AbortController().signal });
    if (result.kind === "success") return result.asset.whatsappBusinessAccountId === configuration.wabaId && result.asset.phoneNumberId === configuration.phoneNumberId ? { status: "valid" } : { status: "invalid", failureCode: "provider_identity_mismatch" };
    return { status: "invalid", failureCode: failure(result.kind) };
  }
}

function secret(value: string): string { const parsed: unknown = JSON.parse(value); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid"); const material = parsed as Record<string, unknown>; if (material.version !== "v1" || !token(material.opaqueSecret) || Object.keys(material).length !== 2) throw new Error("invalid"); return material.opaqueSecret; }
function numericId(value: unknown): string { if (typeof value !== "string" || !/^\d{1,64}$/.test(value)) throw new MetaWhatsAppIntegrationConfigurationError("Meta WhatsApp Integration identifier is invalid."); return value; }
function graphVersion(value: unknown): string { if (typeof value !== "string" || !/^v[1-9]\d*\.\d+$/.test(value)) throw new MetaWhatsAppIntegrationConfigurationError("Meta WhatsApp Integration Graph version is invalid."); return value; }
function optionalDisplay(value: unknown): string | undefined { if (value === undefined) return undefined; if (typeof value !== "string") throw new MetaWhatsAppIntegrationConfigurationError("Meta WhatsApp Integration display is invalid."); const normalized = value.normalize("NFKC").trim(); if (!normalized || Array.from(normalized).length > 128 || /[\u0000-\u001f\u007f]/.test(normalized)) throw new MetaWhatsAppIntegrationConfigurationError("Meta WhatsApp Integration display is invalid."); return normalized; }
function token(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value); }
function failure(value: Exclude<Awaited<ReturnType<MetaEmbeddedSignupProvider["verifyAssets"]>>, { readonly kind: "success" }>["kind"]): IntegrationFailureCode { if (value === "unauthorized" || value === "forbidden") return "credentials_invalid"; if (value === "not_found" || value === "validation_error" || value === "invalid_response") return "provider_identity_mismatch"; if (value === "timeout") return "provider_timeout"; return value === "unavailable" || value === "rate_limited" || value === "conflict" ? "provider_unavailable" : "provider_rejected"; }
