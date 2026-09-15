import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import test from "node:test";
import { Worker } from "node:worker_threads";
import type { AddressInfo } from "node:net";
import { Router } from "express";
import { amountMinor, billingInterval, currencyCode, effectiveSubscriptionState, entitlementState, providerEvidenceState, rolloutMode } from "../billing/domain/billing.js";
import { runMigrations } from "../config/migrations.js";
import { BillingAccountRepository, BillingCatalogRepository, BillingEntitlementSnapshotRepository, BillingSubscriptionRepository } from "../repositories/billingRepository.js";
import { CommercialControlsRepository } from "../repositories/commercialControlsRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { BillingEntitlementService } from "../billing/services/billingEntitlementService.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { CompanyService } from "../services/companyService.js";
import { CompanyCapacityError } from "../services/companyValidation.js";
import { AssistantProfileRepository } from "../repositories/assistantProfileRepository.js";
import { AssistantProfileConflictError, AssistantProfileService } from "../assistant/services/assistantProfileService.js";
import { WebChatConnectionRepository } from "../repositories/webChatConnectionRepository.js";
import { WebChatConnectionCapacityError, WebChatConnectionService } from "../webChat/services/webChatConnectionService.js";
import { WhatsAppConnectionRepository } from "../repositories/whatsappConnectionRepository.js";
import { WhatsAppConnectionConflictError, WhatsAppConnectionService } from "../whatsapp/services/WhatsAppConnectionService.js";
import { assistantProfileId, reconstructAssistantProfile } from "../assistant/domain/assistantProfile.js";
import { CompanyApplicationService } from "../company/application/companyApplicationService.js";
import { CompanyDomainRepository } from "../repositories/companyDomainRepository.js";
import { webChatConnectionId } from "../webChat/domain/webChatConnection.js";
import { billingOperationFingerprint, billingProviderIdempotencyKey } from "../billing/domain/billingOperations.js";
import { DeterministicFakeBillingProvider, mercadoPagoBillingProviderCapabilities, stripeBillingProviderCapabilities } from "../billing/application/billingProvider.js";
import { BillingOperationRepository } from "../repositories/billingOperationRepository.js";
import { BillingOperationService } from "../billing/application/billingOperationService.js";
import { BillingProviderRegistry } from "../billing/application/billingProviderRegistry.js";
import type { BillingProvider, BillingProviderResult } from "../billing/application/billingProvider.js";
import { StripeBillingConfigurationError, StripeBillingProvider, stripeBillingProviderFromEnvironment } from "../billing/providers/stripeBillingProvider.js";
import { MercadoPagoBillingConfigurationError, MercadoPagoBillingProvider, mercadoPagoBillingProviderFromEnvironment } from "../billing/providers/mercadoPagoBillingProvider.js";
import { BillingProviderConfigurationError, billingProviderKindsFromEnvironment, billingProviderRegistryFromEnvironment } from "../billing/application/billingProviderConfiguration.js";
import { BillingPayerIdentityResolver } from "../billing/application/billingPayerIdentityResolver.js";
import { BillingPayerIdentityService } from "../billing/application/billingPayerIdentityService.js";
import { effectiveSubscriptionStateForEvidence, entitlementForEffectiveSubscription } from "../billing/domain/effectiveSubscriptionMapper.js";
import { BillingSubscriptionReadService } from "../billing/services/billingSubscriptionReadService.js";
import { createHmac } from "node:crypto";
import { BillingWebhookService } from "../billing/application/billingWebhookService.js";
import { BillingWebhookRepository } from "../repositories/billingWebhookRepository.js";
import { BillingReconciliationRepository } from "../repositories/billingReconciliationRepository.js";
import { BillingReconciliationWorker } from "../billing/services/billingReconciliationWorker.js";
import { BillingOperationRecoveryWorker } from "../billing/services/billingOperationRecoveryWorker.js";
import { BillingApplicationService } from "../billing/application/billingApplicationService.js";
import { createBillingControllers } from "../controllers/billingController.js";
import { createBillingRouter } from "../routes/billing.js";
import { createBillingWebhookController } from "../controllers/billingWebhookController.js";
import { createBillingWebhookRouter } from "../routes/billingWebhook.js";
import { createApp } from "../app.js";

const at = "2026-09-01T00:00:00.000Z", stripeTimestamp = Math.floor(Date.parse(at) / 1_000);
function open(path = ":memory:"): DatabaseSync { const db = new DatabaseSync(path); db.exec("PRAGMA foreign_keys=ON"); runMigrations(db); return db; }
function defaultWorkspace(db: DatabaseSync): number { return (db.prepare("SELECT id FROM workspaces WHERE key='default'").get() as { id:number }).id; }
function catalogInput(overrides: Record<string, unknown> = {}) { return { planKey:"test", catalogVersion:1, displayName:"Test", interval:"month" as const, currency:"USD", amountMinor:100, lifecycle:"active" as const, maxCompanies:null, maxAssistantProfiles:null, maxActiveChannels:null, mutationEligible:true, entitlementDefinitionVersion:1, providerKind:null, providerPriceId:null, ...overrides }; }

test("EPIC046 recovers an uncertain Stripe checkout once with its durable provider key and no entitlement write", async () => {
  const db=open();try { const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),catalog=new BillingCatalogRepository(db),operations=new BillingOperationRepository(db),account=accounts.findByWorkspace(workspaceId)!,entry=catalog.create(catalogInput({planKey:"recovery",catalogVersion:1,providerKind:"stripe",providerPriceId:"price_recovery"})),created=operations.createOrReplay({billingAccountId:account.id,kind:"checkout_session_create",providerKind:"stripe",operationId:"recover",fingerprint:billingOperationFingerprint({billingAccountId:account.id,operationKind:"checkout_session_create",catalogEntryId:entry.id,providerKind:"stripe",redirectTarget:"https://atlas.test/s",cancelTarget:"https://atlas.test/c"}),catalogEntryId:entry.id,successTarget:"https://atlas.test/s",cancelTarget:"https://atlas.test/c",at}).operation!,started=operations.start(created.id,created.version,at)!;operations.uncertain(started.id,started.version,at);let calls=0;const provider:BillingProvider={capabilities:stripeBillingProviderCapabilities,createCheckoutSession(){throw new Error("request path must not replay");},createPortalSession(){throw new Error("unused");},cancelAtPeriodEnd(){throw new Error("unused");},reactivateSubscription(){throw new Error("unused");},readSubscription(){return Promise.resolve({kind:"uncertain"});},recoverOperation(input){calls++;assert.equal(input.idempotencyKey,billingProviderIdempotencyKey(account.id,"checkout_session_create","recover"));return Promise.resolve({kind:"success",providerObjectId:"cs_recovered",redirectUrl:"https://atlas.test/recovered"});}};const before=db.prepare("SELECT version FROM billing_entitlement_snapshots WHERE billing_account_id=?").get(account.id);const worker=new BillingOperationRecoveryWorker(operations,new BillingProviderRegistry([{kind:"stripe",provider}]),()=>at);assert.equal(await worker.runNext(),"succeeded");assert.equal(calls,1);assert.equal(operations.find(account.id,"checkout_session_create","recover")?.status,"succeeded");assert.equal((db.prepare("SELECT COUNT(*) count FROM billing_checkout_enrollments WHERE checkout_operation_id=?").get(created.id)as{count:number}).count,1);assert.deepEqual(db.prepare("SELECT version FROM billing_entitlement_snapshots WHERE billing_account_id=?").get(account.id),before);}finally{db.close();}
});

test("EPIC046 durable Billing operations preserve replay, CAS, and safe provider boundaries", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic046-operations-")), path = join(directory, "atlas.sqlite"), first = open(path), second = open(path);
  try {
    const accountId = (first.prepare("SELECT id FROM billing_accounts WHERE workspace_id=?").get(defaultWorkspace(first)) as {id:string}).id;
    const fingerprint = billingOperationFingerprint({billingAccountId:accountId,operationKind:"checkout_session_create",catalogEntryId:"cat_1",redirectTarget:"https://atlas.test/complete"});
    const changed = billingOperationFingerprint({billingAccountId:accountId,operationKind:"checkout_session_create",catalogEntryId:"cat_2",redirectTarget:"https://atlas.test/complete"});
    const left = new BillingOperationRepository(first), right = new BillingOperationRepository(second);
    const created = left.createOrReplay({billingAccountId:accountId,kind:"checkout_session_create",operationId:"op_same",fingerprint,at});
    assert.equal(created.kind,"created"); assert.equal(right.createOrReplay({billingAccountId:accountId,kind:"checkout_session_create",operationId:"op_same",fingerprint,at}).kind,"same");
    assert.equal(right.createOrReplay({billingAccountId:accountId,kind:"checkout_session_create",operationId:"op_same",fingerprint:changed,at}).kind,"conflict");
    assert.equal((first.prepare("SELECT COUNT(*) count FROM billing_operations WHERE operation_id='op_same'").get() as {count:number}).count,1);
    const pending = created.operation!, started = left.start(pending.id,pending.version,at)!;
    const succeeded = right.succeed(started.id,started.version,"checkout_1",JSON.stringify({redirectUrl:"https://safe.test/session"}),at)!;
    assert.equal(left.succeed(started.id,started.version,"checkout_2",null,at),null); assert.equal(succeeded.status,"succeeded");
    const replay = left.createOrReplay({billingAccountId:accountId,kind:"checkout_session_create",operationId:"op_same",fingerprint,at});
    assert.equal(replay.operation?.safeResultJson,JSON.stringify({redirectUrl:"https://safe.test/session"}));
    for (const [id, settle] of [["op_fail","fail"],["op_uncertain","uncertain"]] as const) { const operation=left.createOrReplay({billingAccountId:accountId,kind:"subscription_cancel_at_period_end",operationId:id,fingerprint:billingOperationFingerprint({billingAccountId:accountId,operationKind:"subscription_cancel_at_period_end",subscriptionId:"sub_1"}),at}).operation!, requested=left.start(operation.id,operation.version,at)!; const result=settle==="fail"?left.fail(requested.id,requested.version,"unavailable",at):left.uncertain(requested.id,requested.version,at); assert.equal(result?.status,settle==="fail"?"failed":"uncertain"); }
     const fake = new DeterministicFakeBillingProvider(); const key=billingProviderIdempotencyKey(accountId,"checkout_session_create","op_same"); await fake.createCheckoutSession({idempotencyKey:key,catalogReference:"cat_1",successTarget:"https://atlas.test/complete",cancelTarget:"https://atlas.test/cancel"}); assert.deepEqual(fake.calls,[{kind:"checkout_session_create",idempotencyKey:key}]);
    assert.deepEqual(first.prepare("PRAGMA foreign_key_check").all(),[]); assert.equal(first.prepare("PRAGMA table_info(billing_provider_events)").all().some((column)=>/payload|body/i.test(String(column.name))&&column.name!=="payload_digest"),false);
  } finally { first.close(); second.close(); rmSync(directory,{recursive:true,force:true}); }
});

test("EPIC046 provider orchestration claims once, replays safely, and does not alter subscription authority", async () => {
  const db=open();
  try {
    const workspaceId=defaultWorkspace(db), accounts=new BillingAccountRepository(db), catalog=new BillingCatalogRepository(db), subscriptions=new BillingSubscriptionRepository(db), operations=new BillingOperationRepository(db), account=accounts.findByWorkspace(workspaceId)!;
    const entry=catalog.create(catalogInput({planKey:"orchestration",catalogVersion:1,providerKind:"stripe",providerPriceId:"price_local"}));
    const before=db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(account.id), snapshot=db.prepare("SELECT version FROM billing_entitlement_snapshots WHERE billing_account_id=?").get(account.id);
    const fake=new DeterministicFakeBillingProvider({kind:"success",providerObjectId:"checkout_1",redirectUrl:"https://safe.test/session"}), service=new BillingOperationService(accounts,catalog,subscriptions,operations,new BillingProviderRegistry([{kind:"stripe",provider:fake}]),()=>at);
    const checkout={workspaceId,catalogEntryId:entry.id,operationId:"checkout-op",successTarget:"https://atlas.test/complete",cancelTarget:"https://atlas.test/cancel"};
    assert.equal((await service.checkout(checkout)).kind,"succeeded"); assert.equal(fake.calls.length,1); assert.equal((await service.checkout(checkout)).kind,"succeeded"); assert.equal(fake.calls.length,1);
    const otherEntry=catalog.create(catalogInput({planKey:"orchestration-other",catalogVersion:1,providerKind:"stripe",providerPriceId:"price_other"})); assert.equal((await service.checkout({...checkout,catalogEntryId:otherEntry.id})).kind,"conflict"); assert.equal((await service.checkout({...checkout,cancelTarget:"https://atlas.test/other-cancel"})).kind,"conflict"); assert.equal(fake.calls.length,1); assert.deepEqual(db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(account.id),before); assert.deepEqual(db.prepare("SELECT version FROM billing_entitlement_snapshots WHERE billing_account_id=?").get(account.id),snapshot);
    db.prepare("UPDATE billing_subscriptions SET provider_kind='stripe',provider_subscription_id='sub_local',effective_state='active',version=version+1 WHERE billing_account_id=?").run(account.id);
    const sub=subscriptions.current(account.id)!;
    const cancel=new BillingOperationService(accounts,catalog,subscriptions,operations,new BillingProviderRegistry([{kind:"stripe",provider:new DeterministicFakeBillingProvider({kind:"failed",code:"unavailable"})}]),()=>at);
    assert.equal((await cancel.cancelAtPeriodEnd({workspaceId,subscriptionId:sub.id,operationId:"cancel-op"})).kind,"failed"); assert.equal((await cancel.cancelAtPeriodEnd({workspaceId,subscriptionId:sub.id,operationId:"cancel-op"})).kind,"failed");
    db.prepare("UPDATE billing_subscriptions SET effective_state='canceling_at_period_end',cancel_at_period_end=1,version=version+1 WHERE billing_account_id=?").run(account.id);
    const reactivate=new BillingOperationService(accounts,catalog,subscriptions,operations,new BillingProviderRegistry([{kind:"stripe",provider:new DeterministicFakeBillingProvider({kind:"uncertain"})}]),()=>at), canceling=subscriptions.current(account.id)!;
    assert.equal((await reactivate.reactivate({workspaceId,subscriptionId:canceling.id,operationId:"reactivate-op"})).kind,"uncertain"); assert.equal((await reactivate.reactivate({workspaceId,subscriptionId:canceling.id,operationId:"reactivate-op"})).kind,"uncertain");
    const pending=operations.createOrReplay({billingAccountId:account.id,kind:"checkout_session_create",providerKind:"stripe",operationId:"crash-op",fingerprint:billingOperationFingerprint({billingAccountId:account.id,operationKind:"checkout_session_create",catalogEntryId:entry.id,providerKind:"stripe",redirectTarget:"https://atlas.test/crash",cancelTarget:"https://atlas.test/cancel"}),at}).operation!;
    assert.equal(operations.start(pending.id,pending.version,at)?.status,"request_started");
    const crashed=new BillingOperationService(accounts,catalog,subscriptions,operations,new BillingProviderRegistry([{kind:"stripe",provider:new DeterministicFakeBillingProvider()}]),()=>at);
    assert.equal((await crashed.checkout({workspaceId,catalogEntryId:entry.id,operationId:"crash-op",successTarget:"https://atlas.test/crash",cancelTarget:"https://atlas.test/cancel"})).kind,"in_progress");
  } finally { db.close(); }
});

test("EPIC046 two BillingOperationService instances dispatch one paused checkout claim", async () => {
  const directory=mkdtempSync(join(tmpdir(),"atlas-epic046-service-race-")), path=join(directory,"atlas.sqlite"), a=open(path), b=open(path);
  try {
    const workspaceId=defaultWorkspace(a), account=new BillingAccountRepository(a).findByWorkspace(workspaceId)!, entry=new BillingCatalogRepository(a).create(catalogInput({planKey:"race",catalogVersion:1,providerKind:"stripe",providerPriceId:"price_race"}));
    let release:(value:BillingProviderResult)=>void=()=>undefined; const gate=new Promise<BillingProviderResult>(resolve=>{release=resolve;});
    const calls:Array<{idempotencyKey:string}>=[];
    const provider:BillingProvider={capabilities:stripeBillingProviderCapabilities,createCheckoutSession(input){calls.push({idempotencyKey:input.idempotencyKey});return gate;},createPortalSession(){throw new Error("not used");},cancelAtPeriodEnd(){throw new Error("not used");},reactivateSubscription(){throw new Error("not used");},readSubscription(){return Promise.resolve({kind:"uncertain"});}};
    const service=(db:DatabaseSync)=>new BillingOperationService(new BillingAccountRepository(db),new BillingCatalogRepository(db),new BillingSubscriptionRepository(db),new BillingOperationRepository(db),new BillingProviderRegistry([{kind:"stripe",provider}]),()=>at);
    const input={workspaceId,catalogEntryId:entry.id,operationId:"service-race",successTarget:"https://atlas.test/complete",cancelTarget:"https://atlas.test/cancel"};
    const first=service(a).checkout(input); await new Promise<void>(resolve=>setImmediate(resolve));
    const second=await service(b).checkout(input); assert.equal(second.kind,"in_progress"); assert.equal(calls.length,1);
    release({kind:"success",providerObjectId:"checkout_race",redirectUrl:"https://safe.test/race"}); const firstResult=await first; assert.equal(firstResult.kind,"succeeded");
     assert.equal(calls.length,1); assert.equal(calls[0]!.idempotencyKey,billingProviderIdempotencyKey(account.id,"checkout_session_create","service-race")); assert.equal((a.prepare("SELECT COUNT(*) count FROM billing_operations WHERE billing_account_id=? AND operation_id='service-race'").get(account.id) as {count:number}).count,1);
    a.close(); b.close(); const reopened=open(path), operation=new BillingOperationRepository(reopened).find(account.id,"checkout_session_create","service-race")!; assert.equal(operation.status,"succeeded"); assert.equal(operation.safeResultJson,JSON.stringify({providerObjectId:"checkout_race",redirectUrl:"https://safe.test/race"})); reopened.close();
  } finally { if(a.isOpen)a.close(); if(b.isOpen)b.close(); rmSync(directory,{recursive:true,force:true}); }
});

test("EPIC046 Stripe adapter emits bounded form requests and safe outcomes without network", async () => {
  const requests:Array<{url:string;init:RequestInit}>=[]; const provider=new StripeBillingProvider({secretKey:"sk_test_dummy",apiBaseUrl:"https://api.stripe.test",timeoutMs:1000,allowedRedirectOrigins:["https://atlas.test","https://checkout.stripe.test"]},async(url,init)=>{requests.push({url,init});return new Response(JSON.stringify({id:"cs_1",url:"https://checkout.stripe.test/session"}),{status:200});});
  assert.deepEqual(await provider.createCheckoutSession({idempotencyKey:"atlas:billing:checkout_session_create:op",catalogReference:"price_local",successTarget:"https://atlas.test/success",cancelTarget:"https://atlas.test/cancel"}),{kind:"success",providerObjectId:"cs_1",redirectUrl:"https://checkout.stripe.test/session"});
  assert.equal(requests.length,1); assert.equal(requests[0]!.url,"https://api.stripe.test/v1/checkout/sessions"); const headers=new Headers(requests[0]!.init.headers), body=new URLSearchParams(String(requests[0]!.init.body)); assert.equal(headers.get("idempotency-key"),"atlas:billing:checkout_session_create:op"); assert.equal(body.get("mode"),"subscription"); assert.equal(body.get("line_items[0][price]"),"price_local");
  const failed=new StripeBillingProvider({secretKey:"sk_test_dummy",apiBaseUrl:"https://api.stripe.test",timeoutMs:1000,allowedRedirectOrigins:["https://atlas.test"]},async()=>new Response("{}",{status:400})); assert.deepEqual(await failed.cancelAtPeriodEnd({idempotencyKey:"key",subscriptionReference:"sub_1"}),{kind:"failed",code:"invalid_request"});
  const uncertain=new StripeBillingProvider({secretKey:"sk_test_dummy",apiBaseUrl:"https://api.stripe.test",timeoutMs:1000,allowedRedirectOrigins:["https://atlas.test"]},async()=>new Response("{}",{status:500})); assert.deepEqual(await uncertain.reactivateSubscription({idempotencyKey:"key",subscriptionReference:"sub_1"}),{kind:"uncertain"}); assert.deepEqual(await provider.createPortalSession({billingAccountReference:"cus_1",returnTarget:"javascript:bad"}),{kind:"failed",code:"invalid_request"});
});

test("EPIC046 Mercado Pago adapter creates preapprovals with a payer and a non-PII deterministic reference", async () => {
  const requests:Array<{url:string;init:RequestInit}>=[];
  const provider=new MercadoPagoBillingProvider({accessToken:"mp-token",apiBaseUrl:"https://api.mercadopago.test",timeoutMs:50,allowedRedirectOrigins:["https://atlas.test","https://mp.test"]},async(url,init)=>{requests.push({url,init});return new Response(JSON.stringify({id:"preapproval_1",init_point:"https://mp.test/checkout"}));});
  const input={idempotencyKey:"atlas:billing:checkout_session_create:local-operation",catalogReference:"plan_123",successTarget:"https://atlas.test/complete",cancelTarget:"https://atlas.test/cancel",payerEmail:"payer@example.test"};
  assert.deepEqual(await provider.createCheckoutSession(input),{kind:"success",providerObjectId:"preapproval_1",redirectUrl:"https://mp.test/checkout"});
  assert.equal(requests.length,1); assert.equal(requests[0]!.url,"https://api.mercadopago.test/preapproval");
  const headers=new Headers(requests[0]!.init.headers), body=JSON.parse(String(requests[0]!.init.body)) as Record<string,string>;
  const externalReference=body.external_reference; if(typeof externalReference!=="string")throw new Error("expected an external reference");
  assert.equal(headers.get("authorization"),"Bearer mp-token"); assert.equal(headers.has("x-idempotency-key"),false); assert.equal(body.preapproval_plan_id,"plan_123"); assert.equal(body.payer_email,"payer@example.test"); assert.equal(body.back_url,"https://atlas.test/complete"); assert.equal(externalReference.length,64); assert.notEqual(externalReference,input.idempotencyKey); assert.equal(externalReference.includes("payer@example.test"),false);
  assert.deepEqual(await provider.createCheckoutSession(input),{kind:"success",providerObjectId:"preapproval_1",redirectUrl:"https://mp.test/checkout"}); assert.equal(JSON.parse(String(requests[1]!.init.body)).external_reference,externalReference);
});

