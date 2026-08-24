import type { ExternalProviderCredentialMaterial } from "../../integrations/application/externalProviderCredentials.js";
import { integrationConnectionId, type IntegrationConnectionId } from "../../integrations/domain/integrationConnection.js";
import { whatsAppConnectionId, type WhatsAppConnectionId } from "../domain/whatsappConnection.js";

export const META_WHATSAPP_INTEGRATION_PROVIDER = "meta_whatsapp";
export const META_WHATSAPP_CLOUD_API_INTEGRATION_KIND = "cloud_api";

export type MetaWhatsAppEmbeddedSignupState = "created" | "in_progress" | "completed" | "failed";
export type MetaWhatsAppEmbeddedSignupFailureCode = "cancelled" | "expired" | "verification_failed" | "provider_rejected" | "provider_unavailable";

/**
 * Server-verified Meta asset identifiers. Browser callback payloads must never
 * be projected into this contract without server-side verification.
 */
export interface MetaWhatsAppVerifiedAsset {
  readonly whatsappBusinessAccountId: string;
  readonly phoneNumberId: string;
  readonly displayPhoneNumber: string | null;
}

/** Safe status projection for future APIs. It intentionally contains no credential material. */
export interface MetaWhatsAppEmbeddedSignupStatus {
  readonly state: MetaWhatsAppEmbeddedSignupState;
  readonly failureCode: MetaWhatsAppEmbeddedSignupFailureCode | null;
  readonly verifiedAsset: MetaWhatsAppVerifiedAsset | null;
}

/**
 * Future persistence link. A null value means the WhatsApp Connection uses the
 * legacy manual credential store; a non-null value selects its Integration Connection.
 * Persistence must enforce that an Integration Connection is linked by at most one
 * WhatsApp Connection.
 */
export interface WhatsAppConnectionIntegrationConnectionLink {
  readonly whatsAppConnectionId: WhatsAppConnectionId;
  readonly integrationConnectionId: IntegrationConnectionId | null;
}

/** Meta credentials use the existing opaque encrypted secret envelope in PASS 1. */
export type MetaWhatsAppCredentialMaterial = ExternalProviderCredentialMaterial;

export class MetaWhatsAppEmbeddedSignupContractError extends Error {}

export function reconstructMetaWhatsAppVerifiedAsset(value: MetaWhatsAppVerifiedAsset): MetaWhatsAppVerifiedAsset {
  return Object.freeze({
    whatsappBusinessAccountId: identifier(value.whatsappBusinessAccountId, "WhatsApp Business Account ID"),
    phoneNumberId: identifier(value.phoneNumberId, "Phone Number ID"),
    displayPhoneNumber: value.displayPhoneNumber === null ? null : display(value.displayPhoneNumber)
  });
}

export function reconstructMetaWhatsAppEmbeddedSignupStatus(value: MetaWhatsAppEmbeddedSignupStatus): MetaWhatsAppEmbeddedSignupStatus {
  const state = signupState(value.state);
  const failureCode = value.failureCode === null ? null : signupFailureCode(value.failureCode);
  if ((state === "failed") !== (failureCode !== null) || (state === "completed") !== (value.verifiedAsset !== null) || (state !== "completed" && value.verifiedAsset !== null)) {
    throw new MetaWhatsAppEmbeddedSignupContractError("Meta WhatsApp Embedded Signup status is inconsistent.");
  }
  return Object.freeze({ state, failureCode, verifiedAsset: value.verifiedAsset === null ? null : reconstructMetaWhatsAppVerifiedAsset(value.verifiedAsset) });
}

export function reconstructWhatsAppConnectionIntegrationConnectionLink(value: WhatsAppConnectionIntegrationConnectionLink): WhatsAppConnectionIntegrationConnectionLink {
  return Object.freeze({
    whatsAppConnectionId: whatsAppConnectionId(value.whatsAppConnectionId),
    integrationConnectionId: value.integrationConnectionId === null ? null : integrationConnectionId(value.integrationConnectionId)
  });
}

function signupState(value: string): MetaWhatsAppEmbeddedSignupState {
  if (value === "created" || value === "in_progress" || value === "completed" || value === "failed") return value;
  throw new MetaWhatsAppEmbeddedSignupContractError("Meta WhatsApp Embedded Signup state is invalid.");
}

function signupFailureCode(value: string): MetaWhatsAppEmbeddedSignupFailureCode {
  if (value === "cancelled" || value === "expired" || value === "verification_failed" || value === "provider_rejected" || value === "provider_unavailable") return value;
  throw new MetaWhatsAppEmbeddedSignupContractError("Meta WhatsApp Embedded Signup failure code is invalid.");
}

function identifier(value: string, label: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || Array.from(normalized).length > 256) throw new MetaWhatsAppEmbeddedSignupContractError(`${label} is invalid.`);
  return normalized;
}

function display(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || Array.from(normalized).length > 128 || /[\u0000-\u001f\u007f]/.test(normalized)) throw new MetaWhatsAppEmbeddedSignupContractError("Meta WhatsApp display phone number is invalid.");
  return normalized;
}
