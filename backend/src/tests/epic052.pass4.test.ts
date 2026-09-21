import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Router } from "express";
import { createApp } from "../app.js";
import { BillingApplicationService } from "../billing/application/billingApplicationService.js";
import { BillingOperationService } from "../billing/application/billingOperationService.js";
import {
  DeterministicFakeBillingProvider,
  mercadoPagoBillingProviderCapabilities,
  stripeBillingProviderCapabilities,
} from "../billing/application/billingProvider.js";
import { BillingProviderRegistry } from "../billing/application/billingProviderRegistry.js";
import { runMigrations } from "../config/migrations.js";
import { createBillingControllers } from "../controllers/billingController.js";
import { BillingOperationRepository } from "../repositories/billingOperationRepository.js";
import {
  BillingAccountRepository,
  BillingCatalogRepository,
  BillingProviderCommercialOfferRepository,
  BillingSubscriptionRepository,
} from "../repositories/billingRepository.js";
import { createBillingRouter } from "../routes/billing.js";
import { asyncBillingApplication } from "./helpers/asyncBillingTestComposition.js";

const at = "2026-09-14T00:00:00.000Z";
type ProviderKind = "stripe" | "mercadopago";
type Session = "member" | "platform" | null;

function open(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  runMigrations(db);
  return db;
}
function workspace(db: DatabaseSync): number {
  return (
    db.prepare("SELECT id FROM workspaces WHERE key='default'").get() as {
      id: number;
    }
  ).id;
}
function plan(db: DatabaseSync, key: string, kind: ProviderKind, amount = 100) {
  return new BillingCatalogRepository(db).create({
    planKey: key,
    catalogVersion: 1,
    displayName: `${key} plan`,
    interval: "month",
    currency: kind === "stripe" ? "USD" : "ARS",
    amountMinor: amount,
    lifecycle: "active",
    maxCompanies: 1,
    maxAssistantProfiles: 1,
    maxActiveChannels: 1,
    mutationEligible: true,
    entitlementDefinitionVersion: 1,
    providerKind: kind,
    providerPriceId: `${kind}_${key}`,
  });
}
function offer(db: DatabaseSync, entryId: string, kind: ProviderKind) {
  return new BillingProviderCommercialOfferRepository(
    db,
  ).findForCatalogProvider(entryId, kind)!;
}
function application(
  db: DatabaseSync,
  providers: BillingProviderRegistry,
): BillingApplicationService {
  return asyncBillingApplication(
    db,
    providers,
    {
      checkoutSuccess: "https://atlas.test/s",
      checkoutCancel: "https://atlas.test/c",
      portalReturn: "https://atlas.test/p",
    },
    () => at,
  );
}
function configureSubscription(
  db: DatabaseSync,
  entryId: string,
  selected: ReturnType<typeof offer>,
  kind: ProviderKind,
  state: "active" | "canceling_at_period_end" = "active",
): void {
  const account = new BillingAccountRepository(db).findByWorkspace(
    workspace(db),
  )!;
  db.prepare(
    "UPDATE billing_accounts SET rollout_mode='managed',provider_kind=?,provider_customer_id=? WHERE id=?",
  ).run(kind, "customer_secret", account.id);
  db.prepare(
    "UPDATE billing_subscriptions SET catalog_entry_id=?,provider_commercial_offer_id=?,provider_kind=?,provider_subscription_id=?,effective_state=? WHERE billing_account_id=?",
  ).run(entryId, selected.id, kind, "subscription_secret", state, account.id);
}
async function http(
  db: DatabaseSync,
  providers: BillingProviderRegistry,
  options: Readonly<{
    permissions?: readonly string[];
    session?: Session;
  }> = {},
) {
  const requested: string[] = [],
    permissions = options.permissions ?? ["workspace:read", "workspace:manage"],
    session = options.session === undefined ? "member" : options.session,
    service = application(db, providers);
  const router = createBillingRouter({
    authentication: {
      cookieName: () => "atlas",
      current: (value: string) =>
        value === "member"
          ? { userId: "member", authenticationIdentityId: "member_identity" }
          : value === "platform"
            ? {
                userId: "platform",
                authenticationIdentityId: "platform_identity",
              }
            : null,
      validateCsrf: () => true,
    } as never,
    users: {
      findById: (id: string) =>
        id === "member" || id === "platform" ? { id, status: "active" } : null,
    } as never,
    authorization: {
      authorize: (_user: unknown, _workspace: string, permission: string) => {
        requested.push(permission);
        if (!permissions.includes(permission)) throw new Error("denied");
        return {
          workspaceId: workspace(db),
          workspacePublicId: "default",
          userId: "member",
          membershipId: "member",
          role: "owner",
          capabilities: new Set(permissions),
          permission,
        };
      },
    } as never,
    resolver: {
      resolve: (value: unknown) => ({
        workspaceId: (value as { workspaceId: number }).workspaceId,
        workspaceKey: "default",
      }),
    } as never,
    originPolicy: { allows: () => true } as never,
    controllers: createBillingControllers(service),
  });
  const empty = Router(),
    app = createApp({
      authorizedCompaniesRouter: empty,
      billingRouter: router,
      chatRouter: empty,
      companiesRouter: empty,
      identityRouter: empty,
      knowledgeRouter: empty,
      publicWebChatRouter: empty,
      scrapeRouter: empty,
      workspacesRouter: empty,
    }),
    server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requested,
    session,
    close: async () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
function headers(session: Session = "member", changing = false): HeadersInit {
  return {
    ...(session ? { cookie: `atlas=${session}` } : {}),
    ...(changing
      ? { "content-type": "application/json", "x-csrf-token": "csrf" }
      : {}),
  };
}

test("EPIC052 PASS4 denies unauthenticated, unpermitted, and platform-only billing reads", async () => {
  const db = open();
  try {
    for (const options of [
      { session: null },
      { permissions: [], session: "member" as const },
      { permissions: ["platform:admin"], session: "platform" as const },
    ]) {
      const server = await http(db, new BillingProviderRegistry(), options);
      try {
        const response = await fetch(
          `${server.origin}/workspaces/default/billing/summary`,
          { headers: headers(server.session) },
        );
        assert.equal(response.status, 404);
      } finally {
        await server.close();
      }
    }
  } finally {
    db.close();
  }
});

test("EPIC052 PASS4 uses workspace:read for safe customer billing projections", async () => {
  const db = open();
  try {
    const entry = plan(db, "safe", "stripe"),
      stripe = offer(db, entry.id, "stripe"),
      mp = new BillingProviderCommercialOfferRepository(db).create({
        catalogEntryId: entry.id,
        providerKind: "mercadopago",
        offerVersion: 1,
        currency: "ARS",
        amountMinor: 2500,
        interval: "month",
        providerPlanReference: "mp_remote_secret",
        readinessState: "ready",
        lifecycle: "sellable",
        at,
      }),
      server = await http(
        db,
        new BillingProviderRegistry([
          { kind: "stripe", provider: new DeterministicFakeBillingProvider() },
          {
            kind: "mercadopago",
            provider: new DeterministicFakeBillingProvider(
              undefined,
              mercadoPagoBillingProviderCapabilities,
            ),
          },
        ]),
      );
    try {
      const summary = await fetch(
          `${server.origin}/workspaces/default/billing/summary`,
          { headers: headers() },
        ),
        offers = await fetch(
          `${server.origin}/workspaces/default/billing/offers`,
          { headers: headers() },
        );
      assert.equal(summary.status, 200);
      assert.equal(offers.status, 200);
      const body = (await offers.json()) as {
          offers: Array<Record<string, unknown>>;
        },
        projection = JSON.stringify({ summary: await summary.json(), body });
      assert.deepEqual(server.requested, ["workspace:read", "workspace:read"]);
      assert.deepEqual(
        body.offers.map((value) => [value.provider, value.currency]),
        [
          ["mercadopago", "ARS"],
          ["stripe", "USD"],
        ],
      );
      assert.equal(
        body.offers.find((value) => value.offerId === stripe.id)
          ?.checkoutAvailable,
        true,
      );
      assert.equal(
        body.offers.find((value) => value.offerId === mp.id)?.checkoutAvailable,
        false,
      );
      assert.deepEqual(Object.keys(body.offers[0]!).sort(), [
        "amountMinor",
        "checkoutAvailable",
        "currency",
        "description",
        "inclusions",
        "interval",
        "key",
        "name",
        "offerId",
        "provider",
        "version",
      ]);
      assert.equal(projection.includes("mp_remote_secret"), false);
      assert.equal(projection.includes(stripe.providerPlanReference), false);
      assert.equal(projection.includes("providerKind"), false);
    } finally {
      await server.close();
    }
  } finally {
    db.close();
  }
});

test("EPIC052 PASS4 read-only members cannot perform any customer billing mutation", async () => {
  const db = open();
  try {
    const entry = plan(db, "readonly", "stripe"),
      selected = offer(db, entry.id, "stripe"),
      provider = new DeterministicFakeBillingProvider(),
      server = await http(
        db,
        new BillingProviderRegistry([{ kind: "stripe", provider }]),
        { permissions: ["workspace:read"] },
      );
    try {
      for (const [path, body, key] of [
        ["checkout", { offerId: selected.id }, "checkout"],
        ["portal-sessions", {}, undefined],
        ["subscription/cancel", {}, "cancel"],
        ["subscription/reactivate", {}, "reactivate"],
      ] as const) {
        const response = await fetch(
          `${server.origin}/workspaces/default/billing/${path}`,
          {
            method: "POST",
            headers: {
              ...headers("member", true),
              ...(key ? { "idempotency-key": key } : {}),
            },
            body: JSON.stringify(body),
          },
        );
        assert.equal(response.status, 404);
      }
      assert.deepEqual(server.requested, [
        "workspace:manage",
        "workspace:manage",
        "workspace:manage",
        "workspace:manage",
      ]);
      assert.equal(provider.calls.length, 0);
    } finally {
      await server.close();
    }
  } finally {
    db.close();
  }
});

test("EPIC052 PASS4 shows historical Stripe USD and Mercado Pago ARS terms after repricing", async () => {
  const db = open();
  try {
    const stripeEntry = plan(db, "stripe-history", "stripe", 100),
      stripeOld = offer(db, stripeEntry.id, "stripe"),
      mpEntry = plan(db, "mp-history", "mercadopago", 2500),
      mpOld = offer(db, mpEntry.id, "mercadopago"),
      offers = new BillingProviderCommercialOfferRepository(db),
      account = new BillingAccountRepository(db).findByWorkspace(
        workspace(db),
      )!,
      service = application(
        db,
        new BillingProviderRegistry([
          { kind: "stripe", provider: new DeterministicFakeBillingProvider() },
          {
            kind: "mercadopago",
            provider: new DeterministicFakeBillingProvider(
              undefined,
              mercadoPagoBillingProviderCapabilities,
            ),
          },
        ]),
      );
    offers.create({
      catalogEntryId: stripeEntry.id,
      providerKind: "stripe",
      offerVersion: 2,
      currency: "USD",
      amountMinor: 900,
      interval: "year",
      providerPlanReference: "stripe_repriced",
      readinessState: "ready",
      lifecycle: "sellable",
      at,
    });
    offers.create({
      catalogEntryId: mpEntry.id,
      providerKind: "mercadopago",
      offerVersion: 2,
      currency: "ARS",
      amountMinor: 90000,
      interval: "year",
      providerPlanReference: "mp_repriced",
      readinessState: "ready",
      lifecycle: "sellable",
      at,
    });
    for (const [entry, selected, kind, currency, amount] of [
      [stripeEntry, stripeOld, "stripe", "USD", 100],
      [mpEntry, mpOld, "mercadopago", "ARS", 2500],
    ] as const) {
      db.prepare(
        "UPDATE billing_subscriptions SET catalog_entry_id=?,provider_commercial_offer_id=?,provider_kind=?,provider_subscription_id='historical_remote_id',effective_state='active' WHERE billing_account_id=?",
      ).run(entry.id, selected.id, kind, account.id);
      const summary = await service.customerSummary(workspace(db));
      assert.deepEqual(summary.subscription.plan, {
        key: entry.planKey,
        name: entry.displayName,
        interval: "month",
        currency,
        amountMinor: amount,
      });
      assert.equal(
        JSON.stringify(summary).includes("historical_remote_id"),
        false,
      );
    }
  } finally {
    db.close();
  }
});

test("EPIC052 PASS4 exposes only published plans with ready sellable offers", async () => {
  const db = open();
  try {
    const visible = plan(db, "visible", "stripe"),
      catalog = new BillingCatalogRepository(db),
      offers = new BillingProviderCommercialOfferRepository(db),
      draft = catalog.createDraft({
        planKey: "draft",
        catalogVersion: 1,
        displayName: "draft plan",
        maxCompanies: 1,
        maxAssistantProfiles: 1,
        maxActiveChannels: 1,
        mutationEligible: true,
        entitlementDefinitionVersion: 1,
        at,
      }),
      retired = new BillingCatalogRepository(db).create({
        planKey: "retired",
        catalogVersion: 1,
        displayName: "retired plan",
        interval: "month",
        currency: "USD",
        amountMinor: 500,
        lifecycle: "retired",
        maxCompanies: 1,
        maxAssistantProfiles: 1,
        maxActiveChannels: 1,
        mutationEligible: true,
        entitlementDefinitionVersion: 1,
        providerKind: "stripe",
        providerPriceId: "retired_offer",
      });
    offers.create({
      catalogEntryId: visible.id,
      providerKind: "stripe",
      offerVersion: 2,
      currency: "USD",
      amountMinor: 200,
      interval: "year",
      providerPlanReference: "not_ready",
      readinessState: "invalid",
      lifecycle: "sellable",
      at,
    });
    offers.create({
      catalogEntryId: visible.id,
      providerKind: "stripe",
      offerVersion: 3,
      currency: "USD",
      amountMinor: 300,
      interval: "year",
      providerPlanReference: "draft_offer",
      readinessState: "ready",
      lifecycle: "draft",
      at,
    });
    offers.create({
      catalogEntryId: draft.id,
      providerKind: "stripe",
      offerVersion: 1,
      currency: "USD",
      amountMinor: 400,
      interval: "month",
      providerPlanReference: "unpublished",
      readinessState: "ready",
      lifecycle: "draft",
      at,
    });
    assert.equal(retired.publicationState, "retired");
    assert.deepEqual(
      (
        await application(
          db,
          new BillingProviderRegistry([
            {
              kind: "stripe",
              provider: new DeterministicFakeBillingProvider(),
            },
          ]),
        ).offersForWorkspace(workspace(db))
      ).offers.map((value) => value.offerId),
      [offer(db, visible.id, "stripe").id],
    );
  } finally {
    db.close();
  }
});

test("EPIC052 PASS4 checkout accepts only offer ids and rejects changed-offer replays", async () => {
  const db = open();
  try {
    const entry = plan(db, "checkout", "stripe"),
      selected = offer(db, entry.id, "stripe"),
      replacement = new BillingProviderCommercialOfferRepository(db).create({
        catalogEntryId: entry.id,
        providerKind: "stripe",
        offerVersion: 2,
        currency: "USD",
        amountMinor: 200,
        interval: "year",
        providerPlanReference: "replacement_secret",
        readinessState: "ready",
        lifecycle: "sellable",
        at,
      }),
      provider = new DeterministicFakeBillingProvider({
        kind: "success",
        providerObjectId: "checkout_remote",
        redirectUrl: "https://checkout.test/session",
      }),
      server = await http(
        db,
        new BillingProviderRegistry([{ kind: "stripe", provider }]),
      );
    try {
      const hostile = await fetch(
        `${server.origin}/workspaces/default/billing/checkout`,
        {
          method: "POST",
          headers: headers("member", true),
          body: JSON.stringify({
            offerId: selected.id,
            amountMinor: 1,
            currency: "EUR",
          }),
        },
      );
      assert.equal(hostile.status, 400);
      const first = await fetch(
        `${server.origin}/workspaces/default/billing/checkout`,
        {
          method: "POST",
          headers: { ...headers("member", true), "idempotency-key": "same" },
          body: JSON.stringify({ offerId: selected.id }),
        },
      );
      const changed = await fetch(
        `${server.origin}/workspaces/default/billing/checkout`,
        {
          method: "POST",
          headers: { ...headers("member", true), "idempotency-key": "same" },
          body: JSON.stringify({ offerId: replacement.id }),
        },
      );
      assert.equal(first.status, 200);
      assert.equal(changed.status, 409);
      assert.equal(provider.calls.length, 1);
    } finally {
      await server.close();
    }
  } finally {
    db.close();
  }
});

test("EPIC052 PASS4 rejects a second active provider checkout without contacting it", async () => {
  const db = open();
  try {
    const stripeEntry = plan(db, "active-stripe", "stripe"),
      stripe = offer(db, stripeEntry.id, "stripe"),
      mpEntry = plan(db, "active-mp", "mercadopago", 2500),
      mp = offer(db, mpEntry.id, "mercadopago"),
      mpProvider = new DeterministicFakeBillingProvider(undefined, {
        ...mercadoPagoBillingProviderCapabilities,
        requiresPayerEmailForCheckout: false,
      });
    configureSubscription(db, stripeEntry.id, stripe, "stripe");
    const server = await http(
      db,
      new BillingProviderRegistry([
        { kind: "stripe", provider: new DeterministicFakeBillingProvider() },
        { kind: "mercadopago", provider: mpProvider },
      ]),
    );
    try {
      const response = await fetch(
        `${server.origin}/workspaces/default/billing/checkout`,
        {
          method: "POST",
          headers: {
            ...headers("member", true),
            "idempotency-key": "second-provider",
          },
          body: JSON.stringify({ offerId: mp.id }),
        },
      );
      assert.equal(response.status, 409);
      assert.equal(mpProvider.calls.length, 0);
    } finally {
      await server.close();
    }
  } finally {
    db.close();
  }
});

test("EPIC052 PASS4 derives Stripe and Mercado Pago management state and actions from capabilities", async () => {
  const db = open();
  try {
    const stripeEntry = plan(db, "stripe-actions", "stripe"),
      stripe = offer(db, stripeEntry.id, "stripe"),
      mpEntry = plan(db, "mp-actions", "mercadopago", 2500),
      mp = offer(db, mpEntry.id, "mercadopago"),
      stripeProvider = new DeterministicFakeBillingProvider(),
      mpProvider = new DeterministicFakeBillingProvider(
        undefined,
        mercadoPagoBillingProviderCapabilities,
      ),
      server = await http(
        db,
        new BillingProviderRegistry([
          { kind: "stripe", provider: stripeProvider },
          { kind: "mercadopago", provider: mpProvider },
        ]),
      );
    try {
      configureSubscription(db, stripeEntry.id, stripe, "stripe");
      let response = await fetch(
        `${server.origin}/workspaces/default/billing/management-actions`,
        { headers: headers() },
      );
      assert.deepEqual(await response.json(), {
        actions: ["portal", "cancel"],
        capabilities: {
          canOpenBillingPortal: true,
          canCancel: true,
          canReactivate: false,
          canStartNewCheckout: false,
          canSwitchProvider: false,
        },
      });
      response = await fetch(
        `${server.origin}/workspaces/default/billing/subscription/cancel`,
        {
          method: "POST",
          headers: { ...headers("member", true), "idempotency-key": "cancel" },
          body: "{}",
        },
      );
      assert.equal(response.status, 200);
      db.prepare(
        "UPDATE billing_subscriptions SET effective_state='canceling_at_period_end' WHERE billing_account_id=?",
      ).run(
        new BillingAccountRepository(db).findByWorkspace(workspace(db))!.id,
      );
      response = await fetch(
        `${server.origin}/workspaces/default/billing/subscription/reactivate`,
        {
          method: "POST",
          headers: {
            ...headers("member", true),
            "idempotency-key": "reactivate",
          },
          body: "{}",
        },
      );
      assert.equal(response.status, 200);
      configureSubscription(db, mpEntry.id, mp, "mercadopago");
      response = await fetch(
        `${server.origin}/workspaces/default/billing/management-actions`,
        { headers: headers() },
      );
      assert.deepEqual(await response.json(), {
        actions: [],
        capabilities: {
          canOpenBillingPortal: false,
          canCancel: false,
          canReactivate: false,
          canStartNewCheckout: false,
          canSwitchProvider: false,
        },
      });
      response = await fetch(
        `${server.origin}/workspaces/default/billing/subscription/cancel`,
        {
          method: "POST",
          headers: {
            ...headers("member", true),
            "idempotency-key": "mp-cancel",
          },
          body: "{}",
        },
      );
      assert.equal(response.status, 409);
      assert.deepEqual(
        stripeProvider.calls.map((value) => value.kind),
        ["subscription_cancel_at_period_end", "subscription_reactivate"],
      );
      assert.equal(mpProvider.calls.length, 0);
    } finally {
      await server.close();
    }
  } finally {
    db.close();
  }
});
