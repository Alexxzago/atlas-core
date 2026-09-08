import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import {
  AbuseLimitExceededError,
  RateLimitService,
} from "../abuse/rateLimitService.js";
import {
  SharedRateLimitRepository,
  abuseScope,
  normalizedIdentityScope,
} from "../abuse/sharedRateLimitRepository.js";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";
import { createValidateWhatsAppConnectionController } from "../controllers/WhatsAppConnectionController.js";
import { WhatsAppConnectionService } from "../whatsapp/services/WhatsAppConnectionService.js";
import { assistantProfileId } from "../assistant/domain/assistantProfile.js";
import {
  reconstructWhatsAppConnection,
  whatsAppConnectionId,
} from "../whatsapp/domain/whatsappConnection.js";
import {
  createRequestId,
  setOperationalLogSinkForTests,
  withRequestContext,
} from "../observability/operationalLogger.js";
import { createWhatsAppWebhookControllers } from "../controllers/WhatsAppWebhookController.js";
import { createWhatsAppWebhookRouter } from "../routes/whatsAppWebhook.js";
import { createCompanyKnowledgeControllers } from "../controllers/companyKnowledgeController.js";
import { createOnboardingController } from "../controllers/onboarding.js";
import { createApp } from "../app.js";
import { createScrapeRouter } from "../routes/scrape.js";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../config/migrations.js";
import { MetaEmbeddedSignupHttpService } from "../whatsapp/application/metaEmbeddedSignupHttpService.js";
import { createMetaEmbeddedSignupControllers } from "../controllers/metaEmbeddedSignupController.js";
import { configureProductionConversationMessageController } from "../routes/authorizedCompanies.js";
import { createOperatorConversationMessageController } from "../controllers/operatorConversationMessagingController.js";
import { OperatorConversationMessagingService } from "../conversation/services/operatorConversationMessagingService.js";
import { createIdentityRouter } from "../routes/identity.js";
import {
  createAuthenticationControllers,
  createPasswordResetControllers,
} from "../controllers/identityController.js";
import { WorkspaceAdministrationService } from "../workspace/services/workspaceAdministrationService.js";
import { SqliteWorkspaceAdministrationTransaction } from "../repositories/workspaceAdministrationTransaction.js";
import { createWorkspaceAdministrationControllers } from "../controllers/workspaceAdministrationController.js";
import { createWorkspacesRouter } from "../routes/workspaces.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { MembershipRepository } from "../repositories/workspaceAdministrationRepository.js";
import { UserRepository } from "../repositories/userRepository.js";
import { reconstructUser } from "../identity/domain/user.js";
import type {
  AssistantExecutionRequest,
  AssistantExecutionResult,
} from "../assistant/application/assistantExecution.js";
import { AssistantPreviewService } from "../assistant/services/assistantPreviewService.js";
import { OperationalAssistantRuntime } from "../assistant/services/operationalAssistantRuntime.js";
import { AssistantProfileService } from "../assistant/services/assistantProfileService.js";
import { AtlasAgent } from "../agents/atlas.js";
import { createAssistantPreviewController } from "../controllers/assistantPreviewController.js";
import { AssistantProfileRepository } from "../repositories/assistantProfileRepository.js";
import { AssistantExecutionRecordRepository } from "../repositories/assistantExecutionRecordRepository.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { KnowledgeRepository } from "../repositories/knowledgeRepository.js";
import { publishKnowledgeFixture } from "./knowledgeTestFixture.js";
import type { AnswerGenerator } from "../types/ports.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import { createProactiveActionControllers } from "../controllers/proactiveActionController.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { ProactiveActionRepository } from "../repositories/proactiveActionRepository.js";
import { ProactiveActionOperatorService } from "../proactive/services/proactiveActionOperatorService.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import {
  conversationId,
  conversationParticipantId,
  reconstructConversation,
  reconstructConversationMessage,
  reconstructConversationParticipant,
} from "../conversation/domain/conversation.js";

const policy = {
  action: "test_action",
  maximum: 3,
  windowMilliseconds: 60_000,
};

test("EPIC047 PASS5 shared fixed windows are atomic across service instances, isolated, and bounded", () => {
  const database = createDatabase(":memory:"),
    now = "2026-01-01T00:00:00.000Z";
  try {
    const first = new RateLimitService(
      new SharedRateLimitRepository(database),
      () => now,
    );
    const second = new RateLimitService(
      new SharedRateLimitRepository(database),
      () => now,
    );
    const actorA = abuseScope("workspace", 1, "company", 1, "actor", "usr_a"),
      actorB = abuseScope("workspace", 1, "company", 1, "actor", "usr_b"),
      tenantB = abuseScope("workspace", 2, "company", 2, "actor", "usr_a");
    first.enforce(actorA, "actor", policy);
    second.enforce(actorA, "actor", policy);
    first.enforce(actorA, "actor", policy);
    assert.throws(
      () => second.enforce(actorA, "actor", policy),
      AbuseLimitExceededError,
    );
    assert.doesNotThrow(() => first.enforce(actorB, "actor", policy));
    assert.doesNotThrow(() => second.enforce(tenantB, "actor", policy));
    const row = database
      .prepare(
        "SELECT count,scope_key,action_key FROM shared_rate_limit_windows WHERE count=3",
      )
      .get() as { count: number; scope_key: string; action_key: string };
    assert.equal(row.count, 3);
    assert.equal(row.scope_key.length, 64);
    assert.equal(row.action_key.length, 64);
  } finally {
    database.close();
  }
});

test("EPIC047 PASS5 invitation HTTP limiter rejects before proof, mutation, and delivery", async () => {
  const database = createDatabase(":memory:"),
    now = "2026-07-28T12:05:00.000Z",
    workspace = new WorkspaceRepository(database).resolveDefault(),
    users = new UserRepository(database),
    memberships = new MembershipRepository(database),
    limits = new RateLimitService(
      new SharedRateLimitRepository(database),
      () => now,
    ),
    logs: string[] = [];
  let proofs = 0,
    emails = 0;
  for (const id of ["actor-a", "actor-b"]) {
    users.create(
      reconstructUser({
        id: id as never,
        status: "active",
        locale: "en",
        authenticationIdentities: [{ id: `aid-${id}`, email: `${id}@example.test`, normalizedEmail: `${id}@example.test`, emailVerified: true, createdAt: now, updatedAt: now }],
        createdAt: now,
        updatedAt: now,
      }),
    );
    memberships.create({
      id: `mem-${id}` as never,
      workspaceId: workspace.id,
      userId: id as never,
      role: "owner",
      status: "active",
      version: 1,
      createdAt: now,
      activatedAt: now,
      suspendedAt: null,
      reactivatedAt: null,
      removedAt: null,
      roleChangedAt: null,
    });
  }
  const service = new WorkspaceAdministrationService(
      new SqliteWorkspaceAdministrationTransaction(database),
      {
        create: () => ({
          raw: `proof-${++proofs}`,
          digest: `digest-${proofs}`,
          version: "sha256-v1",
        }),
        parse: () => null,
      } as never,
      { now: () => now },
      {
        deliver: async () => {
          emails++;
          return "accepted" as const;
        },
      } as never,
      "https://atlas.test",
      undefined,
      limits,
    ),
    app = express(),
    restore = setOperationalLogSinkForTests((line) => logs.push(line));
  app.use((req, _res, next) =>
    withRequestContext(createRequestId(), () => next()),
  );
  app.use(express.json());
  app.use(
    "/workspaces",
    createWorkspacesRouter(
      createWorkspaceAdministrationControllers(
        service,
        {
          cookieName: () => "atlas",
          current: (raw: string) => ({ userId: raw }),
          validateCsrf: () => true,
        } as never,
        { allows: () => true } as never,
      ),
    ),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    request = (actor: string, email: string, xff: string) =>
      fetch(`${origin}/workspaces/${workspace.publicId}/invitations`, {
        method: "POST",
        headers: {
          cookie: `atlas=${actor}`,
          origin,
          "sec-fetch-site": "same-origin",
          "x-csrf-token": "csrf",
          "x-forwarded-for": xff,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email, role: "viewer" }),
      });
  try {
    for (let i = 0; i < 10; i++)
      assert.equal(
        (
          await request(
            "actor-a",
            `recipient-${i}@example.test`,
            `203.0.113.${i}`,
          )
        ).status,
        202,
      );
    const before = [
        proofs,
        emails,
        database
          .prepare("SELECT COUNT(*) count FROM workspace_invitations")
          .get() as { count: number },
      ],
      blocked = await request("actor-a", "changed@example.test", "192.0.2.9");
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "3300");
    assert.deepEqual(await blocked.json(), {
      error: {
        code: "rate_limited",
        message: "Request is temporarily unavailable.",
      },
    });
    assert.deepEqual(
      [
        proofs,
        emails,
        database
          .prepare("SELECT COUNT(*) count FROM workspace_invitations")
          .get(),
      ],
      before,
    );
    assert.equal(
      (await request("actor-b", "other@example.test", "198.51.100.9")).status,
      202,
    );
    const event = JSON.parse(logs.at(-1) ?? "{}") as Record<string, unknown>;
    assert.equal(event.event, "abuse_limit_exceeded");
    assert.match(String(event.requestId), /^req_[a-f0-9]{32}$/);
    const observed = JSON.stringify(logs);
    for (const value of ["changed@example.test", "192.0.2.9", "actor-a"])
      assert.equal(observed.includes(value), false);
  } finally {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  }
});