test("EPIC046 Mercado Pago adapter validates safe inputs and maps unsafe provider outcomes", async () => {
  let calls=0; const provider=new MercadoPagoBillingProvider({accessToken:"mp-token",apiBaseUrl:"https://api.mercadopago.test",timeoutMs:50,allowedRedirectOrigins:["https://atlas.test","https://mp.test"]},async()=>{calls++;return new Response(JSON.stringify({id:"preapproval",init_point:"https://mp.test/init"}));});
  const valid={idempotencyKey:"key",catalogReference:"plan",successTarget:"https://atlas.test/complete",cancelTarget:"https://atlas.test/cancel",payerEmail:"payer@example.test"};
  assert.equal((await provider.createCheckoutSession({idempotencyKey:valid.idempotencyKey,catalogReference:valid.catalogReference,successTarget:valid.successTarget,cancelTarget:valid.cancelTarget})).kind,"failed"); assert.equal((await provider.createCheckoutSession({...valid,catalogReference:""})).kind,"failed"); assert.equal((await provider.createCheckoutSession({...valid,successTarget:"https://evil.test/complete"})).kind,"failed"); assert.equal(calls,0);
  assert.equal((await provider.cancelAtPeriodEnd({idempotencyKey:"key",subscriptionReference:"sub"})).kind,"failed"); assert.equal((await provider.reactivateSubscription({idempotencyKey:"key",subscriptionReference:"sub"})).kind,"failed"); assert.equal((await provider.createPortalSession({billingAccountReference:"customer",returnTarget:"https://atlas.test/return"})).kind,"failed"); assert.equal(calls,0);
  for(const [status,payload] of [[400,"{}"],[500,"{}"],[200,"not-json"],[200,JSON.stringify({id:"preapproval",init_point:"https://evil.test/init"})]] as const){const p=new MercadoPagoBillingProvider({accessToken:"mp-token",apiBaseUrl:"https://api.mercadopago.test",timeoutMs:50,allowedRedirectOrigins:["https://atlas.test","https://mp.test"]},async()=>new Response(payload,{status})); assert.equal((await p.createCheckoutSession(valid)).kind,status===400?"failed":"uncertain");}
  const rejected=new MercadoPagoBillingProvider({accessToken:"mp-token",apiBaseUrl:"https://api.mercadopago.test",timeoutMs:50,allowedRedirectOrigins:["https://atlas.test","https://mp.test"]},async()=>{throw new Error("network unavailable");}); assert.equal((await rejected.createCheckoutSession(valid)).kind,"uncertain");
  let aborted=false; const timedOut=new MercadoPagoBillingProvider({accessToken:"mp-token",apiBaseUrl:"https://api.mercadopago.test",timeoutMs:1,allowedRedirectOrigins:["https://atlas.test","https://mp.test"]},async(_url,init)=>new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener("abort",()=>{aborted=init.signal!.aborted;reject(new DOMException("aborted","AbortError"));},{once:true}))); assert.equal((await timedOut.createCheckoutSession(valid)).kind,"uncertain"); assert.equal(aborted,true);
});

test("EPIC046 reads paused provider evidence without changing trusted local authority", async () => {
  const stripe=new StripeBillingProvider({secretKey:"sk",apiBaseUrl:"https://api.stripe.test",timeoutMs:50,allowedRedirectOrigins:["https://atlas.test"]},async(url,init)=>{assert.equal(url,"https://api.stripe.test/v1/subscriptions/sub_paused");assert.equal(init.method,"GET");return new Response(JSON.stringify({id:"sub_paused",status:"paused",current_period_start:1,current_period_end:2,trial_end:null,cancel_at_period_end:false}));});
  const evidence=await stripe.readSubscription({subscriptionReference:"sub_paused"});assert.equal(evidence.kind,"success");if(evidence.kind!=="success")throw new Error("expected evidence");assert.equal(evidence.evidence.providerEvidenceState,"paused");assert.equal(effectiveSubscriptionStateForEvidence(evidence.evidence),"paused");assert.deepEqual(entitlementForEffectiveSubscription("paused"),{state:"restricted",mutationEligible:false});
  const mercado=new MercadoPagoBillingProvider({accessToken:"token",apiBaseUrl:"https://api.mercadopago.test",timeoutMs:50,allowedRedirectOrigins:["https://atlas.test"]},async(url,init)=>{assert.equal(url,"https://api.mercadopago.test/preapproval/pre_paused");assert.equal(init.method,"GET");return new Response(JSON.stringify({id:"pre_paused",status:"paused",date_created:"2026-09-01T00:00:00Z",next_payment_date:"2026-10-01T00:00:00Z"}));});assert.equal((await mercado.readSubscription({subscriptionReference:"pre_paused"})).kind,"success");
  const db=open();try{const workspace=defaultWorkspace(db),account=new BillingAccountRepository(db).findByWorkspace(workspace)!;db.prepare("UPDATE billing_accounts SET rollout_mode='managed',provider_kind='stripe',provider_customer_id='cus' WHERE id=?").run(account.id);db.prepare("UPDATE billing_subscriptions SET provider_kind='stripe',provider_subscription_id='sub_paused',effective_state='active' WHERE billing_account_id=?").run(account.id);const before=db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(account.id),service=new BillingSubscriptionReadService(new BillingAccountRepository(db),new BillingSubscriptionRepository(db),new BillingProviderRegistry([{kind:"stripe",provider:stripe}]));const read=await service.read(workspace);assert.equal(read.kind,"available");assert.equal(read.kind==="available"&&read.effectiveState,"paused");assert.deepEqual(db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(account.id),before);assert.equal(new BillingEntitlementService(db).mayCreateCompany(workspace).safeReason,"allowed");db.prepare("UPDATE billing_subscriptions SET effective_state='paused' WHERE billing_account_id=?").run(account.id);assert.equal(new BillingEntitlementService(db).mayCreateCompany(workspace).safeReason,"billing_restricted");}finally{db.close();}
});

test("EPIC046 maps provider subscription 404 reads to explicit not_found", async () => {
  const stripe=new StripeBillingProvider({secretKey:"sk",apiBaseUrl:"https://api.stripe.test",timeoutMs:50,allowedRedirectOrigins:["https://atlas.test"]},async()=>new Response("{}",{status:404}));
  const mercado=new MercadoPagoBillingProvider({accessToken:"token",apiBaseUrl:"https://api.mercadopago.test",timeoutMs:50,allowedRedirectOrigins:["https://atlas.test"]},async()=>new Response("{}",{status:404}));
  assert.deepEqual(await stripe.readSubscription({subscriptionReference:"sub_missing"}),{kind:"not_found"});
  assert.deepEqual(await mercado.readSubscription({subscriptionReference:"pre_missing"}),{kind:"not_found"});
});

test("EPIC046 reconciliation settles not_found, retries unavailable reads, and requeues a woken lease", async () => {
  const db=open();
  try {
    const workspaceId=defaultWorkspace(db),account=new BillingAccountRepository(db).findByWorkspace(workspaceId)!;
    db.prepare("UPDATE billing_accounts SET rollout_mode='managed',provider_kind='stripe',provider_customer_id='cus_reconciliation' WHERE id=?").run(account.id);
    db.prepare("UPDATE billing_subscriptions SET provider_kind='stripe',provider_subscription_id='sub_reconciliation',provider_evidence_state='active',effective_state='active' WHERE billing_account_id=?").run(account.id);
    const webhooks=new BillingWebhookRepository(db),work=new BillingReconciliationRepository(db);
    const enqueue=(id:string)=>webhooks.accept({providerKind:"stripe",providerEventId:id,eventType:"customer.subscription.updated",providerObjectId:"sub_reconciliation",providerCustomerId:"cus_reconciliation",providerSubscriptionId:"sub_reconciliation",payloadDigest:"a".repeat(64)},at);
    let read:()=>Promise<ReturnType<BillingProvider["readSubscription"]> extends Promise<infer Result>?Result:never>=async()=>({kind:"not_found"});
    const provider:BillingProvider={capabilities:stripeBillingProviderCapabilities,createCheckoutSession:async()=>({kind:"failed",code:"invalid_request"}),createPortalSession:async()=>({kind:"failed",code:"invalid_request"}),cancelAtPeriodEnd:async()=>({kind:"failed",code:"invalid_request"}),reactivateSubscription:async()=>({kind:"failed",code:"invalid_request"}),readSubscription:()=>read()};
    const worker=new BillingReconciliationWorker(work,new BillingProviderRegistry([{kind:"stripe",provider}]),()=>at);
    assert.equal(enqueue("evt_reconciliation_missing"),"accepted");
    assert.equal(await worker.runNext("missing"),"applied");
    assert.deepEqual({...db.prepare("SELECT provider_evidence_state,effective_state,cancel_at_period_end,current_period_start,current_period_end FROM billing_subscriptions WHERE billing_account_id=?").get(account.id) as Record<string,unknown>},{provider_evidence_state:"unknown",effective_state:"reconciliation_required",cancel_at_period_end:0,current_period_start:null,current_period_end:null});
    assert.deepEqual({...db.prepare("SELECT entitlement_state,mutation_eligible FROM billing_entitlement_snapshots WHERE billing_account_id=? AND is_current=1").get(account.id) as Record<string,unknown>},{entitlement_state:"restricted",mutation_eligible:0});
    assert.equal((db.prepare("SELECT status FROM billing_reconciliation_work").get() as {status:string}|undefined)?.status,"succeeded");

    db.prepare("UPDATE billing_reconciliation_work SET status='pending',next_attempt_at=?,version=version+1 WHERE billing_account_id=?").run(at,account.id);
    read=async()=>({kind:"failed",code:"unavailable"});
    const before=db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(account.id);
    assert.equal(await worker.runNext("failed"),"retry");
    assert.deepEqual(db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(account.id),before);
    const retry=db.prepare("SELECT status,safe_failure_code,next_attempt_at FROM billing_reconciliation_work WHERE billing_account_id=?").get(account.id) as {status:string;safe_failure_code:string;next_attempt_at:string};
    assert.equal(retry.status,"pending"); assert.equal(retry.safe_failure_code,"unavailable"); assert.notEqual(retry.next_attempt_at,"Invalid Date");

    db.prepare("UPDATE billing_reconciliation_work SET next_attempt_at=? WHERE billing_account_id=?").run(at,account.id);
    read=async()=>({kind:"uncertain"});
    assert.equal(await worker.runNext("uncertain"),"retry");
    assert.equal((db.prepare("SELECT safe_failure_code FROM billing_reconciliation_work WHERE billing_account_id=?").get(account.id) as {safe_failure_code:string}).safe_failure_code,"uncertain");

    db.prepare("UPDATE billing_reconciliation_work SET next_attempt_at=? WHERE billing_account_id=?").run(at,account.id);
    let release:(result:Awaited<ReturnType<BillingProvider["readSubscription"]>>)=>void=()=>undefined;
    const gate=new Promise<Awaited<ReturnType<BillingProvider["readSubscription"]>>>(resolve=>{release=resolve;}); read=()=>gate;
    const running=worker.runNext("woken"); await new Promise<void>(resolve=>setImmediate(resolve));
    assert.equal(enqueue("evt_reconciliation_wake"),"accepted");
    release({kind:"success",evidence:{providerSubscriptionId:"sub_reconciliation",providerEvidenceState:"active",currentPeriodStart:null,currentPeriodEnd:null,trialEndsAt:null,cancelAtPeriodEnd:false}});
    assert.equal(await running,"requeued");
    assert.equal((db.prepare("SELECT status,wake_generation FROM billing_reconciliation_work WHERE billing_account_id=?").get(account.id) as {status:string;wake_generation:number}).status,"pending");
    assert.equal(await worker.runNext("successor"),"applied");
    assert.equal((db.prepare("SELECT effective_state FROM billing_subscriptions WHERE billing_account_id=?").get(account.id) as {effective_state:string}).effective_state,"active");
  } finally { db.close(); }
});

function reconciliationProvider(read: BillingProvider["readSubscription"]): BillingProvider { return {capabilities:stripeBillingProviderCapabilities,createCheckoutSession:async()=>({kind:"failed",code:"invalid_request"}),createPortalSession:async()=>({kind:"failed",code:"invalid_request"}),cancelAtPeriodEnd:async()=>({kind:"failed",code:"invalid_request"}),reactivateSubscription:async()=>({kind:"failed",code:"invalid_request"}),readSubscription:read}; }
function reconcileAccount(db: DatabaseSync, suffix: string): { readonly accountId: string; readonly subscriptionId: string; readonly enqueue: (eventId: string) => void } {
  const workspaceId=defaultWorkspace(db),account=new BillingAccountRepository(db).findByWorkspace(workspaceId)!;
  db.prepare("UPDATE billing_accounts SET rollout_mode='managed',provider_kind='stripe',provider_customer_id=? WHERE id=?").run(`cus_${suffix}`,account.id);
  db.prepare("UPDATE billing_subscriptions SET provider_kind='stripe',provider_subscription_id=?,provider_evidence_state='active',effective_state='active' WHERE billing_account_id=?").run(`sub_${suffix}`,account.id);
  const subscriptionId=(db.prepare("SELECT id FROM billing_subscriptions WHERE billing_account_id=? AND is_current=1").get(account.id) as {id:string}).id;
  const webhooks=new BillingWebhookRepository(db);
  return {accountId:account.id,subscriptionId,enqueue:(eventId:string)=>{assert.equal(webhooks.accept({providerKind:"stripe",providerEventId:eventId,eventType:"customer.subscription.updated",providerObjectId:`sub_${suffix}`,providerCustomerId:`cus_${suffix}`,providerSubscriptionId:`sub_${suffix}`,payloadDigest:"b".repeat(64)},at),"accepted");}};
}
const activeEvidence=(reference:string)=>({kind:"success" as const,evidence:{providerSubscriptionId:reference,providerEvidenceState:"active" as const,currentPeriodStart:null,currentPeriodEnd:null,trialEndsAt:null,cancelAtPeriodEnd:false}});
const pausedEvidence=(reference:string)=>({kind:"success" as const,evidence:{providerSubscriptionId:reference,providerEvidenceState:"paused" as const,currentPeriodStart:null,currentPeriodEnd:null,trialEndsAt:null,cancelAtPeriodEnd:false}});

test("EPIC046 PASS4F4A two independent SQLite workers claim one pending reconciliation read", async () => {
  const directory=mkdtempSync(join(tmpdir(),"atlas-epic046-reconciliation-race-")),path=join(directory,"atlas.sqlite"),first=open(path),second=open(path);
  try { const setup=reconcileAccount(first,"race"),reads:string[]=[];setup.enqueue("evt_race");let release:()=>void=()=>undefined;const gate=new Promise<void>(resolve=>{release=resolve;});const provider=reconciliationProvider(async({subscriptionReference})=>{reads.push(subscriptionReference);await gate;return activeEvidence(subscriptionReference);});const a=new BillingReconciliationWorker(new BillingReconciliationRepository(first),new BillingProviderRegistry([{kind:"stripe",provider}]),()=>at),b=new BillingReconciliationWorker(new BillingReconciliationRepository(second),new BillingProviderRegistry([{kind:"stripe",provider}]),()=>at);const running=a.runNext("a");await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(await b.runNext("b"),"no_work");assert.deepEqual(reads,["sub_race"]);release();assert.equal(await running,"applied"); } finally { first.close();second.close();rmSync(directory,{recursive:true,force:true}); }
});

test("EPIC046 PASS4F4A expired lease fences a late worker after a newer worker applies", async () => {
  const directory=mkdtempSync(join(tmpdir(),"atlas-epic046-reconciliation-lease-")),path=join(directory,"atlas.sqlite"),first=open(path),second=open(path),start="2026-09-01T00:00:00.000Z",expired="2026-09-01T00:01:01.000Z";
  try { const setup=reconcileAccount(first,"lease"),reads:string[]=[];setup.enqueue("evt_lease");let release:()=>void=()=>undefined;const gate=new Promise<void>(resolve=>{release=resolve;});const providerA=reconciliationProvider(async({subscriptionReference})=>{reads.push("A");await gate;return activeEvidence(subscriptionReference);}),providerB=reconciliationProvider(async({subscriptionReference})=>{reads.push("B");return pausedEvidence(subscriptionReference);});const a=new BillingReconciliationWorker(new BillingReconciliationRepository(first),new BillingProviderRegistry([{kind:"stripe",provider:providerA}]),()=>start,60_000),b=new BillingReconciliationWorker(new BillingReconciliationRepository(second),new BillingProviderRegistry([{kind:"stripe",provider:providerB}]),()=>expired,60_000);const late=a.runNext("a");await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(await b.runNext("b"),"applied");const afterB=first.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE id=?").get(setup.subscriptionId);release();assert.equal(await late,"lost_lease");assert.deepEqual(first.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE id=?").get(setup.subscriptionId),afterB);assert.deepEqual(reads,["A","B"]); } finally { first.close();second.close();rmSync(directory,{recursive:true,force:true}); }
});

test("EPIC046 PASS4F4A reconciliation rolls back subscription and settlement after entitlement fault", async () => {
  const db=open();try { const setup=reconcileAccount(db,"rollback");setup.enqueue("evt_rollback");const before=db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE id=?").get(setup.subscriptionId);db.exec("CREATE TRIGGER epic046_reconciliation_fault BEFORE UPDATE ON billing_entitlement_snapshots BEGIN SELECT RAISE(ABORT,'injected reconciliation fault'); END;");const worker=new BillingReconciliationWorker(new BillingReconciliationRepository(db),new BillingProviderRegistry([{kind:"stripe",provider:reconciliationProvider(async({subscriptionReference})=>pausedEvidence(subscriptionReference))}]),()=>at);await assert.rejects(worker.runNext("rollback"),/injected reconciliation fault/);assert.deepEqual(db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE id=?").get(setup.subscriptionId),before);assert.deepEqual({...db.prepare("SELECT status,attempt_count FROM billing_reconciliation_work WHERE billing_account_id=?").get(setup.accountId) as Record<string,unknown>},{status:"leased",attempt_count:1}); } finally { db.close(); }
});

test("EPIC046 PASS4F4A wake generation guarantees a full successor canonical read", async () => {
  const db=open();try { const setup=reconcileAccount(db,"wake-read"),reads:string[]=[];setup.enqueue("evt_wake_read");let release:()=>void=()=>undefined;const gate=new Promise<void>(resolve=>{release=resolve;});const provider=reconciliationProvider(async({subscriptionReference})=>{reads.push(subscriptionReference);if(reads.length===1)await gate;return reads.length===1?activeEvidence(subscriptionReference):pausedEvidence(subscriptionReference);});const worker=new BillingReconciliationWorker(new BillingReconciliationRepository(db),new BillingProviderRegistry([{kind:"stripe",provider}]),()=>at);const first=worker.runNext("first");await new Promise<void>(resolve=>setImmediate(resolve));setup.enqueue("evt_wake_read_successor");release();assert.equal(await first,"requeued");assert.equal(await worker.runNext("successor"),"applied");assert.deepEqual(reads,["sub_wake-read","sub_wake-read"]);assert.equal((db.prepare("SELECT effective_state FROM billing_subscriptions WHERE id=?").get(setup.subscriptionId) as {effective_state:string}).effective_state,"paused"); } finally { db.close(); }
});

test("EPIC046 PASS4F4A retry and apply reject lost lease and CAS claims", () => {
  const db=open();try { const setup=reconcileAccount(db,"fences"),work=new BillingReconciliationRepository(db);setup.enqueue("evt_fences");const first=work.claimNext("first",at,"2026-09-01T00:01:00.000Z")!,second=work.claimNext("second","2026-09-01T00:01:01.000Z","2026-09-01T00:02:01.000Z")!;assert.equal(work.retry(first,at,"2026-09-01T00:02:00.000Z","unavailable"),false);assert.equal((db.prepare("SELECT lease_token FROM billing_reconciliation_work WHERE id=?").get(second.id) as {lease_token:string}).lease_token,second.leaseToken);const subscription=work.trustedSubscription(second)!;db.prepare("UPDATE billing_subscriptions SET version=version+1 WHERE id=?").run(setup.subscriptionId);assert.equal(work.apply(second,subscription,pausedEvidence("sub_fences").evidence,"paused",at),"cas_lost");assert.equal((db.prepare("SELECT status FROM billing_reconciliation_work WHERE id=?").get(second.id) as {status:string}).status,"leased"); } finally { db.close(); }
});

test("EPIC046 PASS4F4A identical canonical evidence settles without subscription or entitlement churn", async () => {
  const db=open();try { const setup=reconcileAccount(db,"same"),work=new BillingReconciliationRepository(db);setup.enqueue("evt_same");const beforeSubscription=db.prepare("SELECT version,updated_at FROM billing_subscriptions WHERE id=?").get(setup.subscriptionId),beforeEntitlement=db.prepare("SELECT version,evaluated_at FROM billing_entitlement_snapshots WHERE billing_account_id=? AND is_current=1").get(setup.accountId);const worker=new BillingReconciliationWorker(work,new BillingProviderRegistry([{kind:"stripe",provider:reconciliationProvider(async({subscriptionReference})=>activeEvidence(subscriptionReference))}]),()=>at);assert.equal(await worker.runNext("same"),"applied");assert.deepEqual(db.prepare("SELECT version,updated_at FROM billing_subscriptions WHERE id=?").get(setup.subscriptionId),beforeSubscription);assert.deepEqual(db.prepare("SELECT version,evaluated_at FROM billing_entitlement_snapshots WHERE billing_account_id=? AND is_current=1").get(setup.accountId),beforeEntitlement); } finally { db.close(); }
});

test("EPIC046 PASS4F4A distinct subscriptions reconcile in isolation", async () => {
  const db=open();try { const first=reconcileAccount(db,"isolation_a"),workspace=new WorkspaceRepository(db).create({publicId:"wsp_reconciliation_isolation",key:"reconciliation-isolation",name:"Reconciliation isolation",timezone:null,defaultLocale:null}),account=new BillingAccountRepository(db).findByWorkspace(workspace.id)!;db.prepare("UPDATE billing_accounts SET rollout_mode='managed',provider_kind='stripe',provider_customer_id='cus_isolation_b' WHERE id=?").run(account.id);db.prepare("UPDATE billing_subscriptions SET provider_kind='stripe',provider_subscription_id='sub_isolation_b',provider_evidence_state='active',effective_state='active' WHERE billing_account_id=?").run(account.id);const secondSubscription=(db.prepare("SELECT id FROM billing_subscriptions WHERE billing_account_id=?").get(account.id) as {id:string}).id;first.enqueue("evt_isolation_a");assert.equal(new BillingWebhookRepository(db).accept({providerKind:"stripe",providerEventId:"evt_isolation_b",eventType:"customer.subscription.updated",providerObjectId:"sub_isolation_b",providerCustomerId:"cus_isolation_b",providerSubscriptionId:"sub_isolation_b",payloadDigest:"c".repeat(64)},at),"accepted");const worker=new BillingReconciliationWorker(new BillingReconciliationRepository(db),new BillingProviderRegistry([{kind:"stripe",provider:reconciliationProvider(async({subscriptionReference})=>subscriptionReference==="sub_isolation_a"?pausedEvidence(subscriptionReference):activeEvidence(subscriptionReference))}]),()=>at);assert.deepEqual(await worker.runBatch(2,"isolation"),["applied","applied"]);assert.equal((db.prepare("SELECT effective_state FROM billing_subscriptions WHERE id=?").get(first.subscriptionId) as {effective_state:string}).effective_state,"paused");assert.equal((db.prepare("SELECT effective_state FROM billing_subscriptions WHERE id=?").get(secondSubscription) as {effective_state:string}).effective_state,"active"); } finally { db.close(); }
});

test("EPIC046 PASS4F4A uses bounded exponential backoff and distinguishes unavailable not_found and uncertain", async () => {
  const db=open();try { const setup=reconcileAccount(db,"outcomes"),work=new BillingReconciliationRepository(db);setup.enqueue("evt_outcomes");let result:Awaited<ReturnType<BillingProvider["readSubscription"]>>={kind:"failed",code:"unavailable"};const worker=new BillingReconciliationWorker(work,new BillingProviderRegistry([{kind:"stripe",provider:reconciliationProvider(async()=>result)}]),()=>at);for(const minutes of [1,2,4,8,16,32,60,60]){assert.equal(await worker.runNext("backoff"),"retry");const row=db.prepare("SELECT next_attempt_at,safe_failure_code FROM billing_reconciliation_work WHERE billing_account_id=?").get(setup.accountId) as {next_attempt_at:string;safe_failure_code:string};assert.equal(row.next_attempt_at,new Date(new Date(at).getTime()+minutes*60_000).toISOString());assert.equal(row.safe_failure_code,"unavailable");db.prepare("UPDATE billing_reconciliation_work SET next_attempt_at=? WHERE billing_account_id=?").run(at,setup.accountId);}const before=db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE id=?").get(setup.subscriptionId);result={kind:"uncertain"};assert.equal(await worker.runNext("uncertain"),"retry");assert.deepEqual(db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE id=?").get(setup.subscriptionId),before);assert.equal((db.prepare("SELECT safe_failure_code FROM billing_reconciliation_work WHERE billing_account_id=?").get(setup.accountId) as {safe_failure_code:string}).safe_failure_code,"uncertain");db.prepare("UPDATE billing_reconciliation_work SET next_attempt_at=? WHERE billing_account_id=?").run(at,setup.accountId);result={kind:"not_found"};assert.equal(await worker.runNext("missing"),"applied");assert.deepEqual({...db.prepare("SELECT provider_evidence_state,effective_state FROM billing_subscriptions WHERE id=?").get(setup.subscriptionId) as Record<string,unknown>},{provider_evidence_state:"unknown",effective_state:"reconciliation_required"}); } finally { db.close(); }
});

