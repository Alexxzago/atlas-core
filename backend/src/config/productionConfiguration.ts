import { billingProviderRegistryFromEnvironment } from "../billing/application/billingProviderConfiguration.js";
import { integrationSecretCipherRingFromEnvironment } from "../integrations/infrastructure/aesGcmIntegrationSecretCipher.js";
import { AesGcmWhatsAppCredentialCipher } from "../whatsapp/infrastructure/aesGcmWhatsAppCredentialCipher.js";
import { emailDeliveryMode, type EmailDeliveryMode } from "../providers/emailDeliveryMode.js";
import { googleAppsScriptConfiguration } from "../providers/googleAppsScriptEmailDelivery.js";
import { resendConfiguration } from "../providers/resendEmailDelivery.js";
import { smtpConfiguration } from "../providers/smtpEmailDelivery.js";
import { s3MediaStorageConfiguration } from "./s3MediaStorageConfiguration.js";
import type { S3MediaStorageConfiguration } from "../media/infrastructure/s3MediaStorage.js";

export type ProductionConfigurationClass = "CORE_REQUIRED" | "REQUIRED_WHEN_ENABLED" | "OPTIONAL" | "PUBLIC_FRONTEND_ONLY";
export interface ProductionConfigurationInventoryEntry { readonly name: string; readonly classification: ProductionConfigurationClass; readonly enabledBy?: string; }
export const productionConfigurationInventory: readonly ProductionConfigurationInventoryEntry[] = Object.freeze([
  { name: "NODE_ENV, DATABASE_PROVIDER, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN", classification: "CORE_REQUIRED" },
  { name: "ATLAS_VERIFICATION_ORIGIN", classification: "CORE_REQUIRED" },
  { name: "ATLAS_BOOTSTRAP_SECRET", classification: "CORE_REQUIRED" },
  { name: "ATLAS_MEDIA_STORAGE_PROVIDER, ATLAS_S3_ENDPOINT, ATLAS_S3_REGION, ATLAS_S3_BUCKET, ATLAS_S3_ACCESS_KEY_ID, ATLAS_S3_SECRET_ACCESS_KEY", classification: "REQUIRED_WHEN_ENABLED", enabledBy: "any durable media S3 variable is configured" },
  { name: "EMAIL_PROVIDER, ATLAS_VERIFICATION_DELIVERY, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_REPLY_TO, RESEND_API_KEY, RESEND_FROM, RESEND_REPLY_TO, GOOGLE_APPS_SCRIPT_URL, GOOGLE_APPS_SCRIPT_TOKEN, EMAIL_TIMEOUT", classification: "REQUIRED_WHEN_ENABLED", enabledBy: "selected email delivery mode" },
  { name: "WHATSAPP_PLATFORM_ENCRYPTION_KEY, WHATSAPP_PLATFORM_ENCRYPTION_ACTIVE_KEY_ID, WHATSAPP_PLATFORM_ENCRYPTION_ACTIVE_KEY, WHATSAPP_PLATFORM_ENCRYPTION_PREVIOUS_KEY_ID, WHATSAPP_PLATFORM_ENCRYPTION_PREVIOUS_KEY, WHATSAPP_APP_SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN, WHATSAPP_GRAPH_API_VERSION", classification: "REQUIRED_WHEN_ENABLED", enabledBy: "WhatsApp credentials or webhook are configured" },
  { name: "ATLAS_INTEGRATION_SECRET_KEY, ATLAS_INTEGRATION_SECRET_ACTIVE_KEY_ID, ATLAS_INTEGRATION_SECRET_ACTIVE_KEY, ATLAS_INTEGRATION_SECRET_PREVIOUS_KEY_ID, ATLAS_INTEGRATION_SECRET_PREVIOUS_KEY, GOOGLE_CALENDAR_OAUTH_CLIENT_ID, GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET", classification: "REQUIRED_WHEN_ENABLED", enabledBy: "integration encryption or Google Calendar is configured" },
  { name: "META_APP_ID, META_APP_SECRET, META_EMBEDDED_SIGNUP_CONFIG_ID, META_EMBEDDED_SIGNUP_STATE_HMAC_KEY, META_GRAPH_API_VERSION", classification: "REQUIRED_WHEN_ENABLED", enabledBy: "Meta embedded signup is configured" },
  { name: "BILLING_PROVIDERS, STRIPE_SECRET_KEY, STRIPE_API_BASE_URL, STRIPE_TIMEOUT_MS, STRIPE_ALLOWED_REDIRECT_ORIGINS, STRIPE_API_VERSION, STRIPE_WEBHOOK_SIGNING_SECRET, MERCADOPAGO_ACCESS_TOKEN, MERCADOPAGO_API_BASE_URL, MERCADOPAGO_TIMEOUT_MS, MERCADOPAGO_ALLOWED_REDIRECT_ORIGINS, MERCADOPAGO_WEBHOOK_SECRET", classification: "REQUIRED_WHEN_ENABLED", enabledBy: "a billing provider or webhook is selected" },
  { name: "ATLAS_BACKUP_S3_ENDPOINT, ATLAS_BACKUP_S3_REGION, ATLAS_BACKUP_S3_BUCKET, ATLAS_BACKUP_S3_ACCESS_KEY_ID, ATLAS_BACKUP_S3_SECRET_ACCESS_KEY, ATLAS_RESTORE_S3_ENDPOINT, ATLAS_RESTORE_S3_REGION, ATLAS_RESTORE_S3_BUCKET, ATLAS_RESTORE_S3_ACCESS_KEY_ID, ATLAS_RESTORE_S3_SECRET_ACCESS_KEY, TURSO_ORG, TURSO_PLATFORM_TOKEN, TURSO_DATABASE_NAME, TURSO_DATABASE_GROUP, ATLAS_BACKUP_RETENTION_DAYS, ATLAS_BACKUP_MIN_COMPLETE_SETS", classification: "REQUIRED_WHEN_ENABLED", enabledBy: "backup, restore, or retention maintenance is run" },
  { name: "GEMINI_API_KEY, FIRECRAWL_API_KEY", classification: "OPTIONAL" },
  { name: "PORT, SHUTDOWN_TIMEOUT_MS, ATLAS_TRUSTED_LOCAL_MODE, ATLAS_ALLOWED_ORIGINS, ATLAS_BILLING_RETURN_ORIGIN, BILLING_RECONCILIATION_INTERVAL_MS, BILLING_RECONCILIATION_BATCH_SIZE, ATLAS_DEPLOYMENT_VERSION", classification: "OPTIONAL" },
  { name: "VITE_ATLAS_API_BASE_URL", classification: "PUBLIC_FRONTEND_ONLY" },
]);