test("EPIC047 PASS5 invitation workspace limits preserve tenant and authorization fences", async () => {
  const database=createDatabase(":memory:"),now="2026-07-28T12:05:00.000Z",workspaces=new WorkspaceRepository(database),first=workspaces.resolveDefault(),second=workspaces.createForSystemUse({key:"second",name:"Second"}),users=new UserRepository(database),memberships=new MembershipRepository(database),limits=new RateLimitService(new SharedRateLimitRepository(database),()=>now);let proofs=0,emails=0;for(const id of[...Array.from({length:31},(_,i)=>`owner-${i}`),"viewer"]){users.create(reconstructUser({id:id as never,status:"active",locale:"en",authenticationIdentities:[{id:`aid-${id}`,email:`${id}@example.test`,normalizedEmail:`${id}@example.test`,emailVerified:true,createdAt:now,updatedAt:now}],createdAt:now,updatedAt:now}));for(const workspace of[first,second])memberships.create({id:`mem-${workspace.id}-${id}`as never,workspaceId:workspace.id,userId:id as never,role:id==="viewer"?"viewer":"owner",status:"active",version:1,createdAt:now,activatedAt:now,suspendedAt:null,reactivatedAt:null,removedAt:null,roleChangedAt:null});}const service=new WorkspaceAdministrationService(new SqliteWorkspaceAdministrationTransaction(database),{create:()=>({raw:`proof-${++proofs}`,digest:`digest-${proofs}`,version:"sha256-v1"}),parse:()=>null}as never,{now:()=>now},{deliver:async()=>{emails++;return"accepted"as const;}}as never,"https://atlas.test",undefined,limits),app=express();app.use(express.json());app.use("/workspaces",createWorkspacesRouter(createWorkspaceAdministrationControllers(service,{cookieName:()=>"atlas",current:(raw:string)=>({userId:raw}),validateCsrf:()=>true}as never,{allows:()=>true}as never)));const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));const origin=`http://127.0.0.1:${(server.address()as AddressInfo).port}`,request=(actor:string,workspace:string,email:string)=>fetch(`${origin}/workspaces/${workspace}/invitations`,{method:"POST",headers:{cookie:`atlas=${actor}`,origin,"sec-fetch-site":"same-origin","x-csrf-token":"csrf","content-type":"application/json"},body:JSON.stringify({email,role:"viewer"})});try{for(let i=0;i<30;i++)assert.equal((await request(`owner-${i}`,first.publicId,`recipient-${i}@example.test`)).status,202);const before=[proofs,emails,database.prepare("SELECT COUNT(*) count FROM workspace_invitations").get()as{count:number}],blocked=await request("owner-30",first.publicId,"blocked@example.test");assert.equal(blocked.status,429);assert.equal(blocked.headers.get("retry-after"),"3300");assert.deepEqual(await blocked.json(),{error:{code:"rate_limited",message:"Request is temporarily unavailable."}});assert.deepEqual([proofs,emails,database.prepare("SELECT COUNT(*) count FROM workspace_invitations").get()],before);assert.equal((await request("owner-30",second.publicId,"second@example.test")).status,202);const deniedBefore=[proofs,emails,database.prepare("SELECT COUNT(*) count FROM workspace_invitations").get()as{count:number}],denied=await request("viewer",first.publicId,"denied@example.test");assert.equal(denied.status,404);assert.deepEqual([proofs,emails,database.prepare("SELECT COUNT(*) count FROM workspace_invitations").get()],deniedBefore);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));database.close();}
});

test("EPIC047 PASS5 identity keys are private, per identity, and reset in a new fixed window", () => {
  const database = createDatabase(":memory:"),
    email = normalizedIdentityScope("User@Example.Test");
  try {
    const repository = new SharedRateLimitRepository(database);
    assert.notEqual(email, "user@example.test");
    for (let index = 0; index < 3; index++)
      assert.equal(
        repository.consume(email, policy, "2026-01-01T00:00:00.000Z").allowed,
        true,
      );
    assert.equal(
      repository.consume(email, policy, "2026-01-01T00:00:00.000Z").allowed,
      false,
    );
    assert.equal(
      repository.consume(
        normalizedIdentityScope("other@example.test"),
        policy,
        "2026-01-01T00:00:00.000Z",
      ).allowed,
      true,
    );
    assert.equal(
      repository.consume(email, policy, "2026-01-01T00:01:00.000Z").allowed,
      true,
    );
  } finally {
    database.close();
  }
});

