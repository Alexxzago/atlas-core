import assert from "node:assert/strict";
import test from "node:test";
import { StructuredMetaEmbeddedSignupAudit } from "../whatsapp/application/metaEmbeddedSignupAudit.js";
import { MetaWhatsAppReadinessService } from "../whatsapp/application/metaWhatsAppReadinessService.js";

const now = "2026-08-24T12:00:00.000Z";
const integrationId = "inc_11111111111111111111111111111111";
const whatsAppId = "wac_22222222222222222222222222222222";
const wabaId = "123456789012345";
const phoneNumberId = "987654321098765";

test("EPIC-042 structured Meta audit projects safe correlation fields only", () => {
  const original = console.info;
  const captured: string[] = [];
  console.info = (value?: unknown): void => { captured.push(String(value)); };

  try {
    new StructuredMetaEmbeddedSignupAudit().record({
      type: "meta_signup_ready",
      workspaceId: 1,
      companyId: 2,
      at: now,
      attemptId: "msa_33333333333333333333333333333333",
      integrationConnectionId: integrationId,
      whatsAppConnectionId: whatsAppId,
      subscriptionChanged: true,
      state: "raw-state",
      authorizationCode: "authorization-code",
      accessToken: "access-token",
      providerBody: "provider-body",
    } as never);
  } finally {
    console.info = original;
  }

  assert.equal(captured.length, 1);
  const event = JSON.parse(captured[0]!) as Record<string, unknown>;
  assert.equal(event.event, "meta_signup_ready");
  assert.equal(typeof event.timestamp, "string"); assert.ok(!Number.isNaN(Date.parse(event.timestamp as string))); assert.equal("at" in event, false);
  assert.equal(event.workspaceId, 1);
  assert.equal(event.companyId, 2);
  assert.equal(event.integrationConnectionId, integrationId);
  assert.equal(event.whatsAppConnectionId, whatsAppId);
  assert.equal("subscriptionChanged" in event, false);
  assert.doesNotMatch(captured[0]!, /raw-state|authorization-code|access-token|provider-body/);
});

test("EPIC-042 readiness audits confirmed subscription and activation idempotently", async () => {
  const events: Array<Record<string, unknown>> = [];
  let subscriptionInspection = 0;
  let whatsAppStatus: "inactive" | "active" = "inactive";

  const service = new MetaWhatsAppReadinessService(
    { findIntegrationConnectionId: () => integrationId } as never,
    { resolve: () => "transient-token" } as never,
    {
      inspect: async () => ({
        connection: {
          id: integrationId,
          workspaceId: 1,
          companyId: 2,
          provider: "meta_whatsapp",
          kind: "cloud_api",
          configuration: { wabaId, phoneNumberId, graphApiVersion: "v26.0" },
          status: "active",
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
        state: {
          connectionId: integrationId,
          validationState: "valid",
          validatedAt: now,
          validationFailureCode: null,
          healthState: "healthy",
          healthFailureCode: null,
          lastProviderActivityAt: now,
          updatedAt: now,
        },
        hasCurrentSecret: true,
      }),
      activate: async () => { throw new Error("integration already active"); },
    } as never,
    {
      get: () => ({
        id: whatsAppId,
        whatsappBusinessAccountId: wabaId,
        phoneNumberId,
        status: whatsAppStatus,
      }),
      validate: async () => ({ validationState: "valid" }),
      activate: async () => {
        whatsAppStatus = "active";
        return { connection: { status: "active" } };
      },
    } as never,
    {
      inspectWabaSubscription: async () => {
        subscriptionInspection += 1;
        return { kind: "success", subscribed: subscriptionInspection !== 1 };
      },
      subscribeWaba: async () => ({ kind: "success" }),
      unsubscribeWaba: async () => ({ kind: "success" }),
    } as never,
    { record: (event: Record<string, unknown>) => { events.push({ ...event }); } } as never,
    { now: () => now },
  );

  const first = await service.ensureReady({
    workspaceId: 1,
    companyId: 2,
    whatsAppConnectionId: whatsAppId,
    setupSubscription: true,
  });

  assert.equal(first.kind, "ready");
  assert.deepEqual(events.map(event => event.type), [
    "meta_signup_waba_subscription_confirmed",
    "meta_signup_whatsapp_activated",
    "meta_signup_ready",
  ]);
  assert.equal(events[0]?.subscriptionChanged, true);

  const second = await service.ensureReady({
    workspaceId: 1,
    companyId: 2,
    whatsAppConnectionId: whatsAppId,
    setupSubscription: true,
  });

  assert.equal(second.kind, "replayed");
  assert.equal(events.filter(event => event.type === "meta_signup_whatsapp_activated").length, 1);
  assert.equal(events.filter(event => event.type === "meta_signup_ready").length, 2);
  assert.doesNotMatch(JSON.stringify(events), /transient-token/);
});