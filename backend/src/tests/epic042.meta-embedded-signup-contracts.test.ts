import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { integrationConnectionId, integrationKind, integrationProvider } from "../integrations/domain/integrationConnection.js";
import { ProviderAdapterRegistry } from "../integrations/application/providerAdapterRegistry.js";
import {
  META_WHATSAPP_CLOUD_API_INTEGRATION_KIND,
  META_WHATSAPP_INTEGRATION_PROVIDER,
  MetaWhatsAppEmbeddedSignupContractError,
  reconstructMetaWhatsAppEmbeddedSignupStatus,
  reconstructWhatsAppConnectionIntegrationConnectionLink
} from "../whatsapp/application/metaEmbeddedSignup.js";
import { whatsAppConnectionId } from "../whatsapp/domain/whatsappConnection.js";

test("EPIC-042 fixes the Meta WhatsApp Integration Connection identity and defers registration until configured", async () => {
  assert.equal(integrationProvider(META_WHATSAPP_INTEGRATION_PROVIDER), "meta_whatsapp");
  assert.equal(integrationKind(META_WHATSAPP_CLOUD_API_INTEGRATION_KIND), "cloud_api");
  assert.equal(new ProviderAdapterRegistry().resolveValidation(META_WHATSAPP_INTEGRATION_PROVIDER, META_WHATSAPP_CLOUD_API_INTEGRATION_KIND), null);
  const composition = await readFile(new URL("../composition.ts", import.meta.url), "utf8");
  assert.equal(composition.includes("metaEmbeddedSignupProvider"), true);
});

test("EPIC-042 exposes only safe, server-verified Embedded Signup status and asset contracts", () => {
  const status = reconstructMetaWhatsAppEmbeddedSignupStatus({
    state: "completed",
    failureCode: null,
    verifiedAsset: { whatsappBusinessAccountId: "waba-verified", phoneNumberId: "phone-verified", displayPhoneNumber: "+1 555 0100" }
  });
  assert.deepEqual(status, { state: "completed", failureCode: null, verifiedAsset: { whatsappBusinessAccountId: "waba-verified", phoneNumberId: "phone-verified", displayPhoneNumber: "+1 555 0100" } });
  assert.equal(JSON.stringify(status).includes("token"), false);
  assert.ok(Object.isFrozen(status));
  assert.ok(Object.isFrozen(status.verifiedAsset));
  assert.throws(() => reconstructMetaWhatsAppEmbeddedSignupStatus({ state: "completed", failureCode: null, verifiedAsset: null }), MetaWhatsAppEmbeddedSignupContractError);
  assert.throws(() => reconstructMetaWhatsAppEmbeddedSignupStatus({ state: "failed", failureCode: null, verifiedAsset: null }), MetaWhatsAppEmbeddedSignupContractError);
});

test("EPIC-042 preserves the future null-or-Integration Connection credential source contract", () => {
  const legacy = reconstructWhatsAppConnectionIntegrationConnectionLink({ whatsAppConnectionId: whatsAppConnectionId("wac_0123456789abcdef0123456789abcdef"), integrationConnectionId: null });
  const managed = reconstructWhatsAppConnectionIntegrationConnectionLink({ whatsAppConnectionId: whatsAppConnectionId("wac_1123456789abcdef0123456789abcdef"), integrationConnectionId: integrationConnectionId("inc_0123456789abcdef0123456789abcdef") });
  assert.equal(legacy.integrationConnectionId, null);
  assert.equal(managed.integrationConnectionId, "inc_0123456789abcdef0123456789abcdef");
  assert.ok(Object.isFrozen(legacy));
  assert.ok(Object.isFrozen(managed));
});