test("EPIC047 PASS5A validates WhatsApp through the real authorized HTTP path with isolated durable limits", async () => {
  const database = createDatabase(":memory:"),
    now = "2026-07-28T12:05:00.000Z",
    context = { workspaceId: 1, workspaceKey: "one" },
    connection = reconstructWhatsAppConnection({
      id: whatsAppConnectionId("wac_0123456789abcdef0123456789abcdef"),
      workspaceId: 1,
      companyId: 1,
      assistantProfileId: assistantProfileId(
        "asp_0123456789abcdef0123456789abcdef",
      ),
      phoneNumberId: "phone-private",
      whatsappBusinessAccountId: "waba-private",
      status: "inactive",
      createdAt: now,
      updatedAt: now,
    });
  let providerCalls = 0,
    stateWrites = 0;
  const states = {
    findOperationalState: () => ({
      validationState: "not_validated",
      validatedAt: null,
      validationFailureCode: null,
      healthState: "inactive",
      lastProviderActivityAt: null,
      lastWebhookActivityAt: null,
      healthFailureCode: null,
      updatedAt: now,
    }),
    replaceOperationalState: () => {
      stateWrites++;
      return true;
    },
  };
  const connections = {
    findById: () => connection,
    findCredentials: () => ({ encryptedAccessToken: "cipher" }),
    ...states,
  };
  const service = new WhatsAppConnectionService(
    { findById: () => ({}) } as never,
    {} as never,
    connections as never,
    { now: () => now },
    {
      credentials: connections as never,
      states: connections as never,
      cipher: {} as never,
      resolver: { resolve: () => "token-private" },
      validator: {
        validateConnection: async () => {
          providerCalls++;
          return { status: "valid" as const };
        },
      },
      knowledge: {} as never,
    },
  );
  service.setRateLimiter(
    new RateLimitService(new SharedRateLimitRepository(database), () => now),
  );
  const app = express(),
    logs: string[] = [],
    restoreLogSink = setOperationalLogSinkForTests((line) => logs.push(line));
  app.use((req, _res, next) =>
    withRequestContext(createRequestId(), () => next()),
  );
  app.use(express.json());
  app.use(
    "/workspaces",
    createAuthorizedCompaniesRouter({
      authentication: {
        cookieName: () => "atlas",
        current: (raw: string) => ({ userId: raw }),
        validateCsrf: () => true,
      } as never,
      users: { findById: (id: string) => ({ id }) } as never,
      authorization: {
        authorize: (user: { id: string }, workspace: string) => ({
          userId: user.id,
          membershipId: "membership",
          role: "operator",
          capabilities: [],
          workspaceId: workspace === "two" ? 2 : 1,
        }),
      } as never,
      resolver: {
        resolve: (decision: { workspaceId: number }) => ({
          workspaceId: decision.workspaceId,
          workspaceKey: "one",
        }),
      } as never,
      controllers: {} as never,
      assistantControllers: {} as never,
      whatsAppConnectionControllers: {
        list: () => (() => undefined) as never,
        create: () => (() => undefined) as never,
        get: () => (() => undefined) as never,
        update: () => (() => undefined) as never,
        validate: (value) =>
          createValidateWhatsAppConnectionController(service, value),
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    request = (actor: string, workspace = "one", xff = "203.0.113.9") =>
      fetch(
        `${origin}/workspaces/${workspace}/companies/1/whatsapp-connections/${connection.id}/validation`,
        {
          method: "POST",
          headers: {
            cookie: `atlas=${actor}`,
            origin,
            "sec-fetch-site": "same-origin",
            "x-csrf-token": "csrf",
            "x-forwarded-for": xff,
          },
        },
      );
  try {
    for (let index = 0; index < 5; index++)
      assert.equal(
        (await request("actor-a", "one", `203.0.113.${index}`)).status,
        200,
      );
    const blocked = await request("actor-a", "one", "198.51.100.99");
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "600");
    assert.deepEqual(await blocked.json(), {
      error: {
        code: "rate_limited",
        message: "Request is temporarily unavailable.",
      },
    });
    assert.equal(providerCalls, 5);
    assert.equal(stateWrites, 5);
    const event = JSON.parse(logs.at(-1) ?? "{}") as Record<string, unknown>;
    assert.equal(event.event, "abuse_limit_exceeded");
    assert.match(String(event.requestId), /^req_[a-f0-9]{32}$/);
    assert.equal(JSON.stringify(event).includes("token-private"), false);
    assert.equal(JSON.stringify(event).includes("phone-private"), false);
    assert.equal(JSON.stringify(event).includes("198.51.100.99"), false);
    for (const actor of ["actor-b", "actor-c", "actor-d", "actor-e", "actor-f"])
      assert.equal((await request(actor)).status, 200);
    const companyBlocked = await request("actor-g");
    assert.equal(companyBlocked.status, 429);
    assert.equal(companyBlocked.headers.get("retry-after"), "3300");
    assert.deepEqual(await companyBlocked.json(), {
      error: {
        code: "rate_limited",
        message: "Request is temporarily unavailable.",
      },
    });
    assert.equal(providerCalls, 10);
    assert.equal(stateWrites, 10);
    assert.equal((await request("actor-a", "two")).status, 200);
  } finally {
    restoreLogSink();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  }
});

test("EPIC047 PASS5A accepts a valid duplicate WhatsApp callback without shared limiter use", async () => {
  const database = createDatabase(":memory:"),
    raw = Buffer.from(
      JSON.stringify({
        entry: [{ changes: [{ field: "messages", value: {} }] }],
      }),
    );
  let acknowledgements = 0;
  const callback = {
    verify: () => null,
    signatureValid: (value: Buffer, signature: unknown) =>
      value.equals(raw) && signature === "sha256=valid",
    parseEvents: () => [{ id: "event-1" }],
    acknowledge: async () => {
      acknowledgements++;
    },
  };
  const app = express();
  app.use(
    "/webhooks",
    createWhatsAppWebhookRouter(
      createWhatsAppWebhookControllers(callback as never),
    ),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (let index = 0; index < 2; index++)
      assert.equal(
        (
          await fetch(`${origin}/webhooks/whatsapp`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-hub-signature-256": "sha256=valid",
            },
            body: raw,
          })
        ).status,
        200,
      );
    assert.equal(acknowledgements, 2);
    assert.equal(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM shared_rate_limit_windows")
          .get() as { count: number }
      ).count,
      0,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  }
});

test("EPIC047 PASS5B limits real authenticated Knowledge ingestion before any expensive initiation", async () => {
  const database = createDatabase(":memory:"),
    now = "2026-07-28T12:05:00.000Z",
    logs: string[] = [];
  let starts = 0;
  const service = {
    list: () => [],
    create: async () => {
      starts++;
      return {
        source: { id: `source-${starts}`, version: 1 },
        revision: { id: `revision-${starts}` },
      };
    },
    revise: async () => {
      starts++;
      return {
        source: { id: `source-${starts}`, version: 1 },
        revision: { id: `revision-${starts}` },
      };
    },
  };
  const limits = new RateLimitService(
      new SharedRateLimitRepository(database),
      () => now,
    ),
    app = express(),
    restore = setOperationalLogSinkForTests((line) => logs.push(line));
  app.use((req, _res, next) =>
    withRequestContext(createRequestId(), () => next()),
  );
  app.use(express.json());
  app.use(
    "/workspaces",
    createAuthorizedCompaniesRouter({
      authentication: {
        cookieName: () => "atlas",
        current: (raw: string) => ({ userId: raw }),
        validateCsrf: () => true,
      } as never,
      users: { findById: (id: string) => ({ id }) } as never,
      authorization: {
        authorize: (user: { id: string }, workspace: string) => ({
          userId: user.id,
          membershipId: "membership",
          role: "owner",
          capabilities: [],
          workspaceId: workspace === "two" ? 2 : 1,
        }),
      } as never,
      resolver: {
        resolve: (decision: { workspaceId: number }) => ({
          workspaceId: decision.workspaceId,
          workspaceKey: decision.workspaceId === 2 ? "two" : "one",
        }),
      } as never,
      controllers: {} as never,
      assistantControllers: {} as never,
      knowledgeControllers: createCompanyKnowledgeControllers(
        service as never,
        limits,
      ),
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    request = (
      actor: string,
      path = "manual",
      workspace = "one",
      xff = "203.0.113.7",
    ) =>
      fetch(
        `${origin}/workspaces/${workspace}/companies/1/knowledge/sources/${path}`,
        {
          method: "POST",
          headers: {
            cookie: `atlas=${actor}`,
            origin,
            "sec-fetch-site": "same-origin",
            "x-csrf-token": "csrf",
            "x-forwarded-for": xff,
            "content-type": "application/json",
          },
          body: JSON.stringify(
            path === "url"
              ? {
                  name: "hostile-name",
                  url: "https://hostile-url.test/private",
                }
              : { name: "hostile-name", text: "hostile document content" },
          ),
        },
      );
  try {
    assert.equal((await request("actor-a")).status, 201);
    for (let i = 0; i < 2; i++)
      assert.equal(
        (await request("actor-a", "url", "one", `198.51.100.${i}`)).status,
        201,
      );
    const actorBlocked = await request("actor-a", "url", "one", "192.0.2.9");
    assert.equal(actorBlocked.status, 429);
    assert.equal(actorBlocked.headers.get("retry-after"), "600");
    assert.deepEqual(await actorBlocked.json(), {
      error: {
        code: "rate_limited",
        message: "Request is temporarily unavailable.",
      },
    });
    assert.equal(starts, 3);
    for (const actor of [
      "actor-b",
      "actor-c",
      "actor-d",
      "actor-e",
      "actor-f",
      "actor-g",
      "actor-h",
    ])
      assert.equal((await request(actor, "manual")).status, 201);
    const companyBlocked = await request("actor-i");
    assert.equal(companyBlocked.status, 429);
    assert.equal(companyBlocked.headers.get("retry-after"), "3300");
    assert.equal(starts, 10);
    assert.equal((await request("actor-z", "manual", "two")).status, 201);
    const event = JSON.parse(logs.at(-1) ?? "{}") as Record<string, unknown>;
    assert.equal(event.event, "abuse_limit_exceeded");
    assert.match(String(event.requestId), /^req_[a-f0-9]{32}$/);
    const observed = JSON.stringify(logs);
    for (const secret of [
      "hostile-url.test",
      "hostile-name",
      "hostile document content",
      "192.0.2.9",
    ])
      assert.equal(observed.includes(secret), false);
  } finally {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  }
});

test("EPIC047 PASS5B rejects PDF creation and URL revision before their expensive pipelines", async () => {
  const database = createDatabase(":memory:"),
    now = "2026-07-28T12:05:00.000Z",
    logs: string[] = [];
  let creates = 0,
    revisions = 0,
    pdfWork = 0,
    fetches = 0,
    gemini = 0,
    mutations = 0;
  const service = {
    list: () => [],
    create: async (
      _c: unknown,
      _a: unknown,
      _company: unknown,
      kind: string,
    ) => {
      creates++;
      if (kind === "pdf") pdfWork++;
      gemini++;
      mutations++;
      return {
        source: { id: `source-${creates}`, version: 1 },
        revision: { id: `revision-${creates}` },
      };
    },
    revise: async (
      _c: unknown,
      _a: unknown,
      _company: unknown,
      _source: unknown,
      kind: string,
    ) => {
      revisions++;
      if (kind === "public_url") fetches++;
      gemini++;
      mutations++;
      return {
        source: { id: "source-existing", version: 2 },
        revision: { id: `revision-${revisions}` },
      };
    },
  };
  const limits = new RateLimitService(
      new SharedRateLimitRepository(database),
      () => now,
    ),
    app = express(),
    restore = setOperationalLogSinkForTests((line) => logs.push(line));
  app.use((req, _res, next) =>
    withRequestContext(createRequestId(), () => next()),
  );
  app.use(express.json());
  app.use(
    "/workspaces",
    createAuthorizedCompaniesRouter({
      authentication: {
        cookieName: () => "atlas",
        current: (raw: string) => ({ userId: raw }),
        validateCsrf: () => true,
      } as never,
      users: { findById: (id: string) => ({ id }) } as never,
      authorization: {
        authorize: (user: { id: string }) => ({
          userId: user.id,
          membershipId: "membership",
          role: "owner",
          capabilities: [],
          workspaceId: 1,
        }),
      } as never,
      resolver: {
        resolve: () => ({ workspaceId: 1, workspaceKey: "one" }),
      } as never,
      controllers: {} as never,
      assistantControllers: {} as never,
      knowledgeControllers: createCompanyKnowledgeControllers(
        service as never,
        limits,
      ),
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    headers = (actor: string, type: string, xff: string) => ({
      cookie: `atlas=${actor}`,
      origin,
      "sec-fetch-site": "same-origin",
      "x-csrf-token": "csrf",
      "x-forwarded-for": xff,
      "content-type": type,
    }),
    pdf = (actor: string, xff = "203.0.113.7") =>
      fetch(`${origin}/workspaces/one/companies/1/knowledge/sources/pdf`, {
        method: "POST",
        headers: headers(actor, "application/pdf", xff),
        body: Buffer.from("hostile-filename.pdf hostile-document-content"),
      }),
    revision = (actor: string, xff = "198.51.100.7") =>
      fetch(
        `${origin}/workspaces/one/companies/1/knowledge/sources/source-existing/revisions/url`,
        {
          method: "POST",
          headers: headers(actor, "application/json", xff),
          body: JSON.stringify({
            expectedSourceVersion: 1,
            url: "https://hostile-url.test/provider-payload",
          }),
        },
      );
  try {
    for (let index = 0; index < 3; index++)
      assert.equal((await pdf("pdf-actor", `203.0.113.${index}`)).status, 201);
    const pdfBefore = [creates, pdfWork, gemini, mutations],
      pdfBlocked = await pdf("pdf-actor", "192.0.2.9");
    assert.equal(pdfBlocked.status, 429);
    assert.equal(pdfBlocked.headers.get("retry-after"), "600");
    assert.deepEqual(await pdfBlocked.json(), {
      error: {
        code: "rate_limited",
        message: "Request is temporarily unavailable.",
      },
    });
    assert.deepEqual([creates, pdfWork, gemini, mutations], pdfBefore);
    assert.equal((await pdf("pdf-other")).status, 201);
    for (let index = 0; index < 3; index++)
      assert.equal(
        (await revision("revision-actor", `198.51.100.${index}`)).status,
        201,
      );
    const revisionBefore = [revisions, fetches, pdfWork, gemini, mutations],
      revisionBlocked = await revision("revision-actor", "192.0.2.99");
    assert.equal(revisionBlocked.status, 429);
    assert.equal(revisionBlocked.headers.get("retry-after"), "600");
    assert.deepEqual(await revisionBlocked.json(), {
      error: {
        code: "rate_limited",
        message: "Request is temporarily unavailable.",
      },
    });
    assert.deepEqual(
      [revisions, fetches, pdfWork, gemini, mutations],
      revisionBefore,
    );
    const observed = JSON.stringify(logs);
    for (const secret of [
      "hostile-filename.pdf",
      "hostile-document-content",
      "hostile-url.test",
      "provider-payload",
      "192.0.2.99",
    ])
      assert.equal(observed.includes(secret), false);
    const events = logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.event === "abuse_limit_exceeded");
    assert.equal(events.length, 2);
    for (const event of events)
      assert.match(String(event.requestId), /^req_[a-f0-9]{32}$/);
  } finally {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  }
});

test("EPIC047 PASS5C scope keeps legacy scrape out of production while preserving development behavior", async () => {
  let calls = 0;
  const router = createScrapeRouter(async (_req, res) => {
      calls++;
      res.json({ ok: true });
    }),
    empty = express.Router(),
    production = createApp(
      {
        authorizedCompaniesRouter: empty,
        chatRouter: empty,
        companiesRouter: empty,
        identityRouter: empty,
        knowledgeRouter: empty,
        publicWebChatRouter: empty,
        scrapeRouter: router,
        workspacesRouter: empty,
      },
      { production: true },
    ),
    development = createApp(
      {
        authorizedCompaniesRouter: empty,
        chatRouter: empty,
        companiesRouter: empty,
        identityRouter: empty,
        knowledgeRouter: empty,
        publicWebChatRouter: empty,
        scrapeRouter: router,
        workspacesRouter: empty,
      },
      { production: false },
    );
  const first = production.listen(0, "127.0.0.1"),
    second = development.listen(0, "127.0.0.1");
  await Promise.all([
    new Promise<void>((resolve) => first.once("listening", resolve)),
    new Promise<void>((resolve) => second.once("listening", resolve)),
  ]);
  try {
    const productionOrigin = `http://127.0.0.1:${(first.address() as AddressInfo).port}`,
      developmentOrigin = `http://127.0.0.1:${(second.address() as AddressInfo).port}`;
    assert.equal(
      (
        await fetch(`${productionOrigin}/scrape`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"url":"https://provider.test"}',
        })
      ).status,
      404,
    );
    assert.equal(calls, 0);
    assert.equal(
      (
        await fetch(`${developmentOrigin}/scrape`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"url":"https://provider.test"}',
        })
      ).status,
      200,
    );
    assert.equal(calls, 1);
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => first.close(() => resolve())),
      new Promise<void>((resolve) => second.close(() => resolve())),
    ]);
  }
});