export interface ProductionDatabaseConfiguration { readonly provider: "libsql"; readonly url: string; readonly authToken: string; }
export interface ProductionConfiguration { readonly database: ProductionDatabaseConfiguration; readonly verificationOrigin: string; readonly mediaStorage: S3MediaStorageConfiguration | null; readonly mediaCapability: "available" | "unavailable"; readonly emailDeliveryMode: EmailDeliveryMode; readonly whatsAppWebhookEnabled: boolean; }
export class ProductionConfigurationError extends Error {}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new ProductionConfigurationError(`Production configuration is invalid for ${name}.`);
  return value;
}

function httpsOrigin(environment: NodeJS.ProcessEnv, name: string): string {
  const value = required(environment, name);
  try { const url = new URL(value); if (url.protocol !== "https:" || url.origin !== value) throw new Error(); return url.origin; }
  catch { throw new ProductionConfigurationError(`Production configuration is invalid for ${name}.`); }
}

const mediaConfigurationNames = Object.freeze(["ATLAS_MEDIA_STORAGE_PROVIDER", "ATLAS_S3_ENDPOINT", "ATLAS_S3_REGION", "ATLAS_S3_BUCKET", "ATLAS_S3_ACCESS_KEY_ID", "ATLAS_S3_SECRET_ACCESS_KEY"] as const);

function mediaConfigurationEnabled(environment: NodeJS.ProcessEnv): boolean {
  return mediaConfigurationNames.some((name) => environment[name] !== undefined);
}