test("EPIC046 service settles Stripe checkout success, replay, conflict, and 500 durably", async () => {
  const db=open(); try { const workspaceId=defaultWorkspace(db), accounts=new BillingAccountRepository(db), catalog=new BillingCatalogRepository(db), account=accounts.findByWorkspace(workspaceId)!, entry=catalog.create(catalogInput({planKey:"stripe-service",catalogVersion:1,providerKind:"stripe",providerPriceId:"price_trusted"})); let calls=0; const stripe=new StripeBillingProvider({secretKey:"sk_test",apiBaseUrl:"https://api.stripe.test",timeoutMs:50,allowedRedirectOrigins:["https://atlas.test","https://checkout.stripe.test"]},async()=>{calls++;return new Response(JSON.stringify({id:"cs_service",url:"https://checkout.stripe.test/session"}));}); const service=new BillingOperationService(accounts,catalog,new BillingSubscriptionRepository(db),new BillingOperationRepository(db),new BillingProviderRegistry([{kind:"stripe",provider:stripe}]),()=>at), input={workspaceId,catalogEntryId:entry.id,operationId:"stripe-service",successTarget:"https://atlas.test/success",cancelTarget:"https://atlas.test/cancel"}, before=db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(account.id), snapshot=db.prepare("SELECT version FROM billing_entitlement_snapshots WHERE billing_account_id=?").get(account.id); assert.equal((await service.checkout(input)).kind,"succeeded"); assert.equal((await service.checkout(input)).kind,"succeeded"); assert.equal((await service.checkout({...input,cancelTarget:"https://atlas.test/other"})).kind,"conflict"); assert.equal(calls,1); const row=new BillingOperationRepository(db).find(account.id,"checkout_session_create","stripe-service")!; assert.equal(row.status,"succeeded"); assert.equal(row.providerObjectId,"cs_service"); assert.deepEqual(db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(account.id),before); assert.deepEqual(db.prepare("SELECT version FROM billing_entitlement_snapshots WHERE billing_account_id=?").get(account.id),snapshot); const failing=new BillingOperationService(accounts,catalog,new BillingSubscriptionRepository(db),new BillingOperationRepository(db),new BillingProviderRegistry([{kind:"stripe",provider:new StripeBillingProvider({secretKey:"sk_test",apiBaseUrl:"https://api.stripe.test",timeoutMs:50,allowedRedirectOrigins:["https://atlas.test"]},async()=>{calls++;return new Response("{}",{status:500});})}]),()=>at); const second={...input,operationId:"stripe-500"}; assert.equal((await failing.checkout(second)).kind,"conflict"); assert.equal((await failing.checkout(second)).kind,"conflict"); assert.equal(calls,1); assert.equal(new BillingOperationRepository(db).find(account.id,"checkout_session_create","stripe-500"),null); assert.deepEqual({...db.prepare("SELECT provider_kind,provider_checkout_object_id,status FROM billing_checkout_enrollments WHERE billing_account_id=?").get(account.id) as Record<string,unknown>},{provider_kind:"stripe",provider_checkout_object_id:"cs_service",status:"pending"}); } finally {db.close();}
});

test("EPIC046 Stripe adapter aborts one timed-out fetch without retry", async () => { let calls=0, aborted=false; const provider=new StripeBillingProvider({secretKey:"sk_test",apiBaseUrl:"https://api.stripe.test",timeoutMs:1,allowedRedirectOrigins:["https://atlas.test"]},async(_url,init)=>{calls++;return new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener("abort",()=>{aborted=init.signal!.aborted;reject(new DOMException("aborted","AbortError"));},{once:true}));}); assert.deepEqual(await provider.createCheckoutSession({idempotencyKey:"key",catalogReference:"price",successTarget:"https://atlas.test/s",cancelTarget:"https://atlas.test/c"}),{kind:"uncertain"}); assert.equal(calls,1); assert.equal(aborted,true); });

test("EPIC046 Stripe cancel reactivate and portal use exact safe form mappings", async () => {
  const requests:Array<{url:string;init:RequestInit}>=[]; const provider=new StripeBillingProvider({secretKey:"sk_test_dummy",apiBaseUrl:"https://api.stripe.test",timeoutMs:50,allowedRedirectOrigins:["https://atlas.test","https://stripe.test"]},async(url,init)=>{requests.push({url,init});return new Response(JSON.stringify({id:"sub_safe",url:"https://stripe.test/portal"}));});
  assert.deepEqual(await provider.cancelAtPeriodEnd({idempotencyKey:"cancel-key",subscriptionReference:"sub_x/../../customers"}),{kind:"success",providerObjectId:"sub_safe"}); assert.equal(requests[0]!.url,"https://api.stripe.test/v1/subscriptions/sub_x%2F..%2F..%2Fcustomers"); let headers=new Headers(requests[0]!.init.headers); assert.equal(headers.get("authorization"),"Bearer sk_test_dummy"); assert.equal(headers.get("idempotency-key"),"cancel-key"); assert.equal(new URLSearchParams(String(requests[0]!.init.body)).get("cancel_at_period_end"),"true");
  assert.deepEqual(await provider.reactivateSubscription({idempotencyKey:"reactivate-key",subscriptionReference:"sub_safe"}),{kind:"success",providerObjectId:"sub_safe"}); headers=new Headers(requests[1]!.init.headers); assert.equal(headers.get("idempotency-key"),"reactivate-key"); assert.equal(new URLSearchParams(String(requests[1]!.init.body)).get("cancel_at_period_end"),"false");
  assert.deepEqual(await provider.createPortalSession({billingAccountReference:"cus_safe",returnTarget:"https://atlas.test/return"}),{kind:"success",providerObjectId:"sub_safe",redirectUrl:"https://stripe.test/portal"}); headers=new Headers(requests[2]!.init.headers); assert.equal(requests[2]!.url,"https://api.stripe.test/v1/billing_portal/sessions"); assert.equal(headers.has("idempotency-key"),false); const body=new URLSearchParams(String(requests[2]!.init.body)); assert.equal(body.get("customer"),"cus_safe"); assert.equal(body.get("return_url"),"https://atlas.test/return"); assert.deepEqual(await provider.createPortalSession({billingAccountReference:"",returnTarget:"https://atlas.test/return"}),{kind:"failed",code:"invalid_request"}); assert.equal(requests.length,3);
  for(const status of [400,500] as const){const p=new StripeBillingProvider({secretKey:"sk",apiBaseUrl:"https://api.stripe.test",timeoutMs:50,allowedRedirectOrigins:["https://atlas.test"]},async()=>new Response("{}",{status}));assert.equal((await p.cancelAtPeriodEnd({idempotencyKey:"k",subscriptionReference:"sub"})).kind,status===400?"failed":"uncertain");assert.equal((await p.reactivateSubscription({idempotencyKey:"k",subscriptionReference:"sub"})).kind,status===400?"failed":"uncertain");assert.equal((await p.createPortalSession({billingAccountReference:"cus",returnTarget:"https://atlas.test/r"})).kind,status===400?"failed":"uncertain");}
});

test("EPIC046 Stripe environment factory is opt-in, bounded, and secret-safe", () => {
  let calls=0; const fetcher:typeof fetch=async()=>{calls++;return new Response("{}");}; const enabled={BILLING_PROVIDERS:"stripe",STRIPE_SECRET_KEY:"dummy-secret-not-to-leak",STRIPE_ALLOWED_REDIRECT_ORIGINS:"https://app.example.test,https://app.example.test"}; const provider=stripeBillingProviderFromEnvironment(enabled,fetcher); assert.ok(provider instanceof StripeBillingProvider); assert.equal(calls,0);
  for(const environment of [{...enabled,STRIPE_SECRET_KEY:""},{...enabled,STRIPE_SECRET_KEY:"   "},{...enabled,STRIPE_API_BASE_URL:"http://api.stripe.test"},{...enabled,STRIPE_API_BASE_URL:"javascript:alert(1)"},{...enabled,STRIPE_API_BASE_URL:"not-a-url"},{...enabled,STRIPE_TIMEOUT_MS:"0"},{...enabled,STRIPE_TIMEOUT_MS:"-1"},{...enabled,STRIPE_TIMEOUT_MS:"1.5"},{...enabled,STRIPE_TIMEOUT_MS:"abc"},{...enabled,STRIPE_TIMEOUT_MS:"60001"},{...enabled,STRIPE_ALLOWED_REDIRECT_ORIGINS:"http://example.test"},{...enabled,STRIPE_ALLOWED_REDIRECT_ORIGINS:"https://example.test/path"},{...enabled,STRIPE_ALLOWED_REDIRECT_ORIGINS:"https://example.test?x=1"},{...enabled,STRIPE_ALLOWED_REDIRECT_ORIGINS:"javascript:alert(1)"}]) { assert.throws(()=>stripeBillingProviderFromEnvironment(environment,fetcher),error=>error instanceof StripeBillingConfigurationError&&!error.message.includes("dummy-secret-not-to-leak")); }
  assert.ok(stripeBillingProviderFromEnvironment({...enabled,STRIPE_TIMEOUT_MS:"1"},fetcher)); assert.ok(stripeBillingProviderFromEnvironment({...enabled,STRIPE_TIMEOUT_MS:"60000"},fetcher));
});

test("EPIC046 composes a closed multi-provider registry without fallback", () => {
  let calls=0; const fetcher:typeof fetch=async()=>{calls++;return new Response("{}");}; const stripe={BILLING_PROVIDERS:"stripe",STRIPE_SECRET_KEY:"dummy-secret-not-to-leak",STRIPE_ALLOWED_REDIRECT_ORIGINS:"https://atlas.test"};
  assert.deepEqual(billingProviderKindsFromEnvironment({}),[]); assert.equal(billingProviderRegistryFromEnvironment({}).size,0); assert.equal(calls,0);
  const registry=billingProviderRegistryFromEnvironment(stripe,fetcher); assert.equal(registry.size,1); assert.equal(registry.has("stripe"),true); assert.equal(registry.has("mercadopago"),false); assert.equal(calls,0);
  assert.equal(billingProviderRegistryFromEnvironment({...stripe,BILLING_PROVIDERS:"stripe,stripe"},fetcher).size,1); assert.deepEqual(billingProviderKindsFromEnvironment({...stripe,BILLING_PROVIDERS:" stripe , mercadopago "}),["stripe","mercadopago"]);
  const mercadoPago={BILLING_PROVIDERS:"mercadopago",MERCADOPAGO_ACCESS_TOKEN:"mp-secret-not-to-leak",MERCADOPAGO_ALLOWED_REDIRECT_ORIGINS:"https://atlas.test"};
  assert.equal(billingProviderRegistryFromEnvironment(mercadoPago,fetcher).has("mercadopago"),true); assert.throws(()=>billingProviderRegistryFromEnvironment({...stripe,BILLING_PROVIDERS:"mercadopago",STRIPE_TIMEOUT_MS:"garbage"},fetcher),error=>error instanceof MercadoPagoBillingConfigurationError&&!error.message.includes("dummy-secret-not-to-leak"));
  assert.equal(billingProviderRegistryFromEnvironment({...stripe,...mercadoPago,BILLING_PROVIDERS:"stripe,mercadopago"},fetcher).size,2); assert.throws(()=>billingProviderRegistryFromEnvironment({...stripe,BILLING_PROVIDERS:"stripe,paypal"},fetcher),error=>error instanceof BillingProviderConfigurationError);
  assert.equal(billingProviderRegistryFromEnvironment({STRIPE_TIMEOUT_MS:"garbage"},fetcher).size,0); assert.equal(calls,0);
});

test("EPIC046 Mercado Pago environment factory is opt-in, bounded, and secret-safe", () => {
  const enabled={MERCADOPAGO_ACCESS_TOKEN:"mp-secret-not-to-leak",MERCADOPAGO_ALLOWED_REDIRECT_ORIGINS:"https://atlas.test"};
  assert.ok(mercadoPagoBillingProviderFromEnvironment(enabled) instanceof MercadoPagoBillingProvider);
  for(const environment of [{...enabled,MERCADOPAGO_ACCESS_TOKEN:""},{...enabled,MERCADOPAGO_API_BASE_URL:"http://api.mercadopago.test"},{...enabled,MERCADOPAGO_TIMEOUT_MS:"0"},{...enabled,MERCADOPAGO_TIMEOUT_MS:"60001"},{...enabled,MERCADOPAGO_ALLOWED_REDIRECT_ORIGINS:"http://atlas.test"}])assert.throws(()=>mercadoPagoBillingProviderFromEnvironment(environment),error=>error instanceof MercadoPagoBillingConfigurationError&&!error.message.includes("mp-secret-not-to-leak"));
});

test("EPIC046 resolves only the explicitly selected active verified payer identity", () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accountId=(db.prepare("SELECT id FROM billing_accounts WHERE workspace_id=?").get(workspaceId)as{id:string}).id,resolver=new BillingPayerIdentityResolver(db),now=at;
    assert.equal((db.prepare("SELECT billing_payer_identity_id value FROM billing_accounts WHERE id=?").get(accountId)as{value:null}).value,null); assert.equal(resolver.resolveForBillingAccount("unknown"),null);
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('payer','active','en',?,?)").run(now,now); db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES('payer-member',?,'payer','owner','active',1,?,?)").run(workspaceId,now,now);
    db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES('payer-a','payer','a@example.test','a@example.test',1,?,?),('payer-b','payer','b@example.test','b@example.test',1,?,?),('payer-unverified','payer','u@example.test','u@example.test',0,?,?)").run(now,now,now,now,now,now); const accounts=new BillingAccountRepository(db),initial=accounts.findById(accountId)!;
    const set=accounts.setPayerIdentity(accountId,"payer-b",initial.version,now)!; assert.equal(set.billingPayerIdentityId,"payer-b"); assert.equal(set.version,initial.version+1); assert.equal(accounts.setPayerIdentity(accountId,"payer-a",initial.version,now),null); assert.equal(accounts.findById(accountId)!.billingPayerIdentityId,"payer-b"); const cleared=accounts.clearPayerIdentity(accountId,set.version,now)!; assert.equal(cleared.billingPayerIdentityId,null); assert.equal(cleared.version,set.version+1);
    db.prepare("UPDATE billing_accounts SET billing_payer_identity_id='payer-b' WHERE id=?").run(accountId); assert.deepEqual(resolver.resolveForBillingAccount(accountId),{identityId:"payer-b",userId:"payer",email:"b@example.test"});
    db.prepare("UPDATE billing_accounts SET billing_payer_identity_id='payer-a' WHERE id=?").run(accountId); assert.deepEqual(resolver.resolveForBillingAccount(accountId),{identityId:"payer-a",userId:"payer",email:"a@example.test"});
    assert.throws(()=>db.prepare("UPDATE billing_accounts SET billing_payer_identity_id='missing' WHERE id=?").run(accountId)); assert.equal((db.prepare("SELECT billing_payer_identity_id value FROM billing_accounts WHERE id=?").get(accountId)as{value:string}).value,"payer-a");
    db.prepare("UPDATE billing_accounts SET billing_payer_identity_id='payer-unverified' WHERE id=?").run(accountId); assert.equal(resolver.resolveForBillingAccount(accountId),null); db.prepare("UPDATE memberships SET status='suspended' WHERE id='payer-member'").run(); db.prepare("UPDATE billing_accounts SET billing_payer_identity_id='payer-b' WHERE id=?").run(accountId); assert.equal(resolver.resolveForBillingAccount(accountId),null);
    db.prepare("UPDATE memberships SET status='active' WHERE id='payer-member'").run(); db.prepare("DELETE FROM authentication_identities WHERE id='payer-b'").run(); assert.equal((db.prepare("SELECT billing_payer_identity_id value FROM billing_accounts WHERE id=?").get(accountId)as{value:null}).value,null); assert.equal(resolver.resolveForBillingAccount(accountId),null); assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
  } finally { db.close(); }
});

test("EPIC046 BillingPayerIdentityService sets the selected active verified payer identity", () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),initial=accounts.findByWorkspace(workspaceId)!,service=new BillingPayerIdentityService(db,()=>at),resolver=new BillingPayerIdentityResolver(db);
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('payer-set','active','en',?,?)").run(at,at);
    db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES('payer-set-member',?,'payer-set','owner','active',1,?,?)").run(workspaceId,at,at);
    db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES('payer-set-other','payer-set','other@example.test','other@example.test',1,?,?),('payer-set-selected','payer-set','selected@example.test','selected@example.test',1,?,?)").run(at,at,at,at);
    const result=service.setForWorkspace({workspaceId,identityId:"payer-set-selected",expectedVersion:initial.version});
    assert.equal(result.kind,"succeeded"); assert.equal(result.changed,true); if(result.kind!=="succeeded")throw new Error("expected succeeded"); assert.equal(result.account.billingPayerIdentityId,"payer-set-selected"); assert.equal(result.account.version,initial.version+1);
    const resolved=resolver.resolveForBillingAccount(initial.id)!;
    assert.equal(resolved.identityId,"payer-set-selected"); assert.equal(resolved.email,"selected@example.test");
  } finally { db.close(); }
});

test("EPIC046 BillingPayerIdentityService preserves same payer identity without mutation", () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),account=accounts.findByWorkspace(workspaceId)!;
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('payer-noop','active','en',?,?)").run(at,at);
    db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES('payer-noop-member',?,'payer-noop','owner','active',1,?,?)").run(workspaceId,at,at);
    db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES('payer-noop-identity','payer-noop','noop@example.test','noop@example.test',1,?,?)").run(at,at);
    const initial=accounts.setPayerIdentity(account.id,"payer-noop-identity",account.version,at)!;
    const result=new BillingPayerIdentityService(db,()=>"2026-09-02T00:00:00.000Z").setForWorkspace({workspaceId,identityId:"payer-noop-identity",expectedVersion:initial.version});
    assert.equal(result.kind,"succeeded"); assert.equal(result.changed,false); if(result.kind!=="succeeded")throw new Error("expected succeeded"); assert.equal(result.account.billingPayerIdentityId,"payer-noop-identity"); assert.equal(result.account.version,initial.version);
    const persisted=accounts.findById(account.id)!;
    assert.equal(persisted.billingPayerIdentityId,"payer-noop-identity"); assert.equal(persisted.version,initial.version); assert.equal(persisted.updatedAt,initial.updatedAt);
  } finally { db.close(); }
});

test("EPIC046 BillingPayerIdentityService clears the selected payer identity", () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),account=accounts.findByWorkspace(workspaceId)!;
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('payer-clear','active','en',?,?)").run(at,at);
    db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES('payer-clear-member',?,'payer-clear','owner','active',1,?,?)").run(workspaceId,at,at);
    db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES('payer-clear-identity','payer-clear','clear@example.test','clear@example.test',1,?,?)").run(at,at);
    const initial=accounts.setPayerIdentity(account.id,"payer-clear-identity",account.version,at)!;
    const result=new BillingPayerIdentityService(db,()=>at).clearForWorkspace({workspaceId,expectedVersion:initial.version});
    assert.equal(result.kind,"succeeded"); assert.equal(result.changed,true); if(result.kind!=="succeeded")throw new Error("expected succeeded"); assert.equal(result.account.billingPayerIdentityId,null); assert.equal(result.account.version,initial.version+1);
    const persisted=accounts.findById(account.id)!;
    assert.equal(persisted.billingPayerIdentityId,null); assert.equal(persisted.version,initial.version+1); assert.equal(new BillingPayerIdentityResolver(db).resolveForBillingAccount(account.id),null);
  } finally { db.close(); }
});

test("EPIC046 BillingPayerIdentityService maps a stale expected version to conflict", () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),initial=accounts.findByWorkspace(workspaceId)!;
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('payer-stale','active','en',?,?)").run(at,at);
    db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES('payer-stale-member',?,'payer-stale','owner','active',1,?,?)").run(workspaceId,at,at);
    db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES('payer-stale-identity','payer-stale','stale@example.test','stale@example.test',1,?,?)").run(at,at);
    const service=new BillingPayerIdentityService(db,()=>at),set=service.setForWorkspace({workspaceId,identityId:"payer-stale-identity",expectedVersion:initial.version});
    assert.equal(set.kind,"succeeded"); if(set.kind!=="succeeded")throw new Error("expected succeeded"); const stale=service.clearForWorkspace({workspaceId,expectedVersion:initial.version});
    assert.equal(stale.kind,"conflict"); const persisted=accounts.findById(initial.id)!;
    assert.equal(persisted.billingPayerIdentityId,"payer-stale-identity"); assert.equal(persisted.version,initial.version+1);
  } finally { db.close(); }
});

test("EPIC046 BillingPayerIdentityService preserves an already clear payer identity without mutation", () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),initial=accounts.findByWorkspace(workspaceId)!;
    const result=new BillingPayerIdentityService(db,()=>"2026-09-02T00:00:00.000Z").clearForWorkspace({workspaceId,expectedVersion:initial.version});
    assert.equal(result.kind,"succeeded"); assert.equal(result.changed,false); if(result.kind!=="succeeded")throw new Error("expected succeeded"); assert.equal(result.account.billingPayerIdentityId,null); assert.equal(result.account.version,initial.version); assert.equal(result.account.updatedAt,initial.updatedAt);
    assert.deepEqual(accounts.findById(initial.id),initial);
  } finally { db.close(); }
});

test("EPIC046 BillingPayerIdentityService switches to the exact selected payer identity without authority creep", () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),account=accounts.findByWorkspace(workspaceId)!;
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('payer-switch','active','en',?,?)").run(at,at);
    db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES('payer-switch-member',?,'payer-switch','owner','active',1,?,?)").run(workspaceId,at,at);
    db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES('payer-switch-a','payer-switch','a@example.test','a@example.test',1,?,?),('payer-switch-b','payer-switch','b@example.test','b@example.test',1,?,?)").run(at,at,at,at);
    const initial=accounts.setPayerIdentity(account.id,"payer-switch-a",account.version,at)!;
    const authority=()=>Object.freeze({account:db.prepare("SELECT rollout_mode,provider_kind,provider_customer_id FROM billing_accounts WHERE id=?").get(account.id),subscriptionCount:db.prepare("SELECT COUNT(*) count FROM billing_subscriptions WHERE billing_account_id=?").get(account.id),subscription:db.prepare("SELECT id,provider_kind,provider_subscription_id,effective_state,version FROM billing_subscriptions WHERE billing_account_id=? AND is_current=1").get(account.id),snapshotCount:db.prepare("SELECT COUNT(*) count FROM billing_entitlement_snapshots WHERE billing_account_id=?").get(account.id),snapshot:db.prepare("SELECT entitlement_state,mutation_eligible,max_companies,max_assistant_profiles,max_active_channels FROM billing_entitlement_snapshots WHERE billing_account_id=? AND is_current=1").get(account.id),commercial:db.prepare("SELECT status,max_companies,max_assistant_profiles,max_active_channels FROM workspace_commercial_controls WHERE workspace_id=?").get(workspaceId),operationCount:db.prepare("SELECT COUNT(*) count FROM billing_operations WHERE billing_account_id=?").get(account.id)});
    const before=authority(),result=new BillingPayerIdentityService(db,()=>at).setForWorkspace({workspaceId,identityId:"payer-switch-b",expectedVersion:initial.version});
    assert.equal(result.kind,"succeeded"); assert.equal(result.changed,true); if(result.kind!=="succeeded")throw new Error("expected succeeded"); assert.equal(result.account.billingPayerIdentityId,"payer-switch-b"); assert.equal(result.account.version,initial.version+1);
    const resolved=new BillingPayerIdentityResolver(db).resolveForBillingAccount(account.id)!;
    assert.equal(resolved.identityId,"payer-switch-b"); assert.equal(resolved.email,"b@example.test"); assert.notEqual(resolved.identityId,"payer-switch-a"); assert.notEqual(resolved.email,"a@example.test"); assert.deepEqual(authority(),before);
  } finally { db.close(); }
});

test("EPIC046 BillingPayerIdentityService rejects a foreign Workspace identity", () => {
  const db=open(); try {
    const workspaceA=defaultWorkspace(db),workspaces=new WorkspaceRepository(db),workspaceB=workspaces.create({publicId:"wsp_payer_foreign",key:"payer-foreign",name:"Payer Foreign",timezone:null,defaultLocale:null}),accounts=new BillingAccountRepository(db),accountA=accounts.findByWorkspace(workspaceA)!,accountB=accounts.findByWorkspace(workspaceB.id)!;
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('payer-foreign','active','en',?,?)").run(at,at);
    db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES('payer-foreign-member',?,'payer-foreign','owner','active',1,?,?)").run(workspaceB.id,at,at);
    db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES('payer-foreign-identity','payer-foreign','foreign@example.test','foreign@example.test',1,?,?)").run(at,at);
    const result=new BillingPayerIdentityService(db,()=>at).setForWorkspace({workspaceId:workspaceA,identityId:"payer-foreign-identity",expectedVersion:accountA.version});
    assert.equal(result.kind,"invalid"); assert.deepEqual(accounts.findById(accountA.id),accountA); assert.deepEqual(accounts.findById(accountB.id),accountB);
  } finally { db.close(); }
});

test("EPIC046 BillingPayerIdentityService rejects a suspended member identity", () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),initial=accounts.findByWorkspace(workspaceId)!;
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('payer-suspended','active','en',?,?)").run(at,at);
    db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES('payer-suspended-member',?,'payer-suspended','owner','suspended',1,?,?)").run(workspaceId,at,at);
    db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES('payer-suspended-identity','payer-suspended','suspended@example.test','suspended@example.test',1,?,?)").run(at,at);
    assert.equal(new BillingPayerIdentityService(db,()=>at).setForWorkspace({workspaceId,identityId:"payer-suspended-identity",expectedVersion:initial.version}).kind,"invalid"); assert.deepEqual(accounts.findById(initial.id),initial);
  } finally { db.close(); }
});

test("EPIC046 BillingPayerIdentityService rejects an unverified exact identity without fallback", () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),initial=accounts.findByWorkspace(workspaceId)!;
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('payer-unverified','active','en',?,?)").run(at,at);
    db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES('payer-unverified-member',?,'payer-unverified','owner','active',1,?,?)").run(workspaceId,at,at);
    db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES('payer-unverified-verified','payer-unverified','verified@example.test','verified@example.test',1,?,?),('payer-unverified-exact','payer-unverified','unverified@example.test','unverified@example.test',0,?,?)").run(at,at,at,at);
    const result=new BillingPayerIdentityService(db,()=>at).setForWorkspace({workspaceId,identityId:"payer-unverified-exact",expectedVersion:initial.version});
    assert.equal(result.kind,"invalid"); const persisted=accounts.findById(initial.id)!; assert.equal(persisted.billingPayerIdentityId,null); assert.equal(persisted.version,initial.version); assert.notEqual(persisted.billingPayerIdentityId,"payer-unverified-verified");
  } finally { db.close(); }
});

test("EPIC046 BillingPayerIdentityService maps an unknown identity to not found", () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),initial=accounts.findByWorkspace(workspaceId)!;
    assert.equal(new BillingPayerIdentityService(db,()=>at).setForWorkspace({workspaceId,identityId:"payer-unknown-identity",expectedVersion:initial.version}).kind,"not_found"); assert.deepEqual(accounts.findById(initial.id),initial);
  } finally { db.close(); }
});

test("EPIC046 BillingPayerIdentityService maps an unknown Workspace to not found without creating an account", () => {
  const db=open(); try {
    const before=(db.prepare("SELECT COUNT(*) count FROM billing_accounts").get() as {count:number}).count;
    assert.equal(new BillingPayerIdentityService(db,()=>at).clearForWorkspace({workspaceId:999999,expectedVersion:1}).kind,"not_found"); assert.equal((db.prepare("SELECT COUNT(*) count FROM billing_accounts").get() as {count:number}).count,before);
  } finally { db.close(); }
});

test("EPIC046 BillingPayerIdentityService isolates a successful payer selection to its Workspace", () => {
  const db=open(); try {
    const workspaceA=defaultWorkspace(db),workspaceB=new WorkspaceRepository(db).create({publicId:"wsp_payer_isolated",key:"payer-isolated",name:"Payer Isolated",timezone:null,defaultLocale:null}),accounts=new BillingAccountRepository(db),accountA=accounts.findByWorkspace(workspaceA)!,beforeB=accounts.findByWorkspace(workspaceB.id)!;
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('payer-isolated','active','en',?,?)").run(at,at);
    db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES('payer-isolated-member',?,'payer-isolated','owner','active',1,?,?)").run(workspaceA,at,at);
    db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES('payer-isolated-identity','payer-isolated','isolated@example.test','isolated@example.test',1,?,?)").run(at,at);
    assert.equal(new BillingPayerIdentityService(db,()=>at).setForWorkspace({workspaceId:workspaceA,identityId:"payer-isolated-identity",expectedVersion:accountA.version}).kind,"succeeded"); assert.deepEqual(accounts.findById(beforeB.id),beforeB);
  } finally { db.close(); }
});

test("EPIC046 BillingPayerIdentityResolver closes and restores membership lifecycle without fallback or Billing mutations", () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),account=accounts.findByWorkspace(workspaceId)!;
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('payer-membership','active','en',?,?),('payer-membership-other','active','en',?,?)").run(at,at,at,at);
    db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES('payer-membership-member',?,'payer-membership','owner','active',1,?,?),('payer-membership-other-member',?,'payer-membership-other','viewer','active',1,?,?)").run(workspaceId,at,at,workspaceId,at,at);
    db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES('payer-membership-selected','payer-membership','membership@example.test','membership@example.test',1,?,?),('payer-membership-alternate','payer-membership','alternate@example.test','alternate@example.test',1,?,?),('payer-membership-cross','payer-membership-other','cross@example.test','cross@example.test',1,?,?)").run(at,at,at,at,at,at);
    const selected=accounts.setPayerIdentity(account.id,"payer-membership-selected",account.version,at)!,resolver=new BillingPayerIdentityResolver(db),authority=()=>Object.freeze({account:accounts.findById(account.id),subscription:db.prepare("SELECT id,provider_kind,provider_subscription_id,effective_state,version FROM billing_subscriptions WHERE billing_account_id=? AND is_current=1").get(account.id),snapshot:db.prepare("SELECT entitlement_state,mutation_eligible,max_companies,max_assistant_profiles,max_active_channels FROM billing_entitlement_snapshots WHERE billing_account_id=? AND is_current=1").get(account.id),commercial:db.prepare("SELECT status,max_companies,max_assistant_profiles,max_active_channels FROM workspace_commercial_controls WHERE workspace_id=?").get(workspaceId),operationCount:db.prepare("SELECT COUNT(*) count FROM billing_operations WHERE billing_account_id=?").get(account.id)});
    assert.deepEqual(resolver.resolveForBillingAccount(account.id),{identityId:"payer-membership-selected",userId:"payer-membership",email:"membership@example.test"}); const before=authority();
    db.prepare("UPDATE memberships SET status='suspended' WHERE id='payer-membership-member'").run();
    assert.equal(resolver.resolveForBillingAccount(account.id),null); assert.notEqual(resolver.resolveForBillingAccount(account.id)?.identityId,"payer-membership-alternate"); assert.notEqual(resolver.resolveForBillingAccount(account.id)?.identityId,"payer-membership-cross"); assert.deepEqual(authority(),before);
    db.prepare("UPDATE memberships SET status='active' WHERE id='payer-membership-member'").run();
    assert.deepEqual(accounts.findById(account.id),selected); assert.deepEqual(resolver.resolveForBillingAccount(account.id),{identityId:"payer-membership-selected",userId:"payer-membership",email:"membership@example.test"});
  } finally { db.close(); }
});

test("EPIC046 BillingPayerIdentityResolver closes and restores verification lifecycle without fallback", () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),account=accounts.findByWorkspace(workspaceId)!;
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('payer-verification','active','en',?,?)").run(at,at);
    db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES('payer-verification-member',?,'payer-verification','owner','active',1,?,?)").run(workspaceId,at,at);
    db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES('payer-verification-selected','payer-verification','selected-verified@example.test','selected-verified@example.test',1,?,?),('payer-verification-alternate','payer-verification','alternate-verified@example.test','alternate-verified@example.test',1,?,?)").run(at,at,at,at);
    const selected=accounts.setPayerIdentity(account.id,"payer-verification-selected",account.version,at)!,resolver=new BillingPayerIdentityResolver(db);
    assert.equal(resolver.resolveForBillingAccount(account.id)?.identityId,"payer-verification-selected"); db.prepare("UPDATE authentication_identities SET email_verified=0 WHERE id='payer-verification-selected'").run();
    assert.equal(resolver.resolveForBillingAccount(account.id),null); assert.notEqual(resolver.resolveForBillingAccount(account.id)?.identityId,"payer-verification-alternate"); assert.deepEqual(accounts.findById(account.id),selected);
    db.prepare("UPDATE authentication_identities SET email_verified=1 WHERE id='payer-verification-selected'").run();
    assert.deepEqual(resolver.resolveForBillingAccount(account.id),{identityId:"payer-verification-selected",userId:"payer-verification",email:"selected-verified@example.test"});
  } finally { db.close(); }
});

test("EPIC046 BillingPayerIdentityResolver isolates alternate deletion and clears selected identity by FK", () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),account=accounts.findByWorkspace(workspaceId)!;
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('payer-delete','active','en',?,?)").run(at,at);
    db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES('payer-delete-member',?,'payer-delete','owner','active',1,?,?)").run(workspaceId,at,at);
    db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES('payer-delete-selected','payer-delete','delete-selected@example.test','delete-selected@example.test',1,?,?),('payer-delete-alternate','payer-delete','delete-alternate@example.test','delete-alternate@example.test',1,?,?)").run(at,at,at,at);
    const selected=accounts.setPayerIdentity(account.id,"payer-delete-selected",account.version,at)!,resolver=new BillingPayerIdentityResolver(db);
    assert.equal(resolver.resolveForBillingAccount(account.id)?.identityId,"payer-delete-selected"); db.prepare("DELETE FROM authentication_identities WHERE id='payer-delete-alternate'").run();
    assert.deepEqual(accounts.findById(account.id),selected); assert.equal(resolver.resolveForBillingAccount(account.id)?.identityId,"payer-delete-selected");
    db.prepare("DELETE FROM authentication_identities WHERE id='payer-delete-selected'").run();
    assert.equal(accounts.findById(account.id)?.billingPayerIdentityId,null); assert.equal(resolver.resolveForBillingAccount(account.id),null); assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
  } finally { db.close(); }
});

test("EPIC046 BillingPayerIdentityResolver follows selected email changes and rejects invalid email bounds", () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),account=accounts.findByWorkspace(workspaceId)!;
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('payer-email','active','en',?,?)").run(at,at);
    db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES('payer-email-member',?,'payer-email','owner','active',1,?,?)").run(workspaceId,at,at);
    db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES('payer-email-selected','payer-email','old@example.test','old@example.test',1,?,?)").run(at,at);
    const selected=accounts.setPayerIdentity(account.id,"payer-email-selected",account.version,at)!,resolver=new BillingPayerIdentityResolver(db);
    db.prepare("UPDATE authentication_identities SET email='new@example.test',normalized_email='new@example.test' WHERE id='payer-email-selected'").run();
    assert.deepEqual(resolver.resolveForBillingAccount(account.id),{identityId:"payer-email-selected",userId:"payer-email",email:"new@example.test"}); assert.deepEqual(accounts.findById(account.id),selected);
    db.prepare("UPDATE authentication_identities SET email='x',normalized_email='x' WHERE id='payer-email-selected'").run();
    assert.equal(resolver.resolveForBillingAccount(account.id),null); assert.deepEqual(accounts.findById(account.id),selected);
  } finally { db.close(); }
});

test("EPIC046 Billing providers declare explicit Stripe and Mercado Pago capability profiles", () => {
  const stripe=new StripeBillingProvider({secretKey:"sk_test",apiBaseUrl:"https://api.stripe.test",timeoutMs:50,allowedRedirectOrigins:["https://atlas.test"]});
  assert.deepEqual(stripe.capabilities,{subscriptionCheckout:true,requiresPayerEmailForCheckout:false,supportsNativeCancelAtPeriodEnd:true,supportsNativeReactivateCancelAtPeriodEnd:true,supportsCustomerPortal:true,supportsDistinctCheckoutCancelTarget:true,providerCreateIdempotency:"documented"});
  assert.deepEqual(mercadoPagoBillingProviderCapabilities,{subscriptionCheckout:true,requiresPayerEmailForCheckout:true,supportsNativeCancelAtPeriodEnd:false,supportsNativeReactivateCancelAtPeriodEnd:false,supportsCustomerPortal:false,supportsDistinctCheckoutCancelTarget:false,providerCreateIdempotency:"not_documented"});
  assert.deepEqual(new DeterministicFakeBillingProvider({kind:"success",providerObjectId:"mp"},mercadoPagoBillingProviderCapabilities).capabilities,mercadoPagoBillingProviderCapabilities);
});

test("EPIC046 capability-gated checkout sends only the exact resolved payer to Mercado Pago fake", async () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),catalog=new BillingCatalogRepository(db),operations=new BillingOperationRepository(db),account=accounts.findByWorkspace(workspaceId)!,stripe=new DeterministicFakeBillingProvider({kind:"success",providerObjectId:"stripe"}),mp=new DeterministicFakeBillingProvider({kind:"success",providerObjectId:"mp"},mercadoPagoBillingProviderCapabilities),entry=catalog.create(catalogInput({planKey:"capability-mp",providerKind:"mercadopago",providerPriceId:"mp_plan"})),service=new BillingOperationService(accounts,catalog,new BillingSubscriptionRepository(db),operations,new BillingProviderRegistry([{kind:"stripe",provider:stripe},{kind:"mercadopago",provider:mp}]),()=>at,new BillingPayerIdentityResolver(db));
    const input={workspaceId,catalogEntryId:entry.id,operationId:"mp-payer",successTarget:"https://atlas.test/s",cancelTarget:"https://atlas.test/c"};
    assert.equal((await service.checkout(input)).kind,"invalid"); assert.equal(mp.calls.length,0); assert.equal((db.prepare("SELECT COUNT(*) count FROM billing_operations").get()as{count:number}).count,0);
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('payer-capability','active','en',?,?)").run(at,at); db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES('payer-capability-member',?,'payer-capability','owner','active',1,?,?)").run(workspaceId,at,at); db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES('payer-capability-other','payer-capability','other@example.test','other@example.test',1,?,?),('payer-capability-selected','payer-capability','selected@example.test','selected@example.test',1,?,?)").run(at,at,at,at);
    const selected=accounts.setPayerIdentity(account.id,"payer-capability-selected",account.version,at)!;
    assert.equal((await service.checkout(input)).kind,"succeeded"); assert.equal((await service.checkout(input)).kind,"succeeded"); assert.deepEqual(mp.calls,[{kind:"checkout_session_create",idempotencyKey:billingProviderIdempotencyKey(selected.id,"checkout_session_create","mp-payer"),payerEmail:"selected@example.test"}]); assert.equal(operations.find(selected.id,"checkout_session_create","mp-payer")?.providerKind,"mercadopago");
    db.prepare("UPDATE memberships SET status='suspended' WHERE id='payer-capability-member'").run(); const before=(db.prepare("SELECT COUNT(*) count FROM billing_operations").get()as{count:number}).count;
    assert.equal((await service.checkout({...input,operationId:"mp-unusable"})).kind,"invalid"); assert.equal(mp.calls.length,1); assert.equal((db.prepare("SELECT COUNT(*) count FROM billing_operations").get()as{count:number}).count,before);
  } finally { db.close(); }
});

test("EPIC046 checkout capability gates unsupported providers before operations while Stripe permits null payer", async () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),catalog=new BillingCatalogRepository(db),operations=new BillingOperationRepository(db),stripe=new DeterministicFakeBillingProvider({kind:"success",providerObjectId:"stripe"}),unsupported=new DeterministicFakeBillingProvider({kind:"success",providerObjectId:"unsupported"},{...mercadoPagoBillingProviderCapabilities,subscriptionCheckout:false,requiresPayerEmailForCheckout:false}),stripeEntry=catalog.create(catalogInput({planKey:"capability-stripe",providerKind:"stripe",providerPriceId:"stripe_price"})),unsupportedEntry=catalog.create(catalogInput({planKey:"capability-unsupported",providerKind:"mercadopago",providerPriceId:"unsupported_price"})),service=new BillingOperationService(accounts,catalog,new BillingSubscriptionRepository(db),operations,new BillingProviderRegistry([{kind:"stripe",provider:stripe},{kind:"mercadopago",provider:unsupported}]),()=>at,new BillingPayerIdentityResolver(db));
    assert.equal((await service.checkout({workspaceId,catalogEntryId:unsupportedEntry.id,operationId:"unsupported-checkout",successTarget:"https://atlas.test/s",cancelTarget:"https://atlas.test/c"})).kind,"unsupported"); assert.equal(unsupported.calls.length,0); assert.equal((db.prepare("SELECT COUNT(*) count FROM billing_operations").get()as{count:number}).count,0);
    assert.equal((await service.checkout({workspaceId,catalogEntryId:stripeEntry.id,operationId:"stripe-null-payer",successTarget:"https://atlas.test/s",cancelTarget:"https://atlas.test/c"})).kind,"succeeded"); assert.equal(stripe.calls.length,1); assert.equal(stripe.calls[0]?.payerEmail,undefined); assert.equal(operations.find(accounts.findByWorkspace(workspaceId)!.id,"checkout_session_create","stripe-null-payer")?.providerKind,"stripe");
  } finally { db.close(); }
});

test("EPIC046 capability-gated subscription mutations and portal never dispatch unsupported Mercado Pago fake", async () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),subscriptions=new BillingSubscriptionRepository(db),operations=new BillingOperationRepository(db),account=accounts.findByWorkspace(workspaceId)!,stripe=new DeterministicFakeBillingProvider({kind:"success",providerObjectId:"stripe",redirectUrl:"https://atlas.test/portal"}),mp=new DeterministicFakeBillingProvider({kind:"success",providerObjectId:"mp"},mercadoPagoBillingProviderCapabilities),service=new BillingOperationService(accounts,new BillingCatalogRepository(db),subscriptions,operations,new BillingProviderRegistry([{kind:"stripe",provider:stripe},{kind:"mercadopago",provider:mp}]),()=>at,new BillingPayerIdentityResolver(db));
    db.prepare("UPDATE billing_accounts SET rollout_mode='managed',provider_kind='mercadopago',provider_customer_id='mp_customer' WHERE id=?").run(account.id); db.prepare("UPDATE billing_subscriptions SET provider_kind='mercadopago',provider_subscription_id='mp_subscription',effective_state='active' WHERE billing_account_id=?").run(account.id); let sub=subscriptions.current(account.id)!,before=db.prepare("SELECT * FROM billing_subscriptions WHERE id=?").get(sub.id);
    assert.equal((await service.cancelAtPeriodEnd({workspaceId,subscriptionId:sub.id,operationId:"mp-cancel"})).kind,"unsupported"); assert.equal(mp.calls.length,0); assert.deepEqual(db.prepare("SELECT * FROM billing_subscriptions WHERE id=?").get(sub.id),before); assert.equal((db.prepare("SELECT COUNT(*) count FROM billing_operations").get()as{count:number}).count,0);
    db.prepare("UPDATE billing_subscriptions SET effective_state='canceling_at_period_end' WHERE id=?").run(sub.id); before=db.prepare("SELECT * FROM billing_subscriptions WHERE id=?").get(sub.id); assert.equal((await service.reactivate({workspaceId,subscriptionId:sub.id,operationId:"mp-reactivate"})).kind,"unsupported"); assert.equal((await service.portal({workspaceId,returnTarget:"https://atlas.test/r"})).kind,"unsupported"); assert.equal(mp.calls.length,0); assert.deepEqual(db.prepare("SELECT * FROM billing_subscriptions WHERE id=?").get(sub.id),before);
    db.prepare("UPDATE billing_accounts SET provider_kind='stripe',provider_customer_id='stripe_customer' WHERE id=?").run(account.id); db.prepare("UPDATE billing_subscriptions SET provider_kind='stripe',provider_subscription_id='stripe_subscription',effective_state='active' WHERE id=?").run(sub.id); assert.equal((await service.cancelAtPeriodEnd({workspaceId,subscriptionId:sub.id,operationId:"stripe-cancel"})).kind,"succeeded"); db.prepare("UPDATE billing_subscriptions SET effective_state='canceling_at_period_end' WHERE id=?").run(sub.id); assert.equal((await service.reactivate({workspaceId,subscriptionId:sub.id,operationId:"stripe-reactivate"})).kind,"succeeded"); assert.equal((await service.portal({workspaceId,returnTarget:"https://atlas.test/r"})).kind,"succeeded"); assert.deepEqual(stripe.calls.map(call=>call.kind),["subscription_cancel_at_period_end","subscription_reactivate","portal"]);
  } finally { db.close(); }
});

test("EPIC046 routes trusted catalog providers through the injected registry without fallback", async () => {
  const db=open();try{const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),catalog=new BillingCatalogRepository(db),account=accounts.findByWorkspace(workspaceId)!,stripe=new DeterministicFakeBillingProvider({kind:"success",providerObjectId:"stripe"}),mp=new DeterministicFakeBillingProvider({kind:"success",providerObjectId:"mp"}),registry=new BillingProviderRegistry([{kind:"stripe",provider:stripe},{kind:"mercadopago",provider:mp}]),service=new BillingOperationService(accounts,catalog,new BillingSubscriptionRepository(db),new BillingOperationRepository(db),registry,()=>at),stripeEntry=catalog.create(catalogInput({planKey:"stripe-route",catalogVersion:1,providerKind:"stripe",providerPriceId:"price_stripe"})),mpEntry=catalog.create(catalogInput({planKey:"mp-route",catalogVersion:1,providerKind:"mercadopago",providerPriceId:"price_mp"})); assert.equal((await service.checkout({workspaceId,catalogEntryId:stripeEntry.id,operationId:"stripe-route",successTarget:"https://atlas.test/s",cancelTarget:"https://atlas.test/c"})).kind,"succeeded");assert.equal(stripe.calls.length,1);assert.equal(mp.calls.length,0);assert.equal((await service.checkout({workspaceId,catalogEntryId:mpEntry.id,operationId:"mp-route",successTarget:"https://atlas.test/s",cancelTarget:"https://atlas.test/c"})).kind,"conflict");assert.equal(stripe.calls.length,1);assert.equal(mp.calls.length,0);assert.throws(()=>new BillingProviderRegistry([{kind:"stripe",provider:stripe},{kind:"stripe",provider:mp}]));assert.equal(new BillingProviderRegistry([{kind:"stripe",provider:stripe}]).has("mercadopago"),false);assert.equal(account.providerKind,null);}finally{db.close();}
});

test("EPIC046 rejects a checkout provider switch for one durable operation", async () => {
  const db=open();
  try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),catalog=new BillingCatalogRepository(db),subscriptions=new BillingSubscriptionRepository(db),operations=new BillingOperationRepository(db),account=accounts.findByWorkspace(workspaceId)!;
    const stripe=new DeterministicFakeBillingProvider({kind:"success",providerObjectId:"stripe"}),mp=new DeterministicFakeBillingProvider({kind:"success",providerObjectId:"mp"});
    const service=new BillingOperationService(accounts,catalog,subscriptions,operations,new BillingProviderRegistry([{kind:"stripe",provider:stripe},{kind:"mercadopago",provider:mp}]),()=>at);
    const stripeEntry=catalog.create(catalogInput({planKey:"switch-stripe",catalogVersion:1,providerKind:"stripe",providerPriceId:"stripe_price_test"}));
    const mpEntry=catalog.create(catalogInput({planKey:"switch-mp",catalogVersion:1,providerKind:"mercadopago",providerPriceId:"mp_plan_test"}));
    const input={workspaceId,operationId:"provider-switch",successTarget:"https://atlas.test/s",cancelTarget:"https://atlas.test/c"};
    assert.equal((await service.checkout({...input,catalogEntryId:stripeEntry.id})).kind,"succeeded");
    const original=operations.find(account.id,"checkout_session_create",input.operationId)!;
    assert.equal(original.providerKind,"stripe"); assert.equal(stripe.calls.length,1); assert.equal(mp.calls.length,0);
    assert.equal((await service.checkout({...input,catalogEntryId:mpEntry.id})).kind,"conflict");
    const after=operations.find(account.id,"checkout_session_create",input.operationId)!;
    assert.equal(stripe.calls.length,1); assert.equal(mp.calls.length,0); assert.equal(after.providerKind,"stripe"); assert.equal(after.fingerprint,original.fingerprint); assert.equal(after.status,original.status); assert.equal(after.safeResultJson,original.safeResultJson);
    assert.equal((db.prepare("SELECT COUNT(*) count FROM billing_operations WHERE billing_account_id=? AND operation_kind='checkout_session_create' AND operation_id=?").get(account.id,input.operationId) as {count:number}).count,1);
  } finally { db.close(); }
});

test("EPIC046 routes subscription mutations by durable provider without fallback", async () => {
  const db=open();try{const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),catalog=new BillingCatalogRepository(db),subscriptions=new BillingSubscriptionRepository(db),operations=new BillingOperationRepository(db),account=accounts.findByWorkspace(workspaceId)!,stripe=new DeterministicFakeBillingProvider({kind:"success",providerObjectId:"stripe"}),mp=new DeterministicFakeBillingProvider({kind:"success",providerObjectId:"mp"}),registry=new BillingProviderRegistry([{kind:"stripe",provider:stripe},{kind:"mercadopago",provider:mp}]),service=new BillingOperationService(accounts,catalog,subscriptions,operations,registry,()=>at); const set=(kind:"stripe"|"mercadopago",state:string,reference:string)=>db.prepare("UPDATE billing_subscriptions SET provider_kind=?,provider_subscription_id=?,effective_state=?,cancel_at_period_end=?,version=version+1 WHERE billing_account_id=?").run(kind,reference,state,state==="canceling_at_period_end"?1:0,account.id); set("stripe","active","stripe_sub");let sub=subscriptions.current(account.id)!;assert.equal((await service.cancelAtPeriodEnd({workspaceId,subscriptionId:sub.id,operationId:"cancel-stripe"})).kind,"succeeded");assert.equal(stripe.calls.length,1);assert.equal(mp.calls.length,0);assert.equal(operations.find(account.id,"subscription_cancel_at_period_end","cancel-stripe")!.providerKind,"stripe");set("mercadopago","active","mp_preapproval");sub=subscriptions.current(account.id)!;assert.equal((await service.cancelAtPeriodEnd({workspaceId,subscriptionId:sub.id,operationId:"cancel-mp"})).kind,"succeeded");assert.equal(stripe.calls.length,1);assert.equal(mp.calls.length,1);assert.equal(operations.find(account.id,"subscription_cancel_at_period_end","cancel-mp")!.providerKind,"mercadopago");set("stripe","canceling_at_period_end","stripe_reactivate");sub=subscriptions.current(account.id)!;await service.reactivate({workspaceId,subscriptionId:sub.id,operationId:"reactivate-stripe"});assert.equal(stripe.calls.length,2);set("mercadopago","canceling_at_period_end","mp_reactivate");sub=subscriptions.current(account.id)!;await service.reactivate({workspaceId,subscriptionId:sub.id,operationId:"reactivate-mp"});assert.equal(mp.calls.length,2); const unavailable=new BillingOperationService(accounts,catalog,subscriptions,operations,new BillingProviderRegistry([{kind:"stripe",provider:stripe}]),()=>at);assert.equal((await unavailable.reactivate({workspaceId,subscriptionId:sub.id,operationId:"unavailable"})).kind,"unavailable");assert.equal(operations.find(account.id,"subscription_reactivate","unavailable"),null);db.prepare("UPDATE billing_accounts SET rollout_mode='managed',provider_kind='stripe',provider_customer_id='cus_test',version=version+1 WHERE id=?").run(account.id);assert.equal((await service.reactivate({workspaceId,subscriptionId:sub.id,operationId:"mismatch"})).kind,"invalid");assert.equal(mp.calls.length,2);}finally{db.close();}
});

test("EPIC046 migrates fresh and staged file-backed databases, backfills unmanaged accounts, and restarts", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic046-migration-")), path = join(directory, "atlas.sqlite");
  let db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA foreign_keys=ON"); runMigrations(db, 65);
    const suspended = defaultWorkspace(db);
    db.prepare("INSERT INTO workspaces(key,name,public_id,created_at) VALUES('legacy','Legacy','wsp_legacy',?)").run(at);
    db.prepare("UPDATE workspace_commercial_controls SET status='suspended',suspended_at=?,updated_at=? WHERE workspace_id=?").run(at, at, suspended);
    runMigrations(db, 66); runMigrations(db, 67); runMigrations(db, 68);
    assert.equal((db.prepare("SELECT COUNT(*) count FROM billing_accounts").get() as {count:number}).count, 2);
    assert.equal((db.prepare("SELECT COUNT(*) count FROM billing_subscriptions WHERE effective_state='unmanaged'").get() as {count:number}).count, 2);
    const snapshot = db.prepare("SELECT entitlement_state,max_companies,max_assistant_profiles,max_active_channels,mutation_eligible FROM billing_entitlement_snapshots s JOIN billing_accounts a ON a.id=s.billing_account_id WHERE a.workspace_id=?").get(suspended) as {entitlement_state:string;max_companies:null;max_assistant_profiles:null;max_active_channels:null;mutation_eligible:number};
    assert.deepEqual({...snapshot}, {entitlement_state:"enabled",max_companies:null,max_assistant_profiles:null,max_active_channels:null,mutation_eligible:1});
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.close(); db = new DatabaseSync(path); db.exec("PRAGMA foreign_keys=ON"); runMigrations(db);
    const head = db.prepare("SELECT id,name FROM schema_migrations ORDER BY id DESC LIMIT 1").get() as {id:number;name:string};
    assert.equal(head.id, 74); assert.equal(head.name, "0074_billing_versioned_plan_provider_commercial_offers");
  } finally { if (db.isOpen) db.close(); rmSync(directory, {recursive:true, force:true}); }
});

test("EPIC046 creates future Workspace defaults without lazy reads", () => {
  const db = open();
  try {
    const workspace = new WorkspaceRepository(db).create({publicId:"wsp_future",key:"future",name:"Future",timezone:null,defaultLocale:null});
    const account = new BillingAccountRepository(db).findByWorkspace(workspace.id)!;
    const snapshot = new BillingEntitlementSnapshotRepository(db).current(account.id)!;
    assert.equal(account.rolloutMode, "unmanaged"); assert.equal(account.providerKind, null);
    assert.deepEqual([snapshot.state, snapshot.maxCompanies, snapshot.maxAssistantProfiles, snapshot.maxActiveChannels], ["enabled", null, null, null]);
    assert.equal(new CommercialControlsRepository(db).workspace(workspace.id)?.status, "active");
    db.prepare("DELETE FROM billing_entitlement_snapshots WHERE id=?").run(snapshot.id);
    assert.equal(new BillingEntitlementSnapshotRepository(db).current(account.id), null);
  } finally { db.close(); }
});

test("EPIC046 keeps unmanaged Billing neutral while commercial controls mutate independently", () => {
  const db = open();
  try {
    const workspace = defaultWorkspace(db), accounts = new BillingAccountRepository(db), snapshots = new BillingEntitlementSnapshotRepository(db), account = accounts.findByWorkspace(workspace)!;
    const before = snapshots.current(account.id)!;
    db.prepare("UPDATE workspace_commercial_controls SET status='suspended',suspended_at=?,max_companies=2,max_assistant_profiles=3,max_active_channels=4,version=version+1,updated_at=? WHERE workspace_id=?").run(at, at, workspace);
    const suspended = new CommercialControlsRepository(db).workspace(workspace)!;
    const during = snapshots.current(account.id)!;
    assert.deepEqual(during, before);
    assert.deepEqual([suspended.status,suspended.maxCompanies,suspended.maxAssistantProfiles,suspended.maxActiveChannels], ["suspended",2,3,4]);
    const authorities = snapshots.authorities(workspace, suspended)!;
    assert.deepEqual([authorities.account.rolloutMode,authorities.subscription.effectiveState,authorities.billing.state,authorities.billing.maxCompanies,authorities.billing.mutationEligible], ["unmanaged","unmanaged","enabled",null,true]);
    assert.equal(authorities.commercial?.status, "suspended");
    db.prepare("UPDATE workspace_commercial_controls SET status='active',suspended_at=NULL,max_companies=7,max_assistant_profiles=NULL,max_active_channels=NULL,version=version+1,updated_at=? WHERE workspace_id=?").run(at, workspace);
    assert.deepEqual(snapshots.current(account.id), before);
  } finally { db.close(); }
});

test("EPIC046 protects historical catalog values and validates closed domain states", () => {
  const db = open();
  try {
    const catalog = new BillingCatalogRepository(db), entry = catalog.create(catalogInput({providerKind:"stripe",providerPriceId:"price_a"}) as never);
    assert.throws(() => db.prepare("UPDATE billing_catalog_entries SET amount_minor=1 WHERE id=?").run(entry.id));
    assert.equal(catalog.retire(entry.id), true);
    assert.equal(catalog.create(catalogInput({catalogVersion:2,amountMinor:1}) as never).catalogVersion, 2);
    assert.throws(() => catalog.create(catalogInput() as never));
    assert.throws(() => catalog.create(catalogInput({planKey:"other",providerKind:"stripe",providerPriceId:"price_a"}) as never));
    for (const value of ["unmanaged","managed"]) assert.equal(rolloutMode(value), value);
    for (const value of ["checkout_pending","trialing","active","past_due","paused","canceled","unpaid","incomplete","incomplete_expired","unknown"]) assert.equal(providerEvidenceState(value), value);
    for (const value of ["unmanaged","trial","active","canceling_at_period_end","grace","paused","payment_required","canceled","reconciliation_required"]) assert.equal(effectiveSubscriptionState(value), value);
    for (const value of ["enabled","grace_enabled","restricted","suspended","unavailable"]) assert.equal(entitlementState(value), value);
    assert.throws(() => rolloutMode("typo")); assert.throws(() => billingInterval("week")); assert.throws(() => currencyCode("usd")); assert.throws(() => amountMinor(1.5));
  } finally { db.close(); }
});

test("EPIC046 uses two SQLite connections for uniqueness and CAS", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic046-race-")), path = join(directory, "atlas.sqlite"), first = open(path), second = open(path);
  try {
    const workspace = defaultWorkspace(first), accountsA = new BillingAccountRepository(first), accountsB = new BillingAccountRepository(second), account = accountsA.findByWorkspace(workspace)!;
    assert.throws(() => accountsA.createUnmanaged(workspace, at)); assert.throws(() => accountsB.createUnmanaged(workspace, at));
    new BillingCatalogRepository(first).create(catalogInput() as never); assert.throws(() => new BillingCatalogRepository(second).create(catalogInput() as never));
    const subscriptionsA = new BillingSubscriptionRepository(first), subscriptionsB = new BillingSubscriptionRepository(second), current = subscriptionsA.current(account.id)!;
    assert.ok(subscriptionsA.compareAndSetState(account.id, current.version, "reconciliation_required", at));
    assert.equal(subscriptionsB.compareAndSetState(account.id, current.version, "reconciliation_required", at), null);
    assert.throws(() => first.prepare("INSERT INTO billing_subscriptions(id,billing_account_id,effective_state,is_current,version) VALUES('bsub_second',?,'unmanaged',1,1)").run(account.id));
    const commercial = new CommercialControlsRepository(first).workspace(workspace)!;
    assert.ok(new BillingEntitlementSnapshotRepository(first).authorities(workspace, commercial));
    assert.ok(accountsA.markManaged(workspace, "stripe", "cus_a", account.version, at));
    assert.throws(() => first.prepare("DELETE FROM workspaces WHERE id=?").run(workspace));
    assert.deepEqual(first.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { first.close(); second.close(); rmSync(directory, {recursive:true, force:true}); }
});

test("EPIC046 Billing-aware restore and activation triggers preserve legacy capacity transitions", () => {
  const db = open();
  try {
    const workspace = defaultWorkspace(db), at = "2026-09-01T00:00:00.000Z";
    const company = (name:string,state:string="operational") => { db.prepare("INSERT INTO companies(workspace_id,name,website,phone,email,status,slug,name_normalized,lifecycle_state,brand_colors_json,version,created_at,updated_at,lifecycle_changed_at,archived_at) VALUES(?,?,?,?,?,'ready',?,?,?,'{}',1,?,?,?,?)").run(workspace,name,`https://${name}.test`,"","",name,name,state,at,at,at,state==="archived"?at:null); return Number((db.prepare("SELECT last_insert_rowid() id").get() as {id:number}).id); };
    const live = company("live"), archived = company("archived","archived");
    db.prepare("UPDATE workspace_commercial_controls SET max_companies=1 WHERE workspace_id=?").run(workspace);
    assert.throws(() => db.prepare("UPDATE companies SET lifecycle_state='operational',archived_at=NULL WHERE id=?").run(archived));
    db.prepare("UPDATE companies SET lifecycle_state='archived',archived_at=? WHERE id=?").run(at,live);
    assert.equal(db.prepare("UPDATE companies SET lifecycle_state='operational',archived_at=NULL WHERE id=?").run(archived).changes,1);
    const profile = "apr_restore", archivedProfile = "apr_archived";
    db.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,'profile','friendly','en','Fallback','ready',?,?,NULL)").run(profile,archived,"Profile",at,at);
    db.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,'archived-profile','friendly','en','Fallback','archived',?,?,?)").run(archivedProfile,archived,"Archived",at,at,at);
    db.prepare("UPDATE workspace_commercial_controls SET max_assistant_profiles=1 WHERE workspace_id=?").run(workspace);
    assert.throws(() => db.prepare("UPDATE assistant_profiles SET status='ready',archived_at=NULL WHERE id=?").run(archivedProfile));
    db.prepare("UPDATE assistant_profiles SET status='archived',archived_at=? WHERE id=?").run(at,profile);
    assert.equal(db.prepare("UPDATE assistant_profiles SET status='ready',archived_at=NULL WHERE id=?").run(archivedProfile).changes,1);
    const web = "wcc_restore", whats = "wac_restore";
    db.prepare("INSERT INTO web_chat_connections(id,public_id,workspace_id,company_id,assistant_profile_id,status,created_at,updated_at) VALUES(?,?,?,?,?,'inactive',?,?)").run(web,"pub_restore",workspace,archived,archivedProfile,at,at);
    db.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'active',?,?)").run(whats,workspace,archived,archivedProfile,"phone_restore","waba_restore",at,at);
    db.prepare("UPDATE workspace_commercial_controls SET max_active_channels=1 WHERE workspace_id=?").run(workspace);
    assert.throws(() => db.prepare("UPDATE web_chat_connections SET status='active' WHERE id=?").run(web));
    db.prepare("UPDATE whatsapp_connections SET status='inactive' WHERE id=?").run(whats);
    assert.equal(db.prepare("UPDATE web_chat_connections SET status='active' WHERE id=?").run(web).changes,1);
  } finally { db.close(); }
});

test("EPIC046 replaces the complete commercial capacity trigger inventory", () => {
  const directory=mkdtempSync(join(tmpdir(),"atlas-epic046-trigger-")),path=join(directory,"atlas.sqlite");let db=new DatabaseSync(path);
  const names=["billing_company_limit","billing_company_restore_limit","billing_profile_limit","billing_profile_restore_limit","billing_web_chat_limit","billing_web_chat_active_limit_update","billing_whatsapp_limit","billing_whatsapp_active_limit_update"];
  const legacy=["commercial_company_limit","commercial_company_restore_limit","commercial_profile_limit","commercial_profile_restore_limit","commercial_web_chat_active_limit_insert","commercial_web_chat_active_limit_update","commercial_whatsapp_active_limit_insert","commercial_whatsapp_active_limit_update"];
  try { db.exec("PRAGMA foreign_keys=ON");runMigrations(db);const actual=(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN (?,?,?,?,?,?,?,?)").all(...names)as Array<{name:string}>).map(row=>row.name).sort();assert.deepEqual(actual,[...names].sort());assert.equal((db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='trigger' AND name IN (?,?,?,?,?,?,?,?)").get(...legacy)as{count:number}).count,0);assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);db.close();db=new DatabaseSync(path);db.exec("PRAGMA foreign_keys=ON");runMigrations(db);assert.equal((db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='trigger' AND name IN (?,?,?,?,?,?,?,?)").get(...names)as{count:number}).count,8);}finally{if(db.isOpen)db.close();rmSync(directory,{recursive:true,force:true});}
});

test("EPIC046 active Web Chat consumes the shared slot before WhatsApp activation", () => {
  const db=open();
  try {
    const workspace=defaultWorkspace(db),at="2026-09-01T00:00:00.000Z";
    db.prepare("INSERT INTO companies(workspace_id,name,website,phone,email,status,slug,name_normalized,lifecycle_state,brand_colors_json,version,created_at,updated_at,lifecycle_changed_at) VALUES(?,?,?,?,?,'ready','channel','channel','operational','{}',1,?,?,?)").run(workspace,"Channel","https://channel.test","","",at,at,at);
    const company=Number((db.prepare("SELECT last_insert_rowid() id").get()as{id:number}).id),profile="apr_channel";
    db.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at) VALUES(?,?,?,'channel','friendly','en','Fallback','ready',?,?)").run(profile,company,"Channel",at,at);
    db.prepare("INSERT INTO web_chat_connections(id,public_id,workspace_id,company_id,assistant_profile_id,status,created_at,updated_at) VALUES('wcc_channel','pub_channel',?,?,?,'active',?,?)").run(workspace,company,profile,at,at);
    db.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES('wac_channel',?,?,?,'phone_channel','waba_channel','inactive',?,?)").run(workspace,company,profile,at,at);
    db.prepare("UPDATE workspace_commercial_controls SET max_active_channels=1 WHERE workspace_id=?").run(workspace);
    assert.throws(()=>db.prepare("UPDATE whatsapp_connections SET status='active' WHERE id='wac_channel'").run());
    assert.equal((db.prepare("SELECT status FROM whatsapp_connections WHERE id='wac_channel'").get()as{status:string}).status,"inactive");
    assert.equal((db.prepare("SELECT COUNT(*) count FROM web_chat_connections WHERE workspace_id=? AND status='active'").get(workspace)as{count:number}).count,1);
    db.prepare("UPDATE web_chat_connections SET status='inactive' WHERE id='wcc_channel'").run();
    assert.equal(db.prepare("UPDATE whatsapp_connections SET status='active' WHERE id='wac_channel'").run().changes,1);
    assert.equal((db.prepare("SELECT (SELECT COUNT(*) FROM web_chat_connections WHERE workspace_id=? AND status='active')+(SELECT COUNT(*) FROM whatsapp_connections WHERE workspace_id=? AND status='active') count").get(workspace,workspace)as{count:number}).count,1);
  } finally { db.close(); }
});

test("EPIC046 entitlement service applies neutral, managed-state, limit, and missing-snapshot decisions", () => {
  const db=open();
  try {
    const workspace=defaultWorkspace(db),service=new BillingEntitlementService(db),account=(db.prepare("SELECT id FROM billing_accounts WHERE workspace_id=?").get(workspace)as{id:string}).id,snapshot=(db.prepare("SELECT id FROM billing_entitlement_snapshots WHERE billing_account_id=? AND is_current=1").get(account)as{id:string}).id;
    assert.equal(service.mayCreateCompany(workspace).safeReason,"allowed");
    assert.throws(()=>db.prepare("UPDATE workspace_commercial_controls SET max_companies=0 WHERE workspace_id=?").run(workspace));
    db.prepare("UPDATE workspace_commercial_controls SET max_companies=NULL,status='suspended',suspended_at=? WHERE workspace_id=?").run("2026-09-01T00:00:00.000Z",workspace);
    assert.equal(service.mayCreateCompany(workspace).safeReason,"administrative_suspended");
    db.prepare("UPDATE workspace_commercial_controls SET status='active',suspended_at=NULL WHERE workspace_id=?").run(workspace);
    db.prepare("UPDATE billing_entitlement_snapshots SET entitlement_state='grace_enabled',max_companies=2 WHERE id=?").run(snapshot);
    assert.deepEqual([service.mayCreateCompany(workspace).allowed,service.mayCreateCompany(workspace).effectiveLimit],[true,2]);
    db.prepare("UPDATE billing_entitlement_snapshots SET max_companies=0,max_assistant_profiles=0,max_active_channels=0 WHERE id=?").run(snapshot);
    assert.deepEqual([service.mayCreateCompany(workspace).allowed,service.mayCreateCompany(workspace).effectiveLimit],[false,0]);
    for(const state of ["restricted","suspended","unavailable"]){db.prepare("UPDATE billing_entitlement_snapshots SET entitlement_state=? WHERE id=?").run(state,snapshot);assert.equal(service.mayCreateCompany(workspace).safeReason,"billing_restricted");}
    db.prepare("UPDATE billing_entitlement_snapshots SET entitlement_state='enabled',mutation_eligible=0 WHERE id=?").run(snapshot);
    assert.equal(service.mayCreateCompany(workspace).safeReason,"billing_mutation_ineligible");
    db.prepare("DELETE FROM billing_entitlement_snapshots WHERE id=?").run(snapshot);
    assert.equal(service.mayCreateCompany(workspace).safeReason,"billing_entitlement_unavailable");
  } finally {db.close();}
});

test("EPIC046 zero Billing ceilings deny Company, Profile, Web Chat, and WhatsApp capacity", () => {
  const db=open();
  try {
    const workspace=defaultWorkspace(db),at="2026-09-01T00:00:00.000Z",account=(db.prepare("SELECT id FROM billing_accounts WHERE workspace_id=?").get(workspace)as{id:string}).id,snapshot=(db.prepare("SELECT id FROM billing_entitlement_snapshots WHERE billing_account_id=?").get(account)as{id:string}).id;
    db.prepare("INSERT INTO companies(workspace_id,name,website,phone,email,status,slug,name_normalized,lifecycle_state,brand_colors_json,version,created_at,updated_at,lifecycle_changed_at) VALUES(?,?,?,?,?,'ready','zero','zero','operational','{}',1,?,?,?)").run(workspace,"Zero","https://zero.test","","",at,at,at);
    const company=Number((db.prepare("SELECT last_insert_rowid() id").get()as{id:number}).id),profile="apr_zero";
    db.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at) VALUES(?,?,?,'zero','friendly','en','Fallback','ready',?,?)").run(profile,company,"Zero",at,at);
    db.prepare("UPDATE billing_entitlement_snapshots SET max_companies=0,max_assistant_profiles=0,max_active_channels=0 WHERE id=?").run(snapshot);
    assert.throws(()=>db.prepare("INSERT INTO companies(workspace_id,name,website,phone,email,status,slug,name_normalized,lifecycle_state,brand_colors_json,version,created_at,updated_at,lifecycle_changed_at) VALUES(?,?,?,?,?,'ready','zero-next','zero-next','operational','{}',1,?,?,?)").run(workspace,"Next","https://next.test","","",at,at,at));
    assert.throws(()=>db.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at) VALUES('apr_zero_next',?,'Next','next','friendly','en','Fallback','ready',?,?)").run(company,at,at));
    assert.throws(()=>db.prepare("INSERT INTO web_chat_connections(id,public_id,workspace_id,company_id,assistant_profile_id,status,created_at,updated_at) VALUES('wcc_zero','pub_zero',?,?,?,'active',?,?)").run(workspace,company,profile,at,at));
    assert.throws(()=>db.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES('wac_zero',?,?,?,'phone_zero','waba_zero','active',?,?)").run(workspace,company,profile,at,at));
  } finally {db.close();}
});

test("EPIC046 entitlement service isolates Workspace authorities and evaluates limit boundaries", () => {
  const db=open();
  try {
    const a=defaultWorkspace(db),b=new WorkspaceRepository(db).create({publicId:"wsp_isolated",key:"isolated",name:"Isolated",timezone:null,defaultLocale:null}).id,service=new BillingEntitlementService(db),at="2026-09-01T00:00:00.000Z";
    const company=(workspace:number,name:string)=>db.prepare("INSERT INTO companies(workspace_id,name,website,phone,email,status,slug,name_normalized,lifecycle_state,brand_colors_json,version,created_at,updated_at,lifecycle_changed_at) VALUES(?,?,?,?,?,'ready',?,?, 'operational','{}',1,?,?,?)").run(workspace,name,`https://${name}.test`,"","",name,name,at,at,at);
    company(a,"a");
    const accountA=(db.prepare("SELECT id FROM billing_accounts WHERE workspace_id=?").get(a)as{id:string}).id,snapshotA=(db.prepare("SELECT id FROM billing_entitlement_snapshots WHERE billing_account_id=?").get(accountA)as{id:string}).id;
    db.prepare("UPDATE billing_entitlement_snapshots SET max_companies=1 WHERE id=?").run(snapshotA);
    assert.equal(service.mayCreateCompany(a).allowed,false);assert.equal(service.mayCreateCompany(b).allowed,true);
    db.prepare("UPDATE workspace_commercial_controls SET max_companies=1 WHERE workspace_id=?").run(b);
    assert.equal(service.mayCreateCompany(a).allowed,false);assert.equal(service.mayCreateCompany(b).allowed,true);
    db.prepare("UPDATE billing_entitlement_snapshots SET max_companies=NULL,max_assistant_profiles=1,max_active_channels=1 WHERE id=?").run(snapshotA);
    assert.equal(service.mayCreateCompany(a).allowed,true);assert.equal(service.mayCreateAssistantProfile(a).effectiveLimit,1);assert.equal(service.mayActivateChannel(a).effectiveLimit,1);
    const cases:Array<[number|null,number|null,number|null]>=[[null,null,null],[5,null,5],[null,5,5],[10,4,4],[2,10,2],[0,null,0],[0,5,0]];
    for(const [billing,admin,effective] of cases){db.prepare("UPDATE billing_entitlement_snapshots SET max_companies=? WHERE id=?").run(billing,snapshotA);db.prepare("UPDATE workspace_commercial_controls SET max_companies=? WHERE workspace_id=?").run(admin,a);assert.equal(service.mayCreateCompany(a).effectiveLimit,effective);}
    db.prepare("UPDATE billing_entitlement_snapshots SET max_companies=0 WHERE id=?").run(snapshotA);assert.equal(service.mayCreateCompany(a).allowed,false);
    db.prepare("UPDATE billing_entitlement_snapshots SET max_companies=NULL WHERE id=?").run(snapshotA);db.prepare("UPDATE workspace_commercial_controls SET max_companies=NULL WHERE workspace_id=?").run(a);for(const name of ["a2","a3","a4","a5"]){company(a,name);}db.prepare("UPDATE billing_entitlement_snapshots SET max_companies=3 WHERE id=?").run(snapshotA);assert.equal(service.mayCreateCompany(a).allowed,false);db.prepare("DELETE FROM companies WHERE workspace_id=? AND name IN ('a2','a3','a4')").run(a);assert.equal(service.mayCreateCompany(a).allowed,true);
  } finally {db.close();}
});

test("EPIC046 operational preflight denies before writes and leaves SQLite triggers as fallback", () => {
  const db = open();
  try {
    const workspace = defaultWorkspace(db), context = { workspaceId: workspace, workspaceKey: "default" }, clock = { now: () => at }, entitlements = new BillingEntitlementService(db), companies = new CompanyRepository(db);
    db.prepare("UPDATE billing_entitlement_snapshots SET max_companies=0,max_assistant_profiles=0,max_active_channels=0 WHERE billing_account_id=(SELECT id FROM billing_accounts WHERE workspace_id=? AND rollout_mode='unmanaged')").run(workspace);
    assert.throws(() => new CompanyService(companies, entitlements).create(context, { name: "Denied", website: "https://denied.test" }), CompanyCapacityError);
    assert.equal((db.prepare("SELECT COUNT(*) count FROM companies WHERE workspace_id=?").get(workspace) as { count:number }).count, 0);
    assert.throws(() => companies.create(context, { name: "Trigger", website: "https://trigger.test" }));

    db.prepare("UPDATE billing_entitlement_snapshots SET max_companies=NULL WHERE billing_account_id=(SELECT id FROM billing_accounts WHERE workspace_id=?)").run(workspace);
    const company = companies.create(context, { name: "Allowed", website: "https://allowed.test" });
    const profiles = new AssistantProfileRepository(db), profileService = new AssistantProfileService(profiles, clock, entitlements);
    assert.throws(() => profileService.create(context, company.id, { name: "Denied", assistantLanguage: "en" }), AssistantProfileConflictError);
    assert.equal((db.prepare("SELECT COUNT(*) count FROM assistant_profiles").get() as { count:number }).count, 0);

    db.prepare("UPDATE billing_entitlement_snapshots SET max_assistant_profiles=NULL,max_active_channels=NULL WHERE billing_account_id=(SELECT id FROM billing_accounts WHERE workspace_id=?)").run(workspace);
    const profile = reconstructAssistantProfile({ id: assistantProfileId("asp_04600000000000000000000000000001"), companyId: company.id, name: "Ready", normalizedName: "ready", description: null, businessRole: "Advisor", objective: "Help", audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Fallback", status: "ready", createdAt: at, updatedAt: at, archivedAt: null });
    profiles.create(context, company.id, profile);
    const web = new WebChatConnectionRepository(db), webService = new WebChatConnectionService(companies, profiles, web, clock, entitlements);
    db.prepare("INSERT INTO web_chat_connections(id,public_id,workspace_id,company_id,assistant_profile_id,status,created_at,updated_at) VALUES('wcc_04600000000000000000000000000001','wcp_04600000000000000000000000000001',?,?,?,'inactive',?,?)").run(workspace, company.id, profile.id, at, at);
    const whatsapp = new WhatsAppConnectionRepository(db), whatsAppService = new WhatsAppConnectionService(companies, profiles, whatsapp, clock, undefined, undefined, entitlements);
    db.prepare("UPDATE billing_entitlement_snapshots SET max_active_channels=0 WHERE billing_account_id=(SELECT id FROM billing_accounts WHERE workspace_id=?)").run(workspace);
    assert.throws(() => webService.setStatus(context, company.id, "wcc_04600000000000000000000000000001", { status: "active" }), WebChatConnectionCapacityError);
    assert.equal((db.prepare("SELECT status FROM web_chat_connections WHERE id='wcc_04600000000000000000000000000001'").get() as { status:string }).status, "inactive");
    db.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES('wac_04600000000000000000000000000001',?,?,?,'phone046','waba046','inactive',?,?)").run(workspace, company.id, profile.id, at, at);
    assert.throws(() => whatsAppService.update(context, company.id, "wac_04600000000000000000000000000001", { status: "active" }), WhatsAppConnectionConflictError);
    assert.equal((db.prepare("SELECT status FROM whatsapp_connections WHERE id='wac_04600000000000000000000000000001'").get() as { status:string }).status, "inactive");
  } finally { db.close(); }
});

test("EPIC046 Company Core preflights both counted creation paths without changing suspended restores", () => {
  const db = open();
  try {
    const workspace = new WorkspaceRepository(db).resolveDefault(), context = { workspaceId: workspace.id, workspaceKey: workspace.key }, entitlements = new BillingEntitlementService(db);
    let tick = 0;
    const companies = new CompanyApplicationService(new CompanyDomainRepository(db), { clock: { now: () => new Date(Date.parse(at) + tick++).toISOString() }, entitlements });
    const snapshot = db.prepare("SELECT s.id FROM billing_entitlement_snapshots s JOIN billing_accounts a ON a.id=s.billing_account_id WHERE a.workspace_id=?").get(workspace.id) as { id:string };
    db.prepare("UPDATE billing_entitlement_snapshots SET max_companies=0 WHERE id=?").run(snapshot.id);
    assert.equal(companies.createCompany(context, { id: 4601, identity: { name: "Denied", slug: "denied" } }).status, "commercial_limit_reached");
    assert.equal(companies.createOnboardingCompany(context, { name: "Denied onboarding" }).status, "commercial_limit_reached");
    assert.equal((db.prepare("SELECT COUNT(*) count FROM companies WHERE workspace_id=?").get(workspace.id) as { count:number }).count, 0);
    db.prepare("UPDATE billing_entitlement_snapshots SET max_companies=2 WHERE id=?").run(snapshot.id);
    const created = companies.createCompany(context, { id: 4602, identity: { name: "Allowed", slug: "allowed" } });
    assert.equal(created.status, "success");
    assert.equal(companies.createOnboardingCompany(context, { name: "Allowed onboarding" }).status, "success");
    if (created.status !== "success") throw new Error("Expected Company creation.");
    const configured = companies.updateCompanyConfiguration(context, { companyId: created.company.id, expectedVersion: 1, configuration: { timezone: "UTC", locale: "en", operatingLocale: { countryCode: "US", currencyCode: "USD", dateFormat: "MM/DD/YYYY", phoneFormat: "national" }, businessHours: { weekly: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] } } } });
    if (configured.status !== "success") throw new Error("Expected configuration.");
    const suspended = companies.suspendCompany(context, { companyId: configured.company.id, expectedVersion: 2 });
    if (suspended.status !== "success") throw new Error("Expected suspension.");
    db.prepare("UPDATE billing_entitlement_snapshots SET max_companies=0 WHERE id=?").run(snapshot.id);
    assert.equal(companies.restoreCompany(context, { companyId: suspended.company.id, expectedVersion: 3 }).status, "success");
  } finally { db.close(); }
});

test("EPIC046 Company Core fails closed before persistence when its current Billing snapshot is missing", () => {
  const db = open();
  try {
    const workspace = new WorkspaceRepository(db).resolveDefault(), context = { workspaceId: workspace.id, workspaceKey: workspace.key }, entitlements = new BillingEntitlementService(db);
    const companies = new CompanyApplicationService(new CompanyDomainRepository(db), { entitlements });
    db.prepare("DELETE FROM billing_entitlement_snapshots WHERE billing_account_id=(SELECT id FROM billing_accounts WHERE workspace_id=?)").run(workspace.id);
    assert.equal(companies.createCompany(context, { id: 4611, identity: { name: "Missing snapshot", slug: "missing-snapshot" } }).status, "commercial_limit_reached");
    assert.equal((db.prepare("SELECT COUNT(*) count FROM companies WHERE workspace_id=?").get(workspace.id) as { count:number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) count FROM billing_entitlement_snapshots s JOIN billing_accounts a ON a.id=s.billing_account_id WHERE a.workspace_id=?").get(workspace.id) as { count:number }).count, 0);
  } finally { db.close(); }
});

test("EPIC046 Company Core preserves unmanaged administrative Company limits", () => {
  const run = (configure: (db: DatabaseSync, workspaceId: number) => void, expected: "success" | "commercial_limit_reached", initial = 0): void => {
    const db = open();
    try {
      const workspace = new WorkspaceRepository(db).resolveDefault(), context = { workspaceId: workspace.id, workspaceKey: workspace.key }, companies = new CompanyApplicationService(new CompanyDomainRepository(db), { entitlements: new BillingEntitlementService(db) });
      for (let index = 0; index < initial; index += 1) assert.equal(companies.createCompany(context, { id: 4620 + index, identity: { name: `Initial ${index}`, slug: `initial-${index}` } }).status, "success");
      configure(db, workspace.id);
      assert.equal(companies.createCompany(context, { id: 4630, identity: { name: "Candidate", slug: "candidate" } }).status, expected);
      assert.equal((db.prepare("SELECT COUNT(*) count FROM companies WHERE workspace_id=?").get(workspace.id) as { count:number }).count, initial + (expected === "success" ? 1 : 0));
    } finally { db.close(); }
  };
  run(() => {}, "success");
  run((db, workspaceId) => db.prepare("UPDATE workspace_commercial_controls SET max_companies=2 WHERE workspace_id=?").run(workspaceId), "success", 1);
  run((db, workspaceId) => db.prepare("UPDATE workspace_commercial_controls SET max_companies=1 WHERE workspace_id=?").run(workspaceId), "commercial_limit_reached", 1);
  run((db, workspaceId) => db.prepare("UPDATE workspace_commercial_controls SET status='suspended',suspended_at=? WHERE workspace_id=?").run(at, workspaceId), "commercial_limit_reached");
});

test("EPIC046 Profile service preflights counted creates and archived restores only", () => {
  const db = open();
  try {
    const workspace = new WorkspaceRepository(db).resolveDefault(), context = { workspaceId: workspace.id, workspaceKey: workspace.key }, companies = new CompanyRepository(db), company = companies.create(context, { name: "Profiles", website: "https://profiles.test" });
    let tick = 0; const profiles = new AssistantProfileRepository(db), service = new AssistantProfileService(profiles, { now: () => new Date(Date.parse(at) + tick++).toISOString() }, new BillingEntitlementService(db));
    const snapshot = db.prepare("SELECT s.id FROM billing_entitlement_snapshots s JOIN billing_accounts a ON a.id=s.billing_account_id WHERE a.workspace_id=?").get(workspace.id) as { id:string };
    db.prepare("UPDATE billing_entitlement_snapshots SET max_assistant_profiles=1 WHERE id=?").run(snapshot.id);
    const first = service.create(context, company.id, { name: "First", assistantLanguage: "en" });
    assert.equal(first.status, "draft");
    assert.throws(() => service.create(context, company.id, { name: "Denied", assistantLanguage: "en" }), AssistantProfileConflictError);
    assert.equal((db.prepare("SELECT COUNT(*) count FROM assistant_profiles").get() as { count:number }).count, 1);
    assert.equal(service.transition(context, company.id, first.id, "archived").status, "archived");
    assert.equal(service.transition(context, company.id, first.id, "draft").status, "draft");
    assert.equal(service.transition(context, company.id, first.id, "archived").status, "archived");
    const live = service.create(context, company.id, { name: "Live", assistantLanguage: "en" });
    assert.throws(() => service.transition(context, company.id, first.id, "draft"), AssistantProfileConflictError);
    assert.equal(profiles.findById(context, company.id, first.id)?.status, "archived");
    db.prepare("UPDATE billing_entitlement_snapshots SET max_assistant_profiles=0 WHERE id=?").run(snapshot.id);
    assert.equal(service.update(context, company.id, live.id, { description: "Non-capacity" }).description, "Non-capacity");
  } finally { db.close(); }
});

test("EPIC046 channel services preflight shared activation without blocking non-capacity mutations", () => {
  const db = open();
  try {
    const workspace = new WorkspaceRepository(db).resolveDefault(), context = { workspaceId: workspace.id, workspaceKey: workspace.key }, companies = new CompanyRepository(db), company = companies.create(context, { name: "Channels", website: "https://channels.test" });
    const profile = reconstructAssistantProfile({ id: assistantProfileId("asp_04600000000000000000000000000002"), companyId: company.id, name: "Ready", normalizedName: "ready", description: null, businessRole: "Advisor", objective: "Help", audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Fallback", status: "ready", createdAt: at, updatedAt: at, archivedAt: null });
    const profiles = new AssistantProfileRepository(db); profiles.create(context, company.id, profile);
    const entitlements = new BillingEntitlementService(db), webRepository = new WebChatConnectionRepository(db), whatsRepository = new WhatsAppConnectionRepository(db), clock = { now: () => at };
    const web = new WebChatConnectionService(companies, profiles, webRepository, clock, entitlements), whatsapp = new WhatsAppConnectionService(companies, profiles, whatsRepository, clock, undefined, undefined, entitlements);
    const snapshot = db.prepare("SELECT s.id FROM billing_entitlement_snapshots s JOIN billing_accounts a ON a.id=s.billing_account_id WHERE a.workspace_id=?").get(workspace.id) as { id:string };
    db.prepare("UPDATE billing_entitlement_snapshots SET max_active_channels=1 WHERE id=?").run(snapshot.id);
    const activeWeb = web.create(context, company.id, { assistantProfileId: profile.id });
    const inactiveWhats = whatsapp.create(context, company.id, { assistantProfileId: profile.id, phoneNumberId: "phone046a", whatsappBusinessAccountId: "waba046a" });
    assert.equal(inactiveWhats.status, "inactive");
    assert.throws(() => whatsapp.update(context, company.id, inactiveWhats.id, { status: "active" }), WhatsAppConnectionConflictError);
    assert.equal(whatsRepository.findById(context, company.id, inactiveWhats.id)?.status, "inactive");
    assert.equal(web.setStatus(context, company.id, activeWeb.id, { status: "inactive" }).status, "inactive");
    assert.equal(whatsapp.update(context, company.id, inactiveWhats.id, { status: "active" }).status, "active");
    const inactiveWebId = webChatConnectionId("wcc_04600000000000000000000000000002");
    db.prepare("INSERT INTO web_chat_connections(id,public_id,workspace_id,company_id,assistant_profile_id,status,created_at,updated_at) VALUES(?,?,?,?,?,'inactive',?,?)").run(inactiveWebId, "wcp_04600000000000000000000000000002", workspace.id, company.id, profile.id, at, at);
    assert.throws(() => web.setStatus(context, company.id, inactiveWebId, { status: "active" }), WebChatConnectionCapacityError);
    assert.equal(webRepository.findById(context, company.id, inactiveWebId)?.status, "inactive");
    assert.equal(whatsapp.deactivate(context, company.id, inactiveWhats.id).connection.status, "inactive");
    db.prepare("DELETE FROM billing_entitlement_snapshots WHERE id=?").run(snapshot.id);
    assert.throws(() => web.setStatus(context, company.id, inactiveWebId, { status: "active" }), WebChatConnectionCapacityError);
    assert.equal(webRepository.findById(context, company.id, inactiveWebId)?.status, "inactive");
  } finally { db.close(); }
});

test("EPIC046 unmanaged Profile preflight preserves administrative compatibility", () => {
  const run = (configure: (db: DatabaseSync, workspaceId: number) => void, initial = 0, expected: "allowed" | "denied" = "allowed"): void => {
    const db = open();
    try {
      const workspace = new WorkspaceRepository(db).resolveDefault(), context = { workspaceId: workspace.id, workspaceKey: workspace.key }, company = new CompanyRepository(db).create(context, { name: "Profile compatibility", website: "https://profile-compatibility.test" });
      let tick = 0; const service = new AssistantProfileService(new AssistantProfileRepository(db), { now: () => new Date(Date.parse(at) + tick++).toISOString() }, new BillingEntitlementService(db));
      for (let index = 0; index < initial; index += 1) service.create(context, company.id, { name: `Initial ${index}`, assistantLanguage: "en" });
      configure(db, workspace.id);
      if (expected === "allowed") assert.equal(service.create(context, company.id, { name: "Candidate", assistantLanguage: "en" }).status, "draft");
      else assert.throws(() => service.create(context, company.id, { name: "Candidate", assistantLanguage: "en" }), AssistantProfileConflictError);
      assert.equal((db.prepare("SELECT COUNT(*) count FROM assistant_profiles").get() as { count:number }).count, initial + (expected === "allowed" ? 1 : 0));
    } finally { db.close(); }
  };
  run(() => {});
  run((db, workspaceId) => db.prepare("UPDATE workspace_commercial_controls SET max_assistant_profiles=2 WHERE workspace_id=?").run(workspaceId), 1);
  run((db, workspaceId) => db.prepare("UPDATE workspace_commercial_controls SET max_assistant_profiles=1 WHERE workspace_id=?").run(workspaceId), 1, "denied");
  run((db, workspaceId) => db.prepare("UPDATE workspace_commercial_controls SET status='suspended',suspended_at=? WHERE workspace_id=?").run(at, workspaceId), 0, "denied");
});

test("EPIC046 unmanaged Web Chat preflight preserves shared administrative compatibility", () => {
  const run = (configure: (db: DatabaseSync, workspaceId: number, companyId: number, profileId: string) => void, expected: "allowed" | "denied"): void => {
    const db = open();
    try {
      const workspace = new WorkspaceRepository(db).resolveDefault(), context = { workspaceId: workspace.id, workspaceKey: workspace.key }, companies = new CompanyRepository(db), company = companies.create(context, { name: "Channel compatibility", website: "https://channel-compatibility.test" });
      const profile = reconstructAssistantProfile({ id: assistantProfileId("asp_04600000000000000000000000000003"), companyId: company.id, name: "Ready", normalizedName: "ready", description: null, businessRole: "Advisor", objective: "Help", audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: "Welcome", fallbackMessage: "Fallback", status: "ready", createdAt: at, updatedAt: at, archivedAt: null });
      new AssistantProfileRepository(db).create(context, company.id, profile);
      const target = webChatConnectionId("wcc_04600000000000000000000000000003");
      db.prepare("INSERT INTO web_chat_connections(id,public_id,workspace_id,company_id,assistant_profile_id,status,created_at,updated_at) VALUES(?,?,?,?,?,'inactive',?,?)").run(target, "wcp_04600000000000000000000000000003", workspace.id, company.id, profile.id, at, at);
      configure(db, workspace.id, company.id, profile.id);
      const service = new WebChatConnectionService(companies, new AssistantProfileRepository(db), new WebChatConnectionRepository(db), { now: () => at }, new BillingEntitlementService(db));
      if (expected === "allowed") assert.equal(service.setStatus(context, company.id, target, { status: "active" }).status, "active");
      else assert.throws(() => service.setStatus(context, company.id, target, { status: "active" }), WebChatConnectionCapacityError);
      assert.equal((new WebChatConnectionRepository(db).findById(context, company.id, target)!).status, expected === "allowed" ? "active" : "inactive");
    } finally { db.close(); }
  };
  run(() => {}, "allowed");
  run((db, workspaceId, companyId, profileId) => { db.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES('wac_046compat',?,?,?,'phonecompat','wabacompat','active',?,?)").run(workspaceId, companyId, profileId, at, at); db.prepare("UPDATE workspace_commercial_controls SET max_active_channels=2 WHERE workspace_id=?").run(workspaceId); }, "allowed");
  run((db, workspaceId, companyId, profileId) => { db.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES('wac_046limit',?,?,?,'phonelimit','wabalimit','active',?,?)").run(workspaceId, companyId, profileId, at, at); db.prepare("UPDATE workspace_commercial_controls SET max_active_channels=1 WHERE workspace_id=?").run(workspaceId); }, "denied");
  run((db, workspaceId) => db.prepare("UPDATE workspace_commercial_controls SET status='suspended',suspended_at=? WHERE workspace_id=?").run(at, workspaceId), "denied");
});

test("EPIC046 two SQLite workers preserve effective Billing capacity ceilings", async () => {
  const companyInsert = "INSERT INTO companies(workspace_id,name,website,phone,email,status,slug,name_normalized,lifecycle_state,brand_colors_json,version,created_at,updated_at,lifecycle_changed_at) VALUES(?,?,NULL,'','','ready',?,?,'draft','{}',1,?,?,?)";
  const companyRace = async (billing: number | null, administrative: number | null, expectedSuccess: number): Promise<void> => {
    await withRaceDatabase(async (db, path) => {
      const workspace = defaultWorkspace(db), snapshot = billingSnapshot(db, workspace);
      db.prepare("UPDATE billing_entitlement_snapshots SET max_companies=? WHERE id=?").run(billing, snapshot);
      db.prepare("UPDATE workspace_commercial_controls SET max_companies=? WHERE workspace_id=?").run(administrative, workspace);
      const results = await race(path, [
        { sql: companyInsert, parameters: [workspace, "Race A", "race-a", "race-a", at, at, at] },
        { sql: companyInsert, parameters: [workspace, "Race B", "race-b", "race-b", at, at, at] },
      ]);
      assert.equal(results.filter(result => result === "success").length, expectedSuccess);
      assert.equal(count(db, "SELECT COUNT(*) count FROM companies WHERE workspace_id=? AND lifecycle_state!='archived'", workspace), expectedSuccess);
    });
  };
  await companyRace(1, null, 1);
  await companyRace(2, 1, 1);
  await companyRace(1, 5, 1);
  await companyRace(0, null, 0);
  await withRaceDatabase(async (db, path) => {
    const workspace = defaultWorkspace(db), company = createRaceCompany(db, workspace, "Profile owner"), snapshot = billingSnapshot(db, workspace);
    db.prepare("UPDATE billing_entitlement_snapshots SET max_assistant_profiles=1 WHERE id=?").run(snapshot);
    const results = await race(path, [
      { sql: "INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at) VALUES(?,?,?,'profile-a','friendly','en','Fallback','draft',?,?)", parameters: ["asp_046race000000000000000000000001", company, "Profile A", at, at] },
      { sql: "INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at) VALUES(?,?,?,'profile-b','friendly','en','Fallback','draft',?,?)", parameters: ["asp_046race000000000000000000000002", company, "Profile B", at, at] },
    ]);
    assert.equal(results.filter(result => result === "success").length, 1);
    assert.equal(count(db, "SELECT COUNT(*) count FROM assistant_profiles"), 1);
  });
  await withRaceDatabase(async (db, path) => {
    const workspace = defaultWorkspace(db), company = createRaceCompany(db, workspace, "Channel owner"), profile = createRaceProfile(db, company), snapshot = billingSnapshot(db, workspace);
    db.prepare("UPDATE billing_entitlement_snapshots SET max_active_channels=1 WHERE id=?").run(snapshot);
    db.prepare("INSERT INTO web_chat_connections(id,public_id,workspace_id,company_id,assistant_profile_id,status,created_at,updated_at) VALUES('wcc_046race000000000000000000000001','wcp_046race000000000000000000000001',?,?,?,'inactive',?,?),('wcc_046race000000000000000000000002','wcp_046race000000000000000000000002',?,?,?,'inactive',?,?)").run(workspace, company, profile, at, at, workspace, company, profile, at, at);
    const results = await race(path, [
      { sql: "UPDATE web_chat_connections SET status='active' WHERE id='wcc_046race000000000000000000000001'", parameters: [] },
      { sql: "UPDATE web_chat_connections SET status='active' WHERE id='wcc_046race000000000000000000000002'", parameters: [] },
    ]);
    assert.equal(results.filter(result => result === "success").length, 1);
    assert.equal(activeChannels(db, workspace), 1);
  });
  await withRaceDatabase(async (db, path) => {
    const workspace = defaultWorkspace(db), company = createRaceCompany(db, workspace, "Cross type"), profile = createRaceProfile(db, company), snapshot = billingSnapshot(db, workspace);
    db.prepare("UPDATE billing_entitlement_snapshots SET max_active_channels=1 WHERE id=?").run(snapshot);
    db.prepare("INSERT INTO web_chat_connections(id,public_id,workspace_id,company_id,assistant_profile_id,status,created_at,updated_at) VALUES('wcc_046cross000000000000000000000001','wcp_046cross000000000000000000000001',?,?,?,'inactive',?,?)").run(workspace, company, profile, at, at);
    db.prepare("INSERT INTO whatsapp_connections(id,workspace_id,company_id,assistant_profile_id,phone_number_id,whatsapp_business_account_id,status,created_at,updated_at) VALUES('wac_046cross000000000000000000000001',?,?,?,'phone-cross','waba-cross','inactive',?,?)").run(workspace, company, profile, at, at);
    const results = await race(path, [{ sql: "UPDATE web_chat_connections SET status='active' WHERE id='wcc_046cross000000000000000000000001'", parameters: [] }, { sql: "UPDATE whatsapp_connections SET status='active' WHERE id='wac_046cross000000000000000000000001'", parameters: [] }]);
    assert.equal(results.filter(result => result === "success").length, 1); assert.equal(activeChannels(db, workspace), 1);
  });
  await withRaceDatabase(async (db, path) => {
    const workspace = defaultWorkspace(db), snapshot = billingSnapshot(db, workspace); db.prepare("DELETE FROM billing_entitlement_snapshots WHERE id=?").run(snapshot);
    const results = await race(path, [{ sql: companyInsert, parameters: [workspace, "Missing A", "missing-a", "missing-a", at, at, at] }, { sql: companyInsert, parameters: [workspace, "Missing B", "missing-b", "missing-b", at, at, at] }]);
    assert.deepEqual(results, ["rejected", "rejected"]); assert.equal(count(db, "SELECT COUNT(*) count FROM companies WHERE workspace_id=?", workspace), 0);
  });
});

test("EPIC046 accepts verified bounded webhook evidence once and only enqueues reconciliation", () => {
  const db = open();
  try {
    const workspaceId = defaultWorkspace(db), account = new BillingAccountRepository(db).findByWorkspace(workspaceId)!;
    db.prepare("UPDATE billing_accounts SET rollout_mode='managed',provider_kind='stripe',provider_customer_id='cus_webhook',version=version+1 WHERE id=?").run(account.id);
    db.prepare("UPDATE billing_subscriptions SET provider_kind='stripe',provider_subscription_id='sub_webhook',effective_state='active',version=version+1 WHERE billing_account_id=?").run(account.id);
    const secret = "stripe_webhook_secret", raw = Buffer.from(JSON.stringify({ id:"evt_webhook", type:"customer.subscription.updated", data:{ object:{ id:"sub_webhook", customer:"cus_webhook", status:"past_due" } } }));
    const signature = createHmac("sha256", secret).update(`${stripeTimestamp}.`).update(raw).digest("hex");
    const service = new BillingWebhookService({stripe:secret,mercadopago:"mp_webhook_secret"},new BillingWebhookRepository(db),()=>at);
    const authorityBefore = db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(account.id);
    assert.equal(service.receive("stripe",raw,{"stripe-signature":`t=${stripeTimestamp},v1=${signature}`}),"accepted");
    assert.equal(service.receive("stripe",raw,{"stripe-signature":`t=${stripeTimestamp},v1=${signature}`}),"duplicate");
    assert.equal(count(db,"SELECT COUNT(*) count FROM billing_provider_events"),1);
    assert.equal(count(db,"SELECT COUNT(*) count FROM billing_reconciliation_work WHERE billing_account_id=? AND status='pending'",account.id),1);
    assert.deepEqual(db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(account.id),authorityBefore);
    assert.equal(service.receive("stripe",raw,{"stripe-signature":`t=${stripeTimestamp},v1=00`}),"invalid");
    const unknown = Buffer.from(JSON.stringify({id:"evt_unknown",type:"customer.subscription.updated",data:{object:{id:"sub_unknown",customer:"cus_unknown"}}}));
    const unknownSignature = createHmac("sha256",secret).update(`${stripeTimestamp}.`).update(unknown).digest("hex");
    assert.equal(service.receive("stripe",unknown,{"stripe-signature":`t=${stripeTimestamp},v1=${unknownSignature}`}),"ignored");
    assert.equal(count(db,"SELECT COUNT(*) count FROM billing_reconciliation_work"),1);
    const conflicting = Buffer.from(JSON.stringify({id:"evt_conflicting",type:"customer.subscription.updated",data:{object:{id:"sub_webhook",customer:"cus_unknown"}}}));
    const conflictingSignature = createHmac("sha256",secret).update(`${stripeTimestamp}.`).update(conflicting).digest("hex");
    assert.equal(service.receive("stripe",conflicting,{"stripe-signature":`t=${stripeTimestamp},v1=${conflictingSignature}`}),"ignored");
    assert.equal(count(db,"SELECT COUNT(*) count FROM billing_reconciliation_work"),1);
    assert.deepEqual(db.prepare("PRAGMA table_info(billing_provider_events)").all().map(row=>(row as {name:string}).name).filter(name=>/payload|body/i.test(name)),["payload_digest"]);
  } finally { db.close(); }
});

test("EPIC046 PASS4F5 HTTP summary and entitlements expose only safe unmanaged projections", async () => withBillingHttp(async fixture => {
  const summary=await fixture.get("/summary"), entitlements=await fixture.get("/entitlements");
  assert.equal(summary.status,200); assert.equal(summary.headers.get("cache-control"),"no-store, private"); assert.equal(summary.headers.get("pragma"),"no-cache"); assert.equal(entitlements.status,200); const entitlement=await entitlements.json(); assert.deepEqual(await summary.json(),{rolloutMode:"unmanaged",subscription:{state:"unmanaged",plan:null},entitlement,capabilities:{canOpenBillingPortal:false,canCancel:false,canReactivate:false,canStartNewCheckout:false,canSwitchProvider:false}});
  assert.deepEqual(Object.keys(entitlement).sort(),["effectiveAt","expiresAt","maxActiveChannels","maxAssistantProfiles","maxCompanies","mutationEligible","state"]);
}));

test("EPIC046 PASS4F5 HTTP projects paused, administrative, minimum, and zero entitlement states without activation", async () => withBillingHttp(async fixture => {
  const snapshot=billingSnapshot(fixture.db,fixture.workspaceId), account=fixture.account.id;
  fixture.db.prepare("UPDATE billing_entitlement_snapshots SET entitlement_state='restricted',max_companies=1,max_assistant_profiles=0,max_active_channels=0,mutation_eligible=0 WHERE id=?").run(snapshot);
  fixture.db.prepare("UPDATE workspace_commercial_controls SET status='suspended',suspended_at=? WHERE workspace_id=?").run(at,fixture.workspaceId);
  fixture.db.prepare("UPDATE billing_subscriptions SET effective_state='reconciliation_required' WHERE billing_account_id=?").run(account);
  const summary=await (await fixture.get("/summary")).json() as {entitlement:{effectiveAt:string};}; assert.deepEqual(summary,{rolloutMode:"unmanaged",subscription:{state:"reconciliation_required",plan:null},entitlement:{state:"restricted",maxCompanies:1,maxAssistantProfiles:0,maxActiveChannels:0,mutationEligible:false,effectiveAt:summary.entitlement.effectiveAt,expiresAt:null},capabilities:{canOpenBillingPortal:false,canCancel:false,canReactivate:false,canStartNewCheckout:false,canSwitchProvider:false}});
  const entitlements=await (await fixture.get("/entitlements")).json() as Record<string,unknown>; assert.deepEqual({...entitlements,effectiveAt:null},{state:"restricted",maxCompanies:1,maxAssistantProfiles:0,maxActiveChannels:0,mutationEligible:false,effectiveAt:null,expiresAt:null}); assert.equal(typeof entitlements.effectiveAt,"string");
}));

test("EPIC046 PASS4F5 HTTP hides authentication, authorization, and cross-tenant failures", async () => withBillingHttp(async fixture => {
  const other=new WorkspaceRepository(fixture.db).create({publicId:"wsp_046other",key:"epic046-other",name:"Other",timezone:null,defaultLocale:null});
  assert.equal((await fixture.get("/summary",{"cookie":"atlas=reader"})).status,404);
  assert.equal((await fixture.get("/summary",{"cookie":"atlas=missing"})).status,404);
  assert.equal((await fetch(`${fixture.origin}/workspaces/${other.publicId}/billing/summary`,{headers:fixture.headers()})).status,404);
}));

test("EPIC046 PASS4F5 HTTP checkout permits Stripe without a payer and requires the selected Mercado Pago payer", async () => withBillingHttp({providers:["stripe","mercadopago"]},async fixture => {
  const stripe=fixture.catalog({planKey:"http-stripe",providerKind:"stripe",providerPriceId:"price_http_stripe"});
  const mercadoPago=fixture.catalog({planKey:"http-mp",catalogVersion:2,providerKind:"mercadopago",providerPriceId:"mp_http"});
  assert.equal((await fixture.post("/checkout-sessions",checkoutBody(fixture,stripe),{"idempotency-key":"stripe"})).status,200);
  assert.equal((await fixture.post("/checkout-sessions",checkoutBody(fixture,mercadoPago),{"idempotency-key":"mp-missing"})).status,409);
  fixture.db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('http-payer','active','en',?,?)").run(at,at); fixture.db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES('http-payer-member',?,'http-payer','owner','active',1,?,?)").run(fixture.workspaceId,at,at); fixture.db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES('http-payer-identity','http-payer','payer@example.test','payer@example.test',1,?,?)").run(at,at); fixture.db.prepare("UPDATE billing_accounts SET billing_payer_identity_id='http-payer-identity' WHERE id=?").run(fixture.account.id);
  assert.equal((await fixture.post("/checkout-sessions",checkoutBody(fixture,mercadoPago),{"idempotency-key":"mp-selected"})).status,409); assert.equal(fixture.mercadoPago!.calls.length,0);
}));

test("EPIC046 PASS4F7A removes payer-selection routes", async () => withBillingHttp(async fixture => {
  for (const method of ["GET","PUT","DELETE"] as const) assert.equal((await fetch(`${fixture.origin}/workspaces/wsp_default/billing/payer-selection`,method==="GET"?{method,headers:fixture.headers()}:{method,headers:fixture.headers(),body:JSON.stringify({identityId:"manager-identity"})})).status,404);
}));

test("EPIC046 PASS4F7B lists only the caller's usable payer identities and follows lifecycle", async () => withBillingHttp(async fixture => {
  addPayerIdentity(fixture,"manager-identity","manager","manager@example.test"); addPayerIdentity(fixture,"manager-second","manager","second@example.test"); addPayerIdentity(fixture,"other-identity","other","other@example.test");
  assert.deepEqual(await (await fixture.get("/payer-identity-options")).json(),{options:[{identityId:"manager-identity",email:"manager@example.test"},{identityId:"manager-second",email:"second@example.test"}]});
  fixture.db.prepare("UPDATE authentication_identities SET email_verified=0 WHERE id='manager-second'").run(); assert.deepEqual(await (await fixture.get("/payer-identity-options")).json(),{options:[{identityId:"manager-identity",email:"manager@example.test"}]});
  fixture.db.prepare("UPDATE memberships SET status='suspended' WHERE id='manager-member'").run(); assert.deepEqual(await (await fixture.get("/payer-identity-options")).json(),{options:[]});
}));

test("EPIC046 PASS4F7B payer identity mutations require exact own identity bodies", async () => withBillingHttp(async fixture => {
  addPayerIdentity(fixture,"manager-identity","manager","manager@example.test"); addPayerIdentity(fixture,"manager-second","manager","second@example.test"); addPayerIdentity(fixture,"other-identity","other","other@example.test");
  const put=(body:unknown)=>fetch(`${fixture.origin}/workspaces/wsp_default/billing/payer-identity`,{method:"PUT",headers:fixture.headers(),body:JSON.stringify(body)}), remove=(body:unknown)=>fetch(`${fixture.origin}/workspaces/wsp_default/billing/payer-identity`,{method:"DELETE",headers:fixture.headers(),body:JSON.stringify(body)});
  assert.equal((await put({})).status,400); assert.equal((await put({accountVersion:1,identityId:"manager-second"})).status,400); assert.equal((await put({identityId:"other-identity"})).status,409); assert.equal((await put({identityId:"manager-second",extra:true})).status,400); assert.equal((await put({identityId:"manager-second"})).status,200);
  assert.equal((await remove({})).status,400); assert.equal((await remove({accountVersion:2,identityId:"manager-second"})).status,400); assert.equal((await remove({identityId:"manager-identity"})).status,409); assert.equal((await remove({identityId:"manager-second"})).status,200);
  assert.equal((fixture.db.prepare("SELECT billing_payer_identity_id FROM billing_accounts WHERE id=?").get(fixture.account.id) as {billing_payer_identity_id:string|null}).billing_payer_identity_id,null);
}));

test("EPIC046 PASS4F7B payer identity mutation returns one CAS conflict without retrying a deterministic race", () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db), accounts=new BillingAccountRepository(db), account=accounts.findByWorkspace(workspaceId)!;
    db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES('payer-race','active','en',?,?)").run(at,at);
    db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES('payer-race-member',?,'payer-race','owner','active',1,?,?)").run(workspaceId,at,at);
    db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES('payer-race-caller','payer-race','caller@example.test','caller@example.test',1,?,?),('payer-race-selected','payer-race','selected@example.test','selected@example.test',1,?,?)").run(at,at,at,at);
    let raced=false;
    const service=new BillingApplicationService(db,null as never,{checkoutSuccess:"https://atlas.test/success",checkoutCancel:"https://atlas.test/cancel",portalReturn:"https://atlas.test/portal"},()=>{ if(!raced) { raced=true; db.prepare("UPDATE billing_accounts SET version=version+1 WHERE id=?").run(account.id); } return at; });
    assert.deepEqual(service.setPayerIdentity(workspaceId,"payer-race-caller","payer-race-selected"),{status:"conflict"});
    assert.equal(raced,true); assert.deepEqual(accounts.findById(account.id),{...account,version:account.version+1});
  } finally { db.close(); }
});

test("EPIC046 PASS4F7B selects a second own identity for Mercado Pago checkout", async () => withBillingHttp({providers:["stripe","mercadopago"]},async fixture => {
  const mercadoPago=fixture.catalog({planKey:"mp-owned-second",providerKind:"mercadopago",providerPriceId:"mp_owned_second"}); addPayerIdentity(fixture,"manager-identity","manager","manager@example.test"); addPayerIdentity(fixture,"manager-second","manager","second@example.test");
  assert.equal((await fetch(`${fixture.origin}/workspaces/wsp_default/billing/payer-identity`,{method:"PUT",headers:fixture.headers(),body:JSON.stringify({identityId:"manager-second"})})).status,200);
  const checkout=await fixture.post("/checkout-sessions",checkoutBody(fixture,mercadoPago),{"idempotency-key":"mp-owned-second"}); assert.equal(checkout.status,200); assert.equal(fixture.mercadoPago!.calls.length,1); assert.equal(fixture.mercadoPago!.calls[0]!.payerEmail,"second@example.test");
}));

test("EPIC046 PASS4F5 HTTP validates idempotency and exact mutation bodies before dispatch", async () => withBillingHttp(async fixture => {
  const entry=fixture.catalog({planKey:"http-validation",providerKind:"stripe",providerPriceId:"price_http_validation"});
  assert.equal((await fixture.post("/checkout-sessions",{...checkoutBody(fixture,entry),successTarget:"https://evil.test"},{"idempotency-key":"valid"})).status,400);
  assert.equal((await fixture.post("/checkout-sessions",{catalogEntryId:entry.id})).status,400);
  assert.equal((await fixture.post("/checkout-sessions",checkoutBody(fixture,entry),{"idempotency-key":"bad key"})).status,400);
  assert.equal(fixture.stripe.calls.length,0);
}));

test("EPIC046 PASS4F5 HTTP replays exact checkout and conflicts divergent durable reuse", async () => withBillingHttp(async fixture => {
  const first=fixture.catalog({planKey:"http-replay",providerKind:"stripe",providerPriceId:"price_http_replay"}), second=fixture.catalog({planKey:"http-conflict",catalogVersion:2,providerKind:"stripe",providerPriceId:"price_http_conflict"});
  assert.equal((await fixture.post("/checkout-sessions",checkoutBody(fixture,first),{"idempotency-key":"same-key"})).status,200); assert.equal((await fixture.post("/checkout-sessions",checkoutBody(fixture,first),{"idempotency-key":"same-key"})).status,200); assert.equal((await fixture.post("/checkout-sessions",checkoutBody(fixture,second),{"idempotency-key":"same-key"})).status,409); assert.equal(fixture.stripe.calls.length,1);
}));

test("EPIC046 PASS4F5 HTTP portal is protected, ephemeral, and requires a mapped customer", async () => withBillingHttp(async fixture => {
  assert.equal((await fixture.post("/portal-sessions",{})).status,409); fixture.managed("active");
  assert.equal((await fixture.post("/portal-sessions",{returnTarget:"https://evil.test"})).status,400); assert.equal((await fixture.post("/portal-sessions",{})).status,200); assert.equal(count(fixture.db,"SELECT COUNT(*) count FROM billing_operations"),0); assert.equal(fixture.stripe.calls.filter(call=>call.kind==="portal").length,1);
}));

test("EPIC046 PASS4F5 HTTP cancel and reactivate are durable and reject no subscription", async () => withBillingHttp(async fixture => {
  assert.equal((await fixture.post("/subscription/cancel",{},{"idempotency-key":"none"})).status,409); assert.equal(fixture.stripe.calls.length,0); fixture.managed("active");
  assert.equal((await fixture.post("/subscription/cancel",{},{"idempotency-key":"cancel"})).status,200); fixture.db.prepare("UPDATE billing_subscriptions SET effective_state='canceling_at_period_end' WHERE billing_account_id=?").run(fixture.account.id); assert.equal((await fixture.post("/subscription/reactivate",{},{"idempotency-key":"reactivate"})).status,200);
}));

test("EPIC046 PASS4F5 HTTP maps provider outcomes without revealing provider internals", async () => {
  for (const [result,status] of [[{kind:"failed",code:"unavailable"},503],[{kind:"uncertain"},202]] as const) await withBillingHttp({result},async fixture => { const entry=fixture.catalog({planKey:`http-${result.kind}`,providerKind:"stripe",providerPriceId:`price-${result.kind}`}), response=await fixture.post("/checkout-sessions",checkoutBody(fixture,entry),{"idempotency-key":result.kind}); assert.equal(response.status,status); assert.deepEqual(await response.json(),{status:result.kind}); });
});

test("EPIC046 PASS4F5 HTTP checkout success never activates local subscription authority", async () => withBillingHttp(async fixture => {
  const entry=fixture.catalog({planKey:"http-no-activation",providerKind:"stripe",providerPriceId:"price_no_activation"}), before=fixture.db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(fixture.account.id), snapshot=fixture.db.prepare("SELECT entitlement_state,version FROM billing_entitlement_snapshots WHERE billing_account_id=?").get(fixture.account.id);
  assert.equal((await fixture.post("/checkout-sessions",checkoutBody(fixture,entry),{"idempotency-key":"no-activation"})).status,200); assert.deepEqual(fixture.db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(fixture.account.id),before); assert.deepEqual(fixture.db.prepare("SELECT entitlement_state,version FROM billing_entitlement_snapshots WHERE billing_account_id=?").get(fixture.account.id),snapshot);
}));

test("EPIC046 PASS4F5 HTTP webhooks are raw-signature independent and only enqueue reconciliation", async () => withBillingHttp({webhook:true},async fixture => {
  fixture.managed("active"); const raw=Buffer.from(JSON.stringify({id:"evt_http_webhook",type:"customer.subscription.updated",data:{object:{id:"sub_http",customer:"cus_http",status:"past_due"}}})), signature=createHmac("sha256","stripe_webhook_secret").update(`${stripeTimestamp}.`).update(raw).digest("hex"), before=fixture.db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(fixture.account.id);
  const response=await fetch(`${fixture.origin}/webhooks/billing/stripe`,{method:"POST",headers:{"content-type":"application/json","stripe-signature":`t=${stripeTimestamp},v1=${signature}`},body:raw}); assert.equal(response.status,200); assert.deepEqual(fixture.db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(fixture.account.id),before); assert.equal(count(fixture.db,"SELECT COUNT(*) count FROM billing_reconciliation_work WHERE billing_account_id=?",fixture.account.id),1);
}));

interface BillingHttpFixture { readonly db:DatabaseSync; readonly workspaceId:number; readonly account:NonNullable<ReturnType<BillingAccountRepository["findByWorkspace"]>>; readonly origin:string; readonly stripe:DeterministicFakeBillingProvider; readonly mercadoPago:DeterministicFakeBillingProvider|null; headers(extra?:Record<string,string>):Record<string,string>; get(path:string, extra?:Record<string,string>):Promise<Response>; post(path:string, body:unknown, extra?:Record<string,string>):Promise<Response>; catalog(overrides:Record<string,unknown>):ReturnType<BillingCatalogRepository["create"]>; managed(state:"active"|"canceling_at_period_end"):void; }
type BillingHttpOptions={readonly providers?:readonly ("stripe"|"mercadopago")[];readonly result?:BillingProviderResult;readonly webhook?:boolean;};
async function withBillingHttp(options:BillingHttpOptions|((fixture:BillingHttpFixture)=>Promise<void>), operation?:((fixture:BillingHttpFixture)=>Promise<void>)):Promise<void> {
  const config=typeof options === "function" ? {} : options, exercise=typeof options === "function" ? options : operation!;
  const db=open(), workspaceId=defaultWorkspace(db), account=new BillingAccountRepository(db).findByWorkspace(workspaceId)!, result=config.result??{kind:"success",providerObjectId:"provider_http",redirectUrl:"https://atlas.test/redirect"}, stripe=new DeterministicFakeBillingProvider(result), mercadoPago=config.providers?.includes("mercadopago")?new DeterministicFakeBillingProvider(result,mercadoPagoBillingProviderCapabilities):null, registrations:[{kind:"stripe";provider:BillingProvider},{kind:"mercadopago";provider:BillingProvider}]|[{kind:"stripe";provider:BillingProvider}]=mercadoPago?[{kind:"stripe",provider:stripe},{kind:"mercadopago",provider:mercadoPago}]:[{kind:"stripe",provider:stripe}], operations=new BillingOperationService(new BillingAccountRepository(db),new BillingCatalogRepository(db),new BillingSubscriptionRepository(db),new BillingOperationRepository(db),new BillingProviderRegistry(registrations),()=>at,new BillingPayerIdentityResolver(db)), service=new BillingApplicationService(db,operations,{checkoutSuccess:"https://atlas.test/billing/checkout/success",checkoutCancel:"https://atlas.test/billing/checkout/cancel",portalReturn:"https://atlas.test/billing/portal/return"});
  const billingRouter=createBillingRouter({authentication:{cookieName:()=>"atlas",current:(raw:string)=>raw==="manager"||raw==="reader"?{userId:raw,authenticationIdentityId:`${raw}-identity`}:null,validateCsrf:(_raw:string,csrf:string)=>csrf==="csrf"}as never,users:{findById:(id:string)=>({id,status:"active"})}as never,authorization:{authorize:(user:{id:string},workspace:string,permission:string)=>{if(user.id!=="manager"||workspace!=="wsp_default"||!["workspace:read","workspace:manage"].includes(permission))throw new Error("denied");return{workspaceId,workspacePublicId:workspace,userId:user.id,membershipId:"mem",role:"owner",capabilities:new Set(["workspace:read","workspace:manage"]),permission};}}as never,resolver:{resolve:()=>({workspaceId,workspaceKey:"default"})}as never,originPolicy:{allows:()=>true}as never,controllers:createBillingControllers(service)}), empty=Router(), webhook=config.webhook?createBillingWebhookRouter({stripe:createBillingWebhookController(new BillingWebhookService({stripe:"stripe_webhook_secret",mercadopago:"mp_webhook_secret"},new BillingWebhookRepository(db),()=>at),"stripe"),mercadoPago:createBillingWebhookController(new BillingWebhookService({stripe:"stripe_webhook_secret",mercadopago:"mp_webhook_secret"},new BillingWebhookRepository(db),()=>at),"mercadopago")}):undefined, app=createApp({authorizedCompaniesRouter:empty,billingRouter,...(webhook?{billingWebhookRouter:webhook}:{}),chatRouter:empty,companiesRouter:empty,identityRouter:empty,knowledgeRouter:empty,publicWebChatRouter:empty,scrapeRouter:empty,workspacesRouter:empty}), server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve)); const origin=`http://127.0.0.1:${(server.address()as AddressInfo).port}`, base=`${origin}/workspaces/wsp_default/billing`, headers=(extra:Record<string,string>={})=>({"content-type":"application/json",cookie:"atlas=manager",origin,"sec-fetch-site":"same-origin","x-csrf-token":"csrf",...extra});
  try { await exercise({db,workspaceId,account,origin,stripe,mercadoPago,headers,get:(path,extra={})=>fetch(`${base}${path}`,{headers:headers(extra)}),post:(path,body,extra={})=>fetch(`${base}${path}`,{method:"POST",headers:headers(extra),body:JSON.stringify(body)}),catalog:overrides=>new BillingCatalogRepository(db).create(catalogInput(overrides)),managed:state=>{db.prepare("UPDATE billing_accounts SET rollout_mode='managed',provider_kind='stripe',provider_customer_id='cus_http' WHERE id=?").run(account.id);db.prepare("UPDATE billing_subscriptions SET provider_kind='stripe',provider_subscription_id='sub_http',effective_state=? WHERE billing_account_id=?").run(state,account.id);}}); }
  finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); db.close(); }
}