test("EPIC047 PASS5C scope limits real authenticated onboarding before any service work", async () => {
  const database = createDatabase(":memory:"),
    now = "2026-07-28T12:05:00.000Z",
    logs: string[] = [];
  let serviceCalls = 0;
  const service = {
    validateTarget: () => undefined,
    onboard: async () => {
      serviceCalls++;
      return { companyId: 1, status: "ready", knowledge: {} };
    },
  };
  const limits = new RateLimitService(
      new SharedRateLimitRepository(database),
      () => now,
    ),
    app = express(),
    restore = setOperationalLogSinkForTests((line) => logs.push(line));
  app.use((req, _res, next) =>
    withRequestContext(createRequestId(), () => next()),
  );
  app.use(express.json());
  app.use(
    "/workspaces",
    createAuthorizedCompaniesRouter({
      authentication: {
        cookieName: () => "atlas",
        current: (raw: string) => ({ userId: raw }),
        validateCsrf: () => true,
      } as never,
      users: { findById: (id: string) => ({ id }) } as never,
      authorization: {
        authorize: (user: { id: string }, workspace: string) => ({
          userId: user.id,
          membershipId: "membership",
          role: "owner",
          capabilities: [],
          workspaceId: workspace === "two" ? 2 : 1,
        }),
      } as never,
      resolver: {
        resolve: (decision: { workspaceId: number }) => ({
          workspaceId: decision.workspaceId,
          workspaceKey: decision.workspaceId === 2 ? "two" : "one",
        }),
      } as never,
      controllers: {
        onboard: (
          context: import("../types/workspaceContext.js").WorkspaceContext,
          actor: import("../knowledge/domain/actorContext.js").ActorContext,
        ) =>
          createOnboardingController(service as never, context, actor, limits),
      } as never,
      assistantControllers: {} as never,
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    request = (actor: string, workspace = "one", xff = "203.0.113.7") =>
      fetch(`${origin}/workspaces/${workspace}/companies/1/onboard`, {
        method: "POST",
        headers: {
          cookie: `atlas=${actor}`,
          origin,
          "sec-fetch-site": "same-origin",
          "x-csrf-token": "csrf",
          "x-forwarded-for": xff,
          "content-type": "application/json",
        },
        body: '{"url":"https://hostile-url.test/provider-payload"}',
      });
  try {
    for (let i = 0; i < 3; i++)
      assert.equal(
        (await request("actor-a", "one", `198.51.100.${i}`)).status,
        200,
      );
    const actorBlocked = await request("actor-a", "one", "192.0.2.9");
    assert.equal(actorBlocked.status, 429);
    assert.equal(actorBlocked.headers.get("retry-after"), "600");
    assert.equal(serviceCalls, 3);
    assert.equal((await request("actor-b")).status, 200);
    assert.equal((await request("actor-c")).status, 200);
    const companyBlocked = await request("actor-d");
    assert.equal(companyBlocked.status, 429);
    assert.equal(companyBlocked.headers.get("retry-after"), "3300");
    assert.equal(serviceCalls, 5);
    assert.equal((await request("actor-a", "two")).status, 200);
    const observed = JSON.stringify(logs);
    assert.match(
      String(
        (JSON.parse(logs.at(-1) ?? "{}") as Record<string, unknown>).requestId,
      ),
      /^req_[a-f0-9]{32}$/,
    );
    for (const secret of ["hostile-url.test", "provider-payload", "192.0.2.9"])
      assert.equal(observed.includes(secret), false);
  } finally {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  }
});

test("EPIC047 PASS5C migrates fresh and exact-0068 databases to the sole 0069 shared limiter schema", () => {
  const verify = (database: DatabaseSync): void => {
    const head = database
      .prepare("SELECT id,name FROM schema_migrations ORDER BY id DESC LIMIT 1")
      .get() as { id: number; name: string };
    assert.equal(head.id, 69);
    assert.equal(head.name, "0069_shared_rate_limit_windows");
    assert.deepEqual(
      (
        database
          .prepare("PRAGMA table_info(shared_rate_limit_windows)")
          .all() as Array<{ name: string; pk: number }>
      )
        .filter((column) => column.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((column) => column.name),
      ["scope_key", "action_key", "window_start"],
    );
    assert.notEqual(
      database
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_shared_rate_limit_windows_expiry'",
        )
        .get(),
      undefined,
    );
    assert.doesNotThrow(() =>
      new RateLimitService(
        new SharedRateLimitRepository(database),
        () => "2026-07-28T12:05:00.000Z",
      ).enforce(
        abuseScope("workspace", 1, "company", 1, "actor", "actor"),
        "actor",
        { action: "migration-proof", maximum: 1, windowMilliseconds: 60_000 },
      ),
    );
  };
  const fresh = new DatabaseSync(":memory:"),
    upgrade = new DatabaseSync(":memory:");
  try {
    runMigrations(fresh);
    verify(fresh);
    runMigrations(upgrade, 68);
    const before = upgrade
      .prepare("SELECT id,name FROM schema_migrations ORDER BY id DESC LIMIT 1")
      .get() as { id: number; name: string };
    assert.equal(before.id, 68);
    assert.equal(
      before.name,
      "0068_billing_operations_provider_events_reconciliation",
    );
    assert.notEqual(
      upgrade
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='billing_operations'",
        )
        .get(),
      undefined,
    );
    runMigrations(upgrade);
    verify(upgrade);
    assert.equal(
      (
        upgrade
          .prepare("SELECT COUNT(*) count FROM schema_migrations WHERE id=69")
          .get() as { count: number }
      ).count,
      1,
    );
    assert.equal(
      (
        upgrade
          .prepare("SELECT COUNT(*) count FROM schema_migrations WHERE id>69")
          .get() as { count: number }
      ).count,
      0,
    );
  } finally {
    fresh.close();
    upgrade.close();
  }
});

test("EPIC047 PASS5C Meta completion and reconnect share real HTTP limits before provider work", async () => {
  const database = createDatabase(":memory:"),
    now = "2026-07-28T12:05:00.000Z",
    logs: string[] = [];
  let completion = 0,
    attemptStarts = 0;
  const attempt = {
    id: "msa_hostile_attempt",
    status: "started",
    expiresAt: now,
    safeFailureCode: null,
    resolvedIntegrationConnectionId: null,
  };
  const attempts = {
      findAttempt: async () => attempt,
      start: async () => {
        attemptStarts++;
        return {
          attemptId: "msa_reconnect",
          state: "s".repeat(43),
          expiresAt: now,
        };
      },
    },
    provider = {
      complete: async () => {
        completion++;
        return {
          kind: "completed" as const,
          attemptId: attempt.id,
          whatsAppConnectionId: "wac_safe",
          verifiedAsset: {},
        };
      },
    };
  const service = new MetaEmbeddedSignupHttpService(
    attempts as never,
    provider as never,
    null,
    {} as never,
    {
      get: () => ({ id: "wac_safe", assistantProfileId: "asp_safe" }),
    } as never,
    { findIntegrationConnectionId: () => "inc_safe" } as never,
    { available: true, appId: "1", configId: "cfg", graphApiVersion: "v1.0" },
    new RateLimitService(new SharedRateLimitRepository(database), () => now),
  );
  const app = express(),
    restore = setOperationalLogSinkForTests((line) => logs.push(line));
  app.use((req, _res, next) =>
    withRequestContext(createRequestId(), () => next()),
  );
  app.use(express.json());
  app.use(
    "/workspaces",
    createAuthorizedCompaniesRouter({
      authentication: {
        cookieName: () => "atlas",
        current: (raw: string) => ({ userId: raw }),
        validateCsrf: () => true,
      } as never,
      users: { findById: (id: string) => ({ id }) } as never,
      authorization: {
        authorize: (user: { id: string }, workspace: string) => ({
          userId: user.id,
          membershipId: "mem",
          role: "owner",
          capabilities: [],
          workspaceId: workspace === "two" ? 2 : 1,
        }),
      } as never,
      resolver: {
        resolve: (decision: { workspaceId: number }) => ({
          workspaceId: decision.workspaceId,
          workspaceKey: decision.workspaceId === 2 ? "two" : "one",
        }),
      } as never,
      controllers: {} as never,
      assistantControllers: {} as never,
      metaEmbeddedSignupControllers:
        createMetaEmbeddedSignupControllers(service),
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    headers = (actor: string, xff: string) => ({
      cookie: `atlas=${actor}`,
      origin,
      "sec-fetch-site": "same-origin",
      "x-csrf-token": "csrf",
      "x-forwarded-for": xff,
      "content-type": "application/json",
    }),
    complete = (actor: string, workspace = "one", xff = "203.0.113.1") =>
      fetch(
        `${origin}/workspaces/${workspace}/companies/1/whatsapp/embedded-signup/attempts/${attempt.id}/complete`,
        {
          method: "POST",
          headers: headers(actor, xff),
          body: '{"state":"state","authorizationCode":"hostile-code","whatsappBusinessAccountIdHint":"waba-private","phoneNumberIdHint":"phone-private"}',
        },
      ),
    reconnect = (actor: string, workspace = "one", xff = "203.0.113.1") =>
      fetch(
        `${origin}/workspaces/${workspace}/companies/1/whatsapp/embedded-signup/reconnect`,
        {
          method: "POST",
          headers: headers(actor, xff),
          body: '{"whatsAppConnectionId":"wac_safe"}',
        },
      );
  try {
    assert.equal((await complete("actor-a")).status, 200);
    assert.equal(
      (await complete("actor-a", "one", "198.51.100.2")).status,
      200,
    );
    assert.equal(
      (await reconnect("actor-a", "one", "198.51.100.3")).status,
      201,
    );
    const before = [completion, attemptStarts],
      actorBlocked = await reconnect("actor-a", "one", "192.0.2.9");
    assert.equal(actorBlocked.status, 429);
    assert.equal(actorBlocked.headers.get("retry-after"), "600");
    assert.deepEqual(await actorBlocked.json(), {
      error: {
        code: "rate_limited",
        message: "Request is temporarily unavailable.",
      },
    });
    assert.deepEqual([completion, attemptStarts], before);
    assert.equal(attempt.status, "started");
    assert.equal((await complete("actor-b")).status, 200);
    assert.equal((await reconnect("actor-c")).status, 201);
    const companyBefore = [completion, attemptStarts],
      companyBlocked = await complete("actor-d");
    assert.equal(companyBlocked.status, 429);
    assert.equal(companyBlocked.headers.get("retry-after"), "3300");
    assert.deepEqual([completion, attemptStarts], companyBefore);
    assert.equal((await complete("actor-a", "two")).status, 200);
    const observed = JSON.stringify(logs),
      event = JSON.parse(logs.at(-1) ?? "{}") as Record<string, unknown>;
    assert.equal(event.event, "abuse_limit_exceeded");
    assert.match(String(event.requestId), /^req_[a-f0-9]{32}$/);
    for (const secret of [
      attempt.id,
      "hostile-code",
      "waba-private",
      "phone-private",
      "192.0.2.9",
      "atlas=actor-a",
    ])
      assert.equal(observed.includes(secret), false);
  } finally {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  }
});

test("EPIC047 PASS5C-OPERATOR limits real operator-message HTTP initiation before persistence and WhatsApp delivery creation", async () => {
  const boot = async () => {
    const database = createDatabase(":memory:"),
      now = "2026-07-28T12:05:00.000Z",
      logs: string[] = [];
    let messages = 0,
      deliveries = 0,
      providerCalls = 0;
    const limits = new RateLimitService(
        new SharedRateLimitRepository(database),
        () => now,
      ),
      conversation = { id: "cnv_private", companyId: 1 };
    const service = new OperatorConversationMessagingService(
      { validateOpen: () => conversation } as never,
      {
        persistOperatorMessage: (
          _context: unknown,
          _company: unknown,
          _conversation: unknown,
          _actor: unknown,
          content: string,
        ) => ({
          kind: "created",
          message: { id: `cmsg_${++messages}`, content },
        }),
      } as never,
      {} as never,
      {
        findBindingByConversation: () => ({
          whatsAppConnectionId: "wac_private",
          waId: "phone-private",
        }),
      } as never,
      {
        deliverWhatsAppText: async () => {
          deliveries++;
          return { id: `odl_${deliveries}`, state: "pending" as const };
        },
      } as never,
      { now: () => now },
      undefined,
      limits,
    );
    configureProductionConversationMessageController((context, actor) =>
      createOperatorConversationMessageController(service, context, actor),
    );
    const app = express(),
      restore = setOperationalLogSinkForTests((line) => logs.push(line));
    app.use((req, _res, next) =>
      withRequestContext(createRequestId(), () => next()),
    );
    app.use(express.json());
    app.use(
      "/workspaces",
      createAuthorizedCompaniesRouter({
        authentication: {
          cookieName: () => "atlas",
          current: (raw: string) => ({ userId: raw }),
          validateCsrf: () => true,
        } as never,
        users: { findById: (id: string) => ({ id }) } as never,
        authorization: {
          authorize: (user: { id: string }, workspace: string) => ({
            userId: user.id,
            membershipId: "membership",
            role: "operator",
            capabilities: [],
            workspaceId: workspace === "two" ? 2 : 1,
          }),
        } as never,
        resolver: {
          resolve: (decision: { workspaceId: number }) => ({
            workspaceId: decision.workspaceId,
            workspaceKey: decision.workspaceId === 2 ? "two" : "one",
          }),
        } as never,
        controllers: {} as never,
        assistantControllers: {} as never,
      }),
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      request = (
        actor: string,
        workspace = "one",
        xff = "203.0.113.7",
        key = `key-${actor}-${messages}`,
      ) =>
        fetch(
          `${origin}/workspaces/${workspace}/companies/1/conversations/cnv_private/messages`,
          {
            method: "POST",
            headers: {
              cookie: `atlas=${actor}`,
              origin,
              "sec-fetch-site": "same-origin",
              "x-csrf-token": "csrf",
              "x-forwarded-for": xff,
              "content-type": "application/json",
              authorization: "Bearer token-private",
            },
            body: JSON.stringify({
              content: "private message text",
              idempotencyKey: key,
            }),
          },
        ),
      close = async () => {
        restore();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        database.close();
      };
    return {
      request,
      close,
      logs,
      counts: () => [messages, deliveries, providerCalls] as const,
    };
  };
  const actor = await boot();
  try {
    for (let i = 0; i < 10; i++)
      assert.equal(
        (await actor.request("actor-a", "one", `198.51.100.${i}`, `actor-${i}`))
          .status,
        201,
      );
    assert.deepEqual(actor.counts(), [10, 10, 0]);
    const rejected = await actor.request(
      "actor-a",
      "one",
      "192.0.2.9",
      "blocked",
    );
    assert.equal(rejected.status, 429);
    assert.equal(rejected.headers.get("retry-after"), "60");
    assert.deepEqual(await rejected.json(), {
      error: {
        code: "rate_limited",
        message: "Request is temporarily unavailable.",
      },
    });
    assert.deepEqual(actor.counts(), [10, 10, 0]);
    assert.equal(
      (await actor.request("actor-b", "one", "203.0.113.200", "actor-b"))
        .status,
      201,
    );
    assert.equal(
      (await actor.request("actor-a", "two", "203.0.113.201", "tenant-b"))
        .status,
      201,
    );
    const event = JSON.parse(actor.logs.at(-1) ?? "{}") as Record<
      string,
      unknown
    >;
    assert.equal(event.event, "abuse_limit_exceeded");
    assert.match(String(event.requestId), /^req_[a-f0-9]{32}$/);
    const observed = JSON.stringify(actor.logs);
    for (const forbidden of [
      "cnv_private",
      "private message text",
      "phone-private",
      "wac_private",
      "token-private",
      "Bearer",
      "192.0.2.9",
      "actor-a",
    ])
      assert.equal(observed.includes(forbidden), false);
  } finally {
    await actor.close();
  }
  const company = await boot();
  try {
    for (let i = 0; i < 30; i++)
      assert.equal(
        (
          await company.request(
            `actor-${i}`,
            "one",
            `198.51.100.${i}`,
            `company-${i}`,
          )
        ).status,
        201,
      );
    assert.deepEqual(company.counts(), [30, 30, 0]);
    const rejected = await company.request(
      "actor-31",
      "one",
      "192.0.2.31",
      "company-blocked",
    );
    assert.equal(rejected.status, 429);
    assert.equal(rejected.headers.get("retry-after"), "60");
    assert.deepEqual(await rejected.json(), {
      error: {
        code: "rate_limited",
        message: "Request is temporarily unavailable.",
      },
    });
    assert.deepEqual(company.counts(), [30, 30, 0]);
    assert.equal(
      (await company.request("actor-31", "two", "203.0.113.31", "other-tenant"))
        .status,
      201,
    );
  } finally {
    await company.close();
  }
});

test("EPIC047 PASS5 identity email initiators use isolated normalized HTTP limits before workflow or delivery work", async () => {
  const database = createDatabase(":memory:"),
    now = "2026-07-28T12:05:00.000Z",
    logs: string[] = [];
  let enrollmentWork = 0,
    enrollmentEmail = 0,
    resetWork = 0,
    resetEmail = 0;
  const limits = new RateLimitService(
      new SharedRateLimitRepository(database),
      () => now,
    ),
    enrollment = {
      requestEnrollment: async () => {
        enrollmentWork++;
        enrollmentEmail++;
      },
    },
    reset = {
      request: async () => {
        resetWork++;
        resetEmail++;
      },
    },
    auth = createAuthenticationControllers(
      enrollment as never,
      { allows: () => true } as never,
      limits,
    ),
    password = createPasswordResetControllers(reset as never, limits),
    app = express(),
    restore = setOperationalLogSinkForTests((line) => logs.push(line));
  app.use((req, _res, next) =>
    withRequestContext(createRequestId(), () => next()),
  );
  app.use(express.json());
  app.use(
    "/identity",
    createIdentityRouter({
      register: ((_q: any, r: any) => r.status(404).end()) as never,
      resend: ((_q: any, r: any) => r.status(404).end()) as never,
      verify: ((_q: any, r: any) => r.status(404).end()) as never,
      ...auth,
      ...password,
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    request = (path: string, email: string, xff: string) =>
      fetch(`${origin}/identity/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": xff,
          authorization: "Bearer token-private",
          cookie: "atlas=secret",
        },
        body: JSON.stringify({ email, locale: "en" }),
      });
  try {
    for (const [email, xff] of [
      ["User@Example.com", "203.0.113.1"],
      [" user@example.com ", "198.51.100.2"],
      ["USER@example.com", "192.0.2.3"],
    ] as const)
      assert.equal(
        (await request("credential-enrollment/request", email, xff)).status,
        202,
      );
    const enrollmentBefore = [enrollmentWork, enrollmentEmail],
      enrollmentBlocked = await request(
        "credential-enrollment/request",
        "user@example.com",
        "203.0.113.99",
      );
    assert.equal(enrollmentBlocked.status, 429);
    assert.equal(enrollmentBlocked.headers.get("retry-after"), "3300");
    assert.deepEqual(await enrollmentBlocked.json(), {
      error: {
        code: "rate_limited",
        message: "Request is temporarily unavailable.",
      },
    });
    assert.deepEqual([enrollmentWork, enrollmentEmail], enrollmentBefore);
    assert.equal(
      (
        await request(
          "credential-enrollment/request",
          "other@example.com",
          "203.0.113.4",
        )
      ).status,
      202,
    );
    for (const [email, xff] of [
      ["Reset@Example.com", "203.0.113.5"],
      [" reset@example.com ", "198.51.100.6"],
      ["RESET@example.com", "192.0.2.7"],
    ] as const)
      assert.equal(
        (await request("password-reset/request", email, xff)).status,
        202,
      );
    const resetBefore = [resetWork, resetEmail],
      resetBlocked = await request(
        "password-reset/request",
        "reset@example.com",
        "203.0.113.99",
      );
    assert.equal(resetBlocked.status, 429);
    assert.equal(resetBlocked.headers.get("retry-after"), "3300");
    assert.deepEqual(await resetBlocked.json(), {
      error: {
        code: "rate_limited",
        message: "Request is temporarily unavailable.",
      },
    });
    assert.deepEqual([resetWork, resetEmail], resetBefore);
    assert.equal(
      (
        await request(
          "password-reset/request",
          "other@example.com",
          "192.0.2.8",
        )
      ).status,
      202,
    );
    assert.equal(
      (
        await request(
          "credential-enrollment/request",
          "reset@example.com",
          "192.0.2.9",
        )
      ).status,
      202,
    );
    assert.equal(
      (
        await request(
          "password-reset/request",
          "user@example.com",
          "192.0.2.10",
        )
      ).status,
      202,
    );
    const events = logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.event === "abuse_limit_exceeded");
    assert.equal(events.length, 2);
    for (const event of events)
      assert.match(String(event.requestId), /^req_[a-f0-9]{32}$/);
    const observed = JSON.stringify(logs);
    for (const secret of [
      "user@example.com",
      "reset@example.com",
      "203.0.113.99",
      "token-private",
      "atlas=secret",
      "Bearer",
    ])
      assert.equal(observed.includes(secret), false);
  } finally {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  }
});

test("EPIC047 PASS5 Assistant Preview enforces real HTTP limits without leaking request data", async () => {
  const database = createDatabase(":memory:"),
    now = "2026-07-28T12:05:00.000Z",
    workspaces = new WorkspaceRepository(database),
    firstWorkspace = workspaces.resolveDefault(),
    secondWorkspace = workspaces.createForSystemUse({
      key: "two",
      name: "Tenant Two",
    }),
    primary = {
      workspaceId: firstWorkspace.id,
      workspaceKey: firstWorkspace.key,
    },
    tenant = {
      workspaceId: secondWorkspace.id,
      workspaceKey: secondWorkspace.key,
    },
    companies = new CompanyRepository(database),
    knowledge = new KnowledgeRepository(database),
    profiles = new AssistantProfileRepository(database),
    profileService = new AssistantProfileService(profiles, {
      now: () => now,
    } as never),
    limits = new RateLimitService(
      new SharedRateLimitRepository(database),
      () => now,
    ),
    logs: string[] = [];
  let providerCalls = 0;
  const provider: AnswerGenerator = {
      execute: async (
        _request: AssistantExecutionRequest,
      ): Promise<AssistantExecutionResult> => {
        providerCalls++;
        return { outcome: "answered", answer: "deterministic preview" };
      },
    },
    runtime = new OperationalAssistantRuntime(
      new AtlasAgent(provider),
      new AssistantExecutionRecordRepository(database),
      { now: () => now } as never,
    ),
    preview = new AssistantPreviewService(
      companies,
      knowledge,
      profiles,
      runtime,
      "deterministic",
      undefined,
      limits,
    ),
    createReadyPreview = (
      context: WorkspaceContext,
      name: string,
    ): { id: number; profileId: string } => {
      const company = companies.create(context, {
          name,
          website: `https://${name.toLowerCase()}.test`,
          status: "ready",
        }),
        profile = profileService.transition(
          context,
          company.id,
          profileService.create(context, company.id, {
            name: `${name} Preview`,
            assistantLanguage: "en",
            businessRole: "Sales",
            objective: "Help customers",
            welcomeMessage: "Welcome",
            fallbackMessage: "Safe fallback",
          }).id,
          "ready",
        );
      publishKnowledgeFixture(database, context, company.id, {
        company: { name, website: company.website, phone: "", email: "" },
        business: { services: ["Preview"], hours: "Always", locations: ["Remote"] },
        faq: [],
      });
      return { id: company.id, profileId: profile.id };
    },
    actorCompany = createReadyPreview(primary, "Actor"),
    companyCompany = createReadyPreview(primary, "Company"),
    tenantCompany = createReadyPreview(tenant, "Tenant"),
    app = express(),
    restore = setOperationalLogSinkForTests((line) => logs.push(line));
  app.use((req, _res, next) =>
    withRequestContext(createRequestId(), () => next()),
  );
  app.use(express.json());
  app.use(
    "/workspaces",
    createAuthorizedCompaniesRouter({
      authentication: {
        cookieName: () => "atlas",
        current: (raw: string) => ({ userId: raw }),
        validateCsrf: () => true,
      } as never,
      users: { findById: (id: string) => ({ id }) } as never,
      authorization: {
        authorize: (user: { id: string }, workspace: string) => ({
          userId: user.id,
          membershipId: "membership",
          role: "owner",
          capabilities: [],
          workspaceId:
            workspace === "two" ? tenant.workspaceId : primary.workspaceId,
        }),
      } as never,
      resolver: {
        resolve: (decision: { workspaceId: number }) =>
          decision.workspaceId === 2 ? tenant : primary,
      } as never,
      controllers: {} as never,
      assistantControllers: {
        preview: (context: WorkspaceContext) =>
          createAssistantPreviewController(preview, context),
      } as never,
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    request = (
      actor: string,
      company: { id: number; profileId: string },
      workspace = "one",
      xff = "203.0.113.1",
    ) =>
      fetch(
        `${origin}/workspaces/${workspace}/companies/${company.id}/assistant-profiles/${company.profileId}/preview`,
        {
          method: "POST",
          headers: {
            cookie: `atlas=${actor}`,
            origin,
            "sec-fetch-site": "same-origin",
            "x-csrf-token": "csrf",
            "x-forwarded-for": xff,
            authorization: "Bearer preview-token-private",
            "content-type": "application/json",
          },
          body: JSON.stringify({ message: "private preview prompt" }),
        },
      );
  try {
    const baseline = await request("baseline", actorCompany);
    assert.equal(baseline.status, 200);
    assert.deepEqual(await baseline.json(), {
      status: "answered",
      answer: "deterministic preview",
    });

    for (let index = 0; index < 5; index++)
      assert.equal(
        (await request("actor-five", actorCompany, "one", `198.51.100.${index}`))
          .status,
        200,
      );
    const actorBefore = providerCalls,
      actorBlocked = await request(
        "actor-five",
        actorCompany,
        "one",
        "192.0.2.5",
      );
    assert.equal(actorBlocked.status, 429);
    assert.equal(actorBlocked.headers.get("retry-after"), "60");
    assert.deepEqual(await actorBlocked.json(), {
      error: {
        code: "rate_limited",
        message: "Request is temporarily unavailable.",
      },
    });
    assert.equal(providerCalls, actorBefore);
    assert.equal((await request("actor-six", actorCompany)).status, 200);
    assert.equal(
      (await request("actor-five", tenantCompany, "two", "203.0.113.250"))
        .status,
      200,
    );
    const ownershipBefore = providerCalls;
    assert.equal((await request("actor-five", tenantCompany)).status, 404);
    assert.equal(providerCalls, ownershipBefore);

    for (let index = 0; index < 10; index++)
      assert.equal(
        (
          await request(
            `company-actor-${index}`,
            companyCompany,
            "one",
            `198.51.100.${index}`,
          )
        ).status,
        200,
      );
    const companyBefore = providerCalls,
      companyBlocked = await request(
        "company-actor-11",
        companyCompany,
        "one",
        "192.0.2.11",
      );
    assert.equal(companyBlocked.status, 429);
    assert.equal(companyBlocked.headers.get("retry-after"), "60");
    assert.deepEqual(await companyBlocked.json(), {
      error: {
        code: "rate_limited",
        message: "Request is temporarily unavailable.",
      },
    });
    assert.equal(providerCalls, companyBefore);

    const events = logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.event === "abuse_limit_exceeded");
    assert.equal(events.length, 2);
    for (const event of events)
      assert.match(String(event.requestId), /^req_[a-f0-9]{32}$/);
    const observed = JSON.stringify(logs);
    for (const privateValue of [
      "private preview prompt",
      "preview-token-private",
      "actor-five",
      "192.0.2.5",
      "192.0.2.11",
      "atlas=",
      "Bearer",
    ])
      assert.equal(observed.includes(privateValue), false);
  } finally {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  }
});

test("EPIC047 PASS5 proactive actions enforce real HTTP limits before mutation or runtime work", async () => {
  let now = "2026-08-31T18:00:00.000Z";
  const database = createDatabase(":memory:"),
    workspaces = new WorkspaceRepository(database),
    primary = createWorkspaceContext(workspaces.resolveDefault()),
    tenant = createWorkspaceContext(
      workspaces.createForSystemUse({ key: "tenant", name: "Tenant" }),
    ),
    companies = new CompanyRepository(database),
    conversations = new ConversationRepository(database),
    limits = new RateLimitService(
      new SharedRateLimitRepository(database),
      () => now,
    ),
    logs: string[] = [];
  const companyFixture = (context: WorkspaceContext, name: string, digit: string) => {
    const company = companies.create(context, {
        name,
        website: `https://${name.toLowerCase()}.test`,
      }),
      suffix = digit.repeat(32),
      conversation = conversations.createConversation(
        context,
        reconstructConversation({
          id: conversationId(`cnv_${suffix}`),
          companyId: company.id,
          channel: "whatsapp",
          state: "open",
          createdAt: now,
          updatedAt: now,
          closedAt: null,
        }),
      )!,
      customer = conversations.createParticipant(
        context,
        company.id,
        reconstructConversationParticipant({
          id: conversationParticipantId(`cpt_${suffix}`),
          conversationId: conversation.id,
          type: "whatsapp_contact",
          reference: `customer-${digit}`,
          createdAt: now,
        }),
      )!,
      assistant = conversations.createParticipant(
        context,
        company.id,
        reconstructConversationParticipant({
          id: conversationParticipantId(`cpt_${digit.repeat(31)}${digit === "9" ? "8" : "9"}`),
          conversationId: conversation.id,
          type: "assistant",
          reference: `assistant-${digit}`,
          createdAt: now,
        }),
      )!,
      profileId = `asp_${suffix}`,
      connectionId = `wac_${suffix}`;
    database
      .prepare(
        "INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)",
      )
      .run(profileId, company.id, name, name.toLowerCase(), "professional", "en", "Fallback", "ready", now, now);
    database
      .prepare(
        "INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(connectionId, context.workspaceId, company.id, profileId, `phone-${digit}`, `business-${digit}`, "active", now, now);
    database
      .prepare(
        "INSERT INTO whatsapp_conversation_bindings(id,whatsapp_connection_id,wa_id,conversation_id,customer_participant_id,assistant_participant_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(`wcb_${suffix}`, connectionId, `customer-${digit}`, conversation.id, customer.id, assistant.id, now, now);
    conversations.ensureConversationControl(context, company.id, conversation.id);
    conversations.createMessage(
      context,
      company.id,
      reconstructConversationMessage({
        id: `cmsg_${suffix}` as never,
        conversationId: conversation.id,
        senderParticipantId: customer.id,
        direction: "inbound",
        content: "inbound",
        idempotencyKey: `inbound-${digit}`,
        executionRecordId: null,
        createdAt: now,
      }),
    );
    database
      .prepare(
        "INSERT INTO channel_provider_events(id,communication_channel,transport_provider,transport_connection_id,external_event_id,state,conversation_id,conversation_message_id,created_at,updated_at) VALUES(?,?,?,?,?,'completed',?,?,?,?)",
      )
      .run(`cpe_${suffix}`, "whatsapp", "meta", connectionId, `event-${digit}`, conversation.id, `cmsg_${suffix}`, now, now);
    database
      .prepare(
        "INSERT INTO provider_message_records(id,communication_channel,transport_provider,direction,transport_connection_id,conversation_message_id,external_message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(`pmr_${suffix}`, "whatsapp", "meta", "inbound", connectionId, `cmsg_${suffix}`, `wamid-${digit}`, now, now);
    return { company, conversation };
  };
  const actorCompany = companyFixture(primary, "Actor", "1"),
    companyCompany = companyFixture(primary, "Company", "2"),
    tenantCompany = companyFixture(tenant, "Tenant", "3"),
    service = new ProactiveActionOperatorService(
      new ProactiveActionRepository(database),
      { now: () => now },
      limits,
    ),
    app = express(),
    restore = setOperationalLogSinkForTests((line) => logs.push(line));
  app.use((req, _res, next) =>
    withRequestContext(createRequestId(), () => next()),
  );
  app.use(express.json());
  app.use(
    "/workspaces",
    createAuthorizedCompaniesRouter({
      authentication: {
        cookieName: () => "atlas",
        current: (raw: string) => ({ userId: raw }),
        validateCsrf: () => true,
      } as never,
      users: { findById: (id: string) => ({ id, status: "active" }) } as never,
      authorization: {
        authorize: (user: { id: string }, workspace: string, permission: string) => {
          const context = workspace === "wsp_default" ? primary : workspace === "wsp_tenant" ? tenant : null;
          if (!context) throw new Error("denied");
          return { userId: user.id, membershipId: "membership", role: "operator", capabilities: new Set([permission]), workspaceId: context.workspaceId };
        },
      } as never,
      resolver: {
        resolve: (decision: { workspaceId: number }) =>
          decision.workspaceId === primary.workspaceId ? primary : tenant,
      } as never,
      controllers: {} as never,
      assistantControllers: {} as never,
      proactiveActionControllers: createProactiveActionControllers(service),
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    workspaceFor = (context: WorkspaceContext) =>
      context.workspaceId === primary.workspaceId ? "wsp_default" : "wsp_tenant",
    headers = (actor: string, xff: string) => ({
      cookie: `atlas=${actor}`,
      origin,
      "sec-fetch-site": "same-origin",
      "x-csrf-token": "csrf",
      "x-forwarded-for": xff,
      authorization: "Bearer proactive-token-private",
      "content-type": "application/json",
    }),
    policy = async (context: WorkspaceContext, company: { id: number }, operationId: string) =>
      fetch(`${origin}/workspaces/${workspaceFor(context)}/companies/${company.id}/proactive-action-policy`, {
        method: "PUT",
        headers: headers("policy-owner", "203.0.113.1"),
        body: JSON.stringify({ operationId, expectedVersion: 1, enabled: true }),
      }),
    create = (
      context: WorkspaceContext,
      target: { company: { id: number }; conversation: { id: string } },
      actor: string,
      operationId: string,
      xff: string,
    ) =>
      fetch(`${origin}/workspaces/${workspaceFor(context)}/companies/${target.company.id}/conversations/${target.conversation.id}/proactive-actions`, {
        method: "POST",
        headers: headers(actor, xff),
        body: JSON.stringify({ operationId, runAt: now, intentKind: "follow_up" }),
      }),
    counts = () =>
      database.prepare("SELECT (SELECT COUNT(*) FROM proactive_actions) actions,(SELECT COUNT(*) FROM proactive_action_operations WHERE operation='create') operations,(SELECT COUNT(*) FROM proactive_action_audit_events) audits,(SELECT COUNT(*) FROM assistant_execution_records) executions,(SELECT COUNT(*) FROM outbound_deliveries) deliveries,(SELECT COUNT(*) FROM proactive_action_visibility) enqueues").get();
  try {
    for (const [context, target, operation] of [
      [primary, actorCompany, "enable-actor"],
      [primary, companyCompany, "enable-company"],
      [tenant, tenantCompany, "enable-tenant"],
    ] as const)
      assert.equal((await policy(context, target.company, operation)).status, 200);

    assert.equal((await create(primary, actorCompany, "baseline", "baseline", "203.0.113.8")).status, 201);
    assert.deepEqual({ ...counts() }, { actions: 1, operations: 1, audits: 1, executions: 0, deliveries: 0, enqueues: 0 });
    for (let index = 0; index < 5; index++)
      assert.equal((await create(primary, actorCompany, "actor-five", `actor-${index}`, `198.51.100.${index}`)).status, 201);
    const actorBefore = counts(), actorBlocked = await create(primary, actorCompany, "actor-five", "actor-blocked", "192.0.2.5");
    assert.equal(actorBlocked.status, 429);
    assert.equal(actorBlocked.headers.get("retry-after"), "900");
    assert.deepEqual(await actorBlocked.json(), { error: { code: "rate_limited", message: "Request is temporarily unavailable." } });
    assert.deepEqual(counts(), actorBefore);
    assert.equal((await create(primary, actorCompany, "actor-six", "actor-six", "203.0.113.9")).status, 201);
    assert.equal((await create(tenant, tenantCompany, "actor-five", "tenant-isolated", "198.51.100.250")).status, 201);
    const ownershipBefore = counts();
    assert.equal((await create(primary, tenantCompany, "actor-six", "foreign", "192.0.2.6")).status, 404);
    assert.deepEqual(counts(), ownershipBefore);

    now = "2026-08-31T18:05:00.000Z";
    for (let index = 0; index < 20; index++)
      assert.equal((await create(primary, companyCompany, `company-actor-${index}`, `company-${index}`, `203.0.113.${index}`)).status, 201);
    const companyBefore = counts(), companyBlocked = await create(primary, companyCompany, "company-actor-20", "company-blocked", "192.0.2.20");
    assert.equal(companyBlocked.status, 429);
    assert.equal(companyBlocked.headers.get("retry-after"), "3300");
    assert.deepEqual(await companyBlocked.json(), { error: { code: "rate_limited", message: "Request is temporarily unavailable." } });
    assert.deepEqual(counts(), companyBefore);
    assert.equal((counts() as { executions: number; deliveries: number; enqueues: number }).executions, 0);
    assert.equal((counts() as { executions: number; deliveries: number; enqueues: number }).deliveries, 0);
    assert.equal((counts() as { executions: number; deliveries: number; enqueues: number }).enqueues, 0);
    const events = logs.map((line) => JSON.parse(line) as Record<string, unknown>).filter((event) => event.event === "abuse_limit_exceeded");
    assert.equal(events.length, 2);
    for (const event of events) assert.match(String(event.requestId), /^req_[a-f0-9]{32}$/);
    const observed = JSON.stringify(logs);
    for (const privateValue of ["actor-five", "company-actor-20", "192.0.2.5", "192.0.2.20", "proactive-token-private", "atlas=", "Bearer"])
      assert.equal(observed.includes(privateValue), false);
  } finally {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  }
});