export function productionDatabaseConfiguration(environment: NodeJS.ProcessEnv = process.env): ProductionDatabaseConfiguration {
  if (environment.NODE_ENV !== "production") throw new ProductionConfigurationError("Production database configuration is only available when NODE_ENV=production.");
  if (environment.DATABASE_PROVIDER !== "libsql") throw new ProductionConfigurationError("Production requires DATABASE_PROVIDER=libsql; local SQLite is not permitted.");
  const url = environment.TURSO_DATABASE_URL?.trim(), authToken = environment.TURSO_AUTH_TOKEN?.trim();
  if (!url || !authToken) throw new ProductionConfigurationError("Production requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
  if (!/^libsqls?:\/\//i.test(url) && !/^https:\/\//i.test(url)) throw new ProductionConfigurationError("Production configuration is invalid for TURSO_DATABASE_URL.");
  return Object.freeze({ provider: "libsql", url, authToken });
}

function validateOptionalConfiguration(environment: NodeJS.ProcessEnv, emailMode: EmailDeliveryMode): void {
  try {
    if (emailMode === "smtp") smtpConfiguration(environment);
    if (emailMode === "resend") resendConfiguration(environment);
    if (emailMode === "google_apps_script") googleAppsScriptConfiguration(environment);
    if (environment.ATLAS_INTEGRATION_SECRET_KEY?.trim() || environment.ATLAS_INTEGRATION_SECRET_ACTIVE_KEY_ID?.trim() || environment.ATLAS_INTEGRATION_SECRET_ACTIVE_KEY?.trim() || environment.ATLAS_INTEGRATION_SECRET_PREVIOUS_KEY_ID?.trim() || environment.ATLAS_INTEGRATION_SECRET_PREVIOUS_KEY?.trim()) integrationSecretCipherRingFromEnvironment(environment);
    if (environment.BILLING_PROVIDERS?.trim()) billingProviderRegistryFromEnvironment(environment);
    const whatsappWebhook = Boolean(environment.WHATSAPP_APP_SECRET?.trim() || environment.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim());
    if (whatsappWebhook && (!environment.WHATSAPP_APP_SECRET?.trim() || !environment.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim())) throw new Error();
    const whatsappKey = environment.WHATSAPP_PLATFORM_ENCRYPTION_KEY?.trim();
    if (whatsappKey && !/^[0-9a-f]{64}$/i.test(whatsappKey) && Buffer.from(whatsappKey, "base64url").byteLength !== 32) throw new Error();
    const whatsAppActiveId=environment.WHATSAPP_PLATFORM_ENCRYPTION_ACTIVE_KEY_ID?.trim(),whatsAppActive=environment.WHATSAPP_PLATFORM_ENCRYPTION_ACTIVE_KEY?.trim(),whatsAppPreviousId=environment.WHATSAPP_PLATFORM_ENCRYPTION_PREVIOUS_KEY_ID?.trim(),whatsAppPrevious=environment.WHATSAPP_PLATFORM_ENCRYPTION_PREVIOUS_KEY?.trim();
    const validWhatsAppKey=(value:string)=>/^[0-9a-f]{64}$/i.test(value)||Buffer.from(value,"base64url").byteLength===32;
    if ((whatsAppActiveId||whatsAppActive||whatsAppPreviousId||whatsAppPrevious)&&(!whatsAppActiveId||!whatsAppActive||Boolean(whatsAppPreviousId)!==Boolean(whatsAppPrevious)||!/^[A-Za-z0-9_-]{1,32}$/u.test(whatsAppActiveId)||!validWhatsAppKey(whatsAppActive)||(whatsAppPreviousId!==undefined&&(!/^[A-Za-z0-9_-]{1,32}$/u.test(whatsAppPreviousId)||!validWhatsAppKey(whatsAppPrevious!))))) throw new Error();
    if (whatsAppActiveId&&whatsAppActive) new AesGcmWhatsAppCredentialCipher({activeKeyId:whatsAppActiveId,activeKey:Buffer.from(whatsAppActive,/^[0-9a-f]{64}$/i.test(whatsAppActive)?"hex":"base64url"),...(whatsAppPreviousId&&whatsAppPrevious?{previousKeyId:whatsAppPreviousId,previousKey:Buffer.from(whatsAppPrevious,/^[0-9a-f]{64}$/i.test(whatsAppPrevious)?"hex":"base64url")}:{})});
  } catch { throw new ProductionConfigurationError("Production configuration is invalid for an enabled provider."); }
}

export function productionConfiguration(environment: NodeJS.ProcessEnv = process.env): ProductionConfiguration {
  const database = productionDatabaseConfiguration(environment);
  const verificationOrigin = httpsOrigin(environment, "ATLAS_VERIFICATION_ORIGIN");
  let mediaStorage: S3MediaStorageConfiguration | null = null;
  if (mediaConfigurationEnabled(environment)) {
    try { mediaStorage = s3MediaStorageConfiguration(environment); }
    catch { throw new ProductionConfigurationError("Production configuration is invalid for durable media storage."); }
  }
  if ((environment.ATLAS_BOOTSTRAP_SECRET?.length ?? 0) < 32) throw new ProductionConfigurationError("Production configuration is invalid for ATLAS_BOOTSTRAP_SECRET.");
  let mode: EmailDeliveryMode;
  try { mode = emailDeliveryMode(environment.EMAIL_PROVIDER ?? environment.ATLAS_VERIFICATION_DELIVERY, true, environment); }
  catch { throw new ProductionConfigurationError("Production configuration is invalid for email delivery."); }
  validateOptionalConfiguration(environment, mode);
  return Object.freeze({ database, verificationOrigin, mediaStorage, mediaCapability: mediaStorage ? "available" : "unavailable", emailDeliveryMode: mode, whatsAppWebhookEnabled: Boolean(environment.WHATSAPP_APP_SECRET?.trim() && environment.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim()) });
}