async function withRaceDatabase(operation: (db: DatabaseSync, path: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "atlas-epic046-capacity-race-")), path = join(directory, "atlas.sqlite"); let db = open(path);
  try { await operation(db, path); db.close(); db = open(path); assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []); }
  finally { if (db.isOpen) db.close(); rmSync(directory, { recursive: true, force: true }); }
}
async function race(path: string, attempts: readonly { readonly sql: string; readonly parameters: readonly SQLInputValue[] }[]): Promise<string[]> {
  const workers = attempts.map(input => new Worker(new URL("./helpers/billingCapacityRaceWorker.ts", import.meta.url), { workerData: { path, ...input } }));
  await Promise.all(workers.map(worker => new Promise<void>((resolve, reject) => { worker.once("error", reject); worker.on("message", message => { if ((message as { status?: string }).status === "ready") resolve(); }); })));
  const results = workers.map(worker => new Promise<string>((resolve, reject) => { worker.once("error", reject); worker.on("message", message => { const status = (message as { status?: string }).status; if (status === "success" || status === "rejected") resolve(status); }); })); workers.forEach(worker => worker.postMessage("start")); return Promise.all(results);
}
function billingSnapshot(db: DatabaseSync, workspace: number): string { return (db.prepare("SELECT s.id FROM billing_entitlement_snapshots s JOIN billing_accounts a ON a.id=s.billing_account_id WHERE a.workspace_id=?").get(workspace) as { id:string }).id; }
function checkoutBody(fixture:BillingHttpFixture,entry:ReturnType<BillingCatalogRepository["create"]>):{catalogEntryId:string;providerCommercialOfferId:string}{return{catalogEntryId:entry.id,providerCommercialOfferId:new BillingCatalogRepository(fixture.db).sellableOffers(entry.id)[0]!.id};}
function addPayerIdentity(fixture:BillingHttpFixture,identityId:string,userId:string,email:string):void { if(!(fixture.db.prepare("SELECT 1 FROM users WHERE id=?").get(userId))) fixture.db.prepare("INSERT INTO users(id,status,locale,created_at,updated_at) VALUES(?,'active','en',?,?)").run(userId,at,at); if(!(fixture.db.prepare("SELECT 1 FROM memberships WHERE workspace_id=? AND user_id=?").get(fixture.workspaceId,userId))) fixture.db.prepare("INSERT INTO memberships(id,workspace_id,user_id,role,status,version,created_at,activated_at) VALUES(?,?,?,'owner','active',1,?,?)").run(`${userId}-member`,fixture.workspaceId,userId,at,at); fixture.db.prepare("INSERT INTO authentication_identities(id,user_id,email,normalized_email,email_verified,created_at,updated_at) VALUES(?,?,?,?,1,?,?)").run(identityId,userId,email,email,at,at); }
function count(db: DatabaseSync, sql: string, ...parameters: SQLInputValue[]): number { return Number((db.prepare(sql).get(...parameters) as { count:number }).count); }
function createRaceCompany(db: DatabaseSync, workspace: number, name: string): number { db.prepare("INSERT INTO companies(workspace_id,name,website,phone,email,status,slug,name_normalized,lifecycle_state,brand_colors_json,version,created_at,updated_at,lifecycle_changed_at) VALUES(?,?,?,'','', 'ready',?,?, 'draft','{}',1,?,?,?)").run(workspace, name, `https://${name}.test`, name, name, at, at, at); return Number((db.prepare("SELECT last_insert_rowid() id").get() as { id:number }).id); }
function createRaceProfile(db: DatabaseSync, company: number): string { const id = "asp_046race000000000000000000000000"; db.prepare("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,tone,assistant_language,fallback_message,status,created_at,updated_at) VALUES(?,?,?,'race','friendly','en','Fallback','ready',?,?)").run(id, company, "Race", at, at); return id; }
function activeChannels(db: DatabaseSync, workspace: number): number { return count(db, "SELECT (SELECT COUNT(*) FROM web_chat_connections WHERE workspace_id=? AND status='active')+(SELECT COUNT(*) FROM whatsapp_connections WHERE workspace_id=? AND status='active') count", workspace, workspace); }

test("EPIC046 Recovery H restarts stale Stripe work with durable provider references and bounds its checkout window", async () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db), accounts=new BillingAccountRepository(db), account=accounts.findByWorkspace(workspaceId)!, catalog=new BillingCatalogRepository(db), operations=new BillingOperationRepository(db), entry=catalog.create(catalogInput({planKey:"recovery-h-stripe",providerKind:"stripe",providerPriceId:"price_recovery_h"}));
    const create=(operationId:string,startedAt:string,catalogEntry=entry)=>{const pending=operations.createOrReplay({billingAccountId:account.id,kind:"checkout_session_create",providerKind:"stripe",operationId,fingerprint:billingOperationFingerprint({billingAccountId:account.id,operationKind:"checkout_session_create",catalogEntryId:catalogEntry.id,providerKind:"stripe",redirectTarget:"https://atlas.test/s",cancelTarget:"https://atlas.test/c"}),catalogEntryId:catalogEntry.id,successTarget:"https://atlas.test/s",cancelTarget:"https://atlas.test/c",at:startedAt}).operation!;return operations.start(pending.id,pending.version,startedAt)!;};
    const stale=create("stale-restart","2026-08-31T23:58:00.000Z"); let recovered=0;
    const provider:BillingProvider={capabilities:stripeBillingProviderCapabilities,createCheckoutSession:async()=>{throw new Error("normal dispatch must not run");},createPortalSession:async()=>({kind:"failed",code:"invalid_request"}),cancelAtPeriodEnd:async()=>({kind:"failed",code:"invalid_request"}),reactivateSubscription:async()=>({kind:"failed",code:"invalid_request"}),readSubscription:async()=>({kind:"uncertain"}),recoverOperation:async input=>{recovered+=1;assert.deepEqual(input,{kind:"checkout_session_create",idempotencyKey:billingProviderIdempotencyKey(account.id,"checkout_session_create","stale-restart"),catalogReference:"price_recovery_h",successTarget:"https://atlas.test/s",cancelTarget:"https://atlas.test/c",correlationToken:stale.recoveryCorrelationToken,subscriptionReference:undefined});return{kind:"success",providerObjectId:"cs_stale",redirectUrl:"https://atlas.test/recovered"};}};
    assert.equal(catalog.retire(entry.id),true); const worker=new BillingOperationRecoveryWorker(operations,new BillingProviderRegistry([{kind:"stripe",provider}]),()=>at);
    assert.equal(await worker.runNext("restart"),"succeeded"); assert.equal(recovered,1); assert.equal(operations.find(account.id,"checkout_session_create","stale-restart")?.status,"succeeded");
    create("outside-window","2026-08-30T00:00:00.000Z"); assert.equal(await worker.runNext("window"),"retry"); assert.equal(recovered,1); assert.equal((db.prepare("SELECT recovery_safe_failure_code,recovery_next_attempt_at FROM billing_operations WHERE billing_account_id=? AND operation_id='outside-window'").get(account.id) as {recovery_safe_failure_code:string;recovery_next_attempt_at:string}).recovery_safe_failure_code,"recovery_window_expired");
    db.prepare("DELETE FROM billing_checkout_enrollments WHERE billing_account_id=?").run(account.id); db.prepare("UPDATE billing_operations SET status='failed',settled_at=? WHERE billing_account_id=? AND operation_id='outside-window'").run(at,account.id); const mismatchedCatalog=catalog.create(catalogInput({planKey:"recovery-h-mismatch",providerKind:"mercadopago",providerPriceId:"mp_other"})),mismatch=create("catalog-mismatch","2026-08-31T23:58:00.000Z",mismatchedCatalog); assert.equal(await worker.runNext("mismatch"),"retry"); assert.equal(recovered,1); assert.equal((db.prepare("SELECT recovery_safe_failure_code FROM billing_operations WHERE id=?").get(mismatch.id) as {recovery_safe_failure_code:string}).recovery_safe_failure_code,"catalog_provider_mismatch");
  } finally { db.close(); }
});

test("EPIC046 Recovery H fences a late recovery worker after a reclaimed lease", async () => {
  const directory=mkdtempSync(join(tmpdir(),"atlas-epic046-recovery-fence-")),path=join(directory,"atlas.sqlite"),first=open(path),second=open(path);
  try {
    const workspaceId=defaultWorkspace(first), account=new BillingAccountRepository(first).findByWorkspace(workspaceId)!, catalog=new BillingCatalogRepository(first).create(catalogInput({planKey:"recovery-fence",providerKind:"stripe",providerPriceId:"price_fence"})), operations=new BillingOperationRepository(first), pending=operations.createOrReplay({billingAccountId:account.id,kind:"checkout_session_create",providerKind:"stripe",operationId:"fence",fingerprint:billingOperationFingerprint({billingAccountId:account.id,operationKind:"checkout_session_create",catalogEntryId:catalog.id,providerKind:"stripe",redirectTarget:"https://atlas.test/s",cancelTarget:"https://atlas.test/c"}),catalogEntryId:catalog.id,successTarget:"https://atlas.test/s",cancelTarget:"https://atlas.test/c",at}).operation!, started=operations.start(pending.id,pending.version,at)!; operations.uncertain(started.id,started.version,at);
    let release:()=>void=()=>undefined; const gate=new Promise<void>(resolve=>{release=resolve;}); const providerA:BillingProvider={capabilities:stripeBillingProviderCapabilities,createCheckoutSession:async()=>({kind:"failed",code:"invalid_request"}),createPortalSession:async()=>({kind:"failed",code:"invalid_request"}),cancelAtPeriodEnd:async()=>({kind:"failed",code:"invalid_request"}),reactivateSubscription:async()=>({kind:"failed",code:"invalid_request"}),readSubscription:async()=>({kind:"uncertain"}),recoverOperation:async()=>{await gate;return{kind:"success",providerObjectId:"cs_late"};}}; const providerB={...providerA,recoverOperation:async()=>({kind:"success" as const,providerObjectId:"cs_winner"})};
    const left=new BillingOperationRecoveryWorker(new BillingOperationRepository(first),new BillingProviderRegistry([{kind:"stripe",provider:providerA}]),()=>at,1),right=new BillingOperationRecoveryWorker(new BillingOperationRepository(second),new BillingProviderRegistry([{kind:"stripe",provider:providerB}]),()=>"2026-09-01T00:02:00.000Z",1),late=left.runNext("left"); await new Promise<void>(resolve=>setImmediate(resolve)); assert.equal(await right.runNext("right"),"succeeded"); release(); assert.equal(await late,"lost_lease"); assert.equal(new BillingOperationRepository(first).find(account.id,"checkout_session_create","fence")?.providerObjectId,"cs_winner");
  } finally { first.close(); second.close(); rmSync(directory,{recursive:true,force:true}); }
});

test("EPIC046 Recovery H settles lost Stripe webhook responses canonically and preserves conflicting enrollment", () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),account=new BillingAccountRepository(db).findByWorkspace(workspaceId)!,catalog=new BillingCatalogRepository(db).create(catalogInput({planKey:"recovery-webhook",providerKind:"stripe",providerPriceId:"price_webhook"})),operations=new BillingOperationRepository(db),pending=operations.createOrReplay({billingAccountId:account.id,kind:"checkout_session_create",providerKind:"stripe",operationId:"lost-response",fingerprint:billingOperationFingerprint({billingAccountId:account.id,operationKind:"checkout_session_create",catalogEntryId:catalog.id,providerKind:"stripe",redirectTarget:"https://atlas.test/s",cancelTarget:"https://atlas.test/c"}),catalogEntryId:catalog.id,successTarget:"https://atlas.test/s",cancelTarget:"https://atlas.test/c",at}).operation!,started=operations.start(pending.id,pending.version,at)!; operations.uncertain(started.id,started.version,at);
    const receive=(eventId:string,subscription:string,customer:string)=>{const raw=Buffer.from(JSON.stringify({id:eventId,type:"checkout.session.completed",data:{object:{id:"cs_lost",subscription,customer,client_reference_id:pending.recoveryCorrelationToken}}})),signature=createHmac("sha256","recovery-secret").update(`${stripeTimestamp}.`).update(raw).digest("hex");return new BillingWebhookService({stripe:"recovery-secret",mercadopago:""},new BillingWebhookRepository(db),()=>at).receive("stripe",raw,{"stripe-signature":`t=${stripeTimestamp},v1=${signature}`});};
    assert.equal(receive("evt_lost","sub_canonical","cus_canonical"),"accepted"); assert.equal(operations.find(account.id,"checkout_session_create","lost-response")?.status,"succeeded"); assert.equal(receive("evt_conflict","sub_other","cus_other"),"ignored"); assert.deepEqual({...db.prepare("SELECT provider_subscription_id,provider_customer_id,status FROM billing_checkout_enrollments WHERE checkout_operation_id=?").get(pending.id) as Record<string,unknown>},{provider_subscription_id:"sub_canonical",provider_customer_id:"cus_canonical",status:"conflict"});
  } finally { db.close(); }
});

test("EPIC046 Recovery H replays recovered cancel/reactivate operations without local authority writes", async () => {
  const db=open(); try {
    const workspaceId=defaultWorkspace(db),accounts=new BillingAccountRepository(db),account=accounts.findByWorkspace(workspaceId)!,subscriptions=new BillingSubscriptionRepository(db),operations=new BillingOperationRepository(db); db.prepare("UPDATE billing_accounts SET rollout_mode='managed',provider_kind='stripe',provider_customer_id='cus_recovery' WHERE id=?").run(account.id); db.prepare("UPDATE billing_subscriptions SET provider_kind='stripe',provider_subscription_id='sub_recovery',effective_state='active' WHERE billing_account_id=?").run(account.id); const before=db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(account.id),fake=new DeterministicFakeBillingProvider({kind:"uncertain"}),initial=new BillingOperationService(accounts,new BillingCatalogRepository(db),subscriptions,operations,new BillingProviderRegistry([{kind:"stripe",provider:fake}]),()=>at),sub=subscriptions.current(account.id)!;
    assert.equal((await initial.cancelAtPeriodEnd({workspaceId,subscriptionId:sub.id,operationId:"cancel-recover"})).kind,"uncertain"); let references:string[]=[]; const recovery:BillingProvider={capabilities:fake.capabilities,createCheckoutSession:input=>fake.createCheckoutSession(input),createPortalSession:input=>fake.createPortalSession(input),cancelAtPeriodEnd:input=>fake.cancelAtPeriodEnd(input),reactivateSubscription:input=>fake.reactivateSubscription(input),readSubscription:input=>fake.readSubscription(input),recoverOperation:async input=>{references.push(input.subscriptionReference!);return{kind:"success",providerObjectId:input.subscriptionReference!};}}; const worker=new BillingOperationRecoveryWorker(operations,new BillingProviderRegistry([{kind:"stripe",provider:recovery}]),()=>at); assert.equal(await worker.runNext(),"succeeded"); assert.deepEqual(references,["sub_recovery"]); assert.equal((await initial.cancelAtPeriodEnd({workspaceId,subscriptionId:sub.id,operationId:"cancel-recover"})).kind,"succeeded"); assert.equal(fake.calls.filter(call=>call.kind==="subscription_cancel_at_period_end").length,1); assert.deepEqual(db.prepare("SELECT effective_state,version FROM billing_subscriptions WHERE billing_account_id=?").get(account.id),before);
    db.prepare("UPDATE billing_subscriptions SET effective_state='canceling_at_period_end' WHERE id=?").run(sub.id); const reactivateSub=subscriptions.current(account.id)!; assert.equal((await initial.reactivate({workspaceId,subscriptionId:reactivateSub.id,operationId:"reactivate-recover"})).kind,"uncertain"); assert.equal(await worker.runNext(),"succeeded"); assert.equal((await initial.reactivate({workspaceId,subscriptionId:reactivateSub.id,operationId:"reactivate-recover"})).kind,"succeeded"); assert.deepEqual(references,["sub_recovery","sub_recovery"]);
  } finally { db.close(); }
});

test("EPIC046 Recovery H Mercado Pago recovery accepts only one exact canonical preapproval", async () => {
  const requests:string[]=[]; const provider=new MercadoPagoBillingProvider({accessToken:"token",apiBaseUrl:"https://api.mercadopago.test",timeoutMs:50,allowedRedirectOrigins:["https://atlas.test","https://mp.test"]},async url=>{requests.push(url);return new Response(JSON.stringify({results:[{id:"pre_canonical",init_point:"https://mp.test/checkout",external_reference:"aco_exact",preapproval_plan_id:"plan_exact"}]}));});
  assert.deepEqual(await provider.recoverOperation({kind:"checkout_session_create",idempotencyKey:"ignored",catalogReference:"plan_exact",correlationToken:"aco_exact"}),{kind:"success",providerObjectId:"pre_canonical",redirectUrl:"https://mp.test/checkout"}); assert.equal(requests[0],"https://api.mercadopago.test/preapproval/search?preapproval_plan_id=plan_exact&q=aco_exact");
  const mismatch=new MercadoPagoBillingProvider({accessToken:"token",apiBaseUrl:"https://api.mercadopago.test",timeoutMs:50,allowedRedirectOrigins:["https://atlas.test","https://mp.test"]},async()=>new Response(JSON.stringify({results:[{id:"pre_other",init_point:"https://mp.test/checkout",external_reference:"aco_other",preapproval_plan_id:"plan_exact"}]}))); assert.deepEqual(await mismatch.recoverOperation({kind:"checkout_session_create",idempotencyKey:"ignored",catalogReference:"plan_exact",correlationToken:"aco_exact"}),{kind:"uncertain"}); assert.deepEqual(await provider.recoverOperation({kind:"subscription_reactivate",idempotencyKey:"ignored"}),{kind:"failed",code:"invalid_request"});
});

test("EPIC046 Recovery H HTTP checkout replays a recovered result without a second provider dispatch", async () => withBillingHttp({result:{kind:"uncertain"}},async fixture => {
  const entry=fixture.catalog({planKey:"http-recovery-replay",providerKind:"stripe",providerPriceId:"price_http_recovery"}),body=checkoutBody(fixture,entry); assert.equal((await fixture.post("/checkout-sessions",body,{"idempotency-key":"recover-http"})).status,202); const operations=new BillingOperationRepository(fixture.db),operationId=(fixture.db.prepare("SELECT operation_id FROM billing_operations WHERE billing_account_id=? AND operation_kind='checkout_session_create'").get(fixture.account.id) as {operation_id:string}).operation_id,operation=operations.find(fixture.account.id,"checkout_session_create",operationId)!,claim=operations.claimRecovery("http",at,"2026-09-01T00:00:00.000Z","2026-09-01T00:01:00.000Z")!; assert.ok(operations.succeedRecoveredCheckout(claim,"cs_http_recovered",JSON.stringify({providerObjectId:"cs_http_recovered",redirectUrl:"https://atlas.test/recovered"}),at)); const replay=await fixture.post("/checkout-sessions",body,{"idempotency-key":"recover-http"}); assert.equal(replay.status,200); assert.deepEqual(await replay.json(),{status:"succeeded",redirectUrl:"https://atlas.test/recovered"}); assert.equal(fixture.stripe.calls.length,1); assert.equal(operation.status,"uncertain");
}));
