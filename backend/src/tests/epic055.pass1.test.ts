import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { AsyncBillingWebhookService, BillingWebhookService } from "../billing/application/billingWebhookService.js";
import { productionConfiguration } from "../config/productionConfiguration.js";
import { stripeBillingProviderFromEnvironment } from "../billing/providers/stripeBillingProvider.js";
import { mercadoPagoBillingProviderFromEnvironment } from "../billing/providers/mercadoPagoBillingProvider.js";

const core=():NodeJS.ProcessEnv=>({NODE_ENV:"production",DATABASE_PROVIDER:"libsql",TURSO_DATABASE_URL:"libsql://atlas.example.test",TURSO_AUTH_TOKEN:"database-token",ATLAS_VERIFICATION_ORIGIN:"https://portal.example.test",ATLAS_BOOTSTRAP_SECRET:"b".repeat(32),EMAIL_PROVIDER:"resend",RESEND_API_KEY:"email-token",RESEND_FROM:"atlas@example.test"});
const timestamp=1_725_000_000,now=()=>new Date(timestamp*1_000).toISOString();
function stripe(secret:string,raw:Buffer,value=timestamp):string{return createHmac("sha256",secret).update(`${value}.`).update(raw).digest("hex");}
function mercado(secret:string,raw:Buffer,requestId:string,value=timestamp):string{const id=((JSON.parse(raw.toString("utf8")) as {data:{id:string}}).data.id);return createHmac("sha256",secret).update(`id:${id};request-id:${requestId};ts:${value};`).digest("hex");}

test("EPIC055 PASS1 requires webhook secrets only for enabled production billing providers",()=>{
  assert.doesNotThrow(()=>productionConfiguration(core()));
  const stripeEnvironment={...core(),BILLING_PROVIDERS:"stripe",STRIPE_SECRET_KEY:"stripe-key",STRIPE_ALLOWED_REDIRECT_ORIGINS:"https://portal.example.test"};
  assert.throws(()=>productionConfiguration({...stripeEnvironment,STRIPE_SECRET_KEY:""}),/enabled provider/);
  assert.throws(()=>productionConfiguration({...stripeEnvironment,STRIPE_ALLOWED_REDIRECT_ORIGINS:""}),/enabled provider/);
  assert.throws(()=>productionConfiguration(stripeEnvironment),/enabled provider/);
  assert.doesNotThrow(()=>productionConfiguration({...stripeEnvironment,STRIPE_WEBHOOK_SIGNING_SECRET:"stripe-webhook"}));
  const mercadoEnvironment={...core(),BILLING_PROVIDERS:"mercadopago",MERCADOPAGO_ACCESS_TOKEN:"mercado-token",MERCADOPAGO_ALLOWED_REDIRECT_ORIGINS:"https://portal.example.test"};
  assert.throws(()=>productionConfiguration({...mercadoEnvironment,MERCADOPAGO_ACCESS_TOKEN:""}),/enabled provider/);
  assert.throws(()=>productionConfiguration({...mercadoEnvironment,MERCADOPAGO_ALLOWED_REDIRECT_ORIGINS:""}),/enabled provider/);
  assert.throws(()=>productionConfiguration(mercadoEnvironment),/enabled provider/);
  assert.doesNotThrow(()=>productionConfiguration({...mercadoEnvironment,MERCADOPAGO_WEBHOOK_SECRET:"mercado-webhook"}));
});

test("EPIC055 PASS1 preserves the explicit Stripe event and exact fresh raw signature contract",()=>{
  const secret="stripe-webhook",raw=Buffer.from(JSON.stringify({id:"evt_stripe",type:"customer.subscription.updated",data:{object:{id:"sub_stripe"}}})),service=new BillingWebhookService({stripe:secret,mercadopago:"mercado-webhook"},{accept:()=>"accepted"}as never,now);
  assert.equal(service.receive("stripe",raw,{"stripe-signature":`t=${timestamp},v1=${stripe(secret,raw)}`}),"accepted");
  assert.equal(service.receive("stripe",raw,{"stripe-signature":`t=${timestamp-301},v1=${stripe(secret,raw,timestamp-301)}`}),"invalid");
  const unsupported=Buffer.from(JSON.stringify({id:"evt_invoice",type:"invoice.paid",data:{object:{id:"invoice"}}}));
  assert.equal(service.receive("stripe",unsupported,{"stripe-signature":`t=${timestamp},v1=${stripe(secret,unsupported)}`}),"invalid");
  assert.equal(service.receive("stripe",Buffer.from(`${raw}x`),{"stripe-signature":`t=${timestamp},v1=${stripe(secret,raw)}`}),"invalid");
});

test("EPIC055 PASS1 accepts only fresh valid Mercado Pago manifests and retains async duplicate handling",async()=>{
  const secret="mercado-webhook",requestId="request_1",raw=Buffer.from(JSON.stringify({id:"evt_mercado",action:"preapproval.updated",data:{id:"preapproval_1"}})),header=`ts=${timestamp},v1=${mercado(secret,raw,requestId)}`;
  const sync=new BillingWebhookService({stripe:"stripe-webhook",mercadopago:secret},{accept:()=>"accepted"}as never,now);
  assert.equal(sync.receive("mercadopago",raw,{"x-signature":header,"x-request-id":requestId}),"accepted");
  assert.equal(sync.receive("mercadopago",raw,{"x-signature":`ts=${timestamp-301},v1=${mercado(secret,raw,requestId,timestamp-301)}`,"x-request-id":requestId}),"invalid");
  assert.equal(sync.receive("mercadopago",raw,{"x-signature":`ts=${timestamp+301},v1=${mercado(secret,raw,requestId,timestamp+301)}`,"x-request-id":requestId}),"invalid");
  assert.equal(sync.receive("mercadopago",raw,{"x-signature":"ts=bad,v1=00","x-request-id":requestId}),"invalid");
  assert.equal(sync.receive("mercadopago",Buffer.from(`${raw}x`),{"x-signature":header,"x-request-id":requestId}),"invalid");
  const events=new Set<string>(),asyncService=new AsyncBillingWebhookService({stripe:"stripe-webhook",mercadopago:secret},{accept:async event=>events.has(event.providerEventId)?"duplicate":(events.add(event.providerEventId),"accepted")}as never,now);
  assert.equal(await asyncService.receive("mercadopago",raw,{"x-signature":header,"x-request-id":requestId}),"accepted");
  assert.equal(await asyncService.receive("mercadopago",raw,{"x-signature":header,"x-request-id":requestId}),"duplicate");
});

test("EPIC055 PASS7 keeps Atlas return origins separate from provider-hosted checkout redirects",async()=>{
  const stripe=stripeBillingProviderFromEnvironment({STRIPE_SECRET_KEY:"stripe-key",STRIPE_ALLOWED_REDIRECT_ORIGINS:"https://portal.example.test"},async()=>new Response(JSON.stringify({id:"cs_1",url:"https://checkout.stripe.com/pay/cs_1"})));
  assert.deepEqual(await stripe.createCheckoutSession({idempotencyKey:"key",catalogReference:"price_1",successTarget:"https://portal.example.test/billing/checkout/success",cancelTarget:"https://portal.example.test/billing/checkout/cancel"}),{kind:"success",providerObjectId:"cs_1",redirectUrl:"https://checkout.stripe.com/pay/cs_1"});
  const hostileStripe=stripeBillingProviderFromEnvironment({STRIPE_SECRET_KEY:"stripe-key",STRIPE_ALLOWED_REDIRECT_ORIGINS:"https://portal.example.test"},async()=>new Response(JSON.stringify({id:"cs_1",url:"https://evil.example.test/pay"})));
  assert.equal((await hostileStripe.createCheckoutSession({idempotencyKey:"key",catalogReference:"price_1",successTarget:"https://portal.example.test/billing/checkout/success",cancelTarget:"https://portal.example.test/billing/checkout/cancel"})).kind,"uncertain");
  const mercado=mercadoPagoBillingProviderFromEnvironment({MERCADOPAGO_ACCESS_TOKEN:"mp-key",MERCADOPAGO_ALLOWED_REDIRECT_ORIGINS:"https://portal.example.test"},async()=>new Response(JSON.stringify({id:"pre_1",init_point:"https://www.mercadopago.com/checkout/pre_1"})));
  assert.deepEqual(await mercado.createCheckoutSession({idempotencyKey:"key",catalogReference:"plan_1",successTarget:"https://portal.example.test/billing/checkout/success",cancelTarget:"https://portal.example.test/billing/checkout/cancel",payerEmail:"payer@example.test"}),{kind:"success",providerObjectId:"pre_1",redirectUrl:"https://www.mercadopago.com/checkout/pre_1"});
  const hostileMercado=mercadoPagoBillingProviderFromEnvironment({MERCADOPAGO_ACCESS_TOKEN:"mp-key",MERCADOPAGO_ALLOWED_REDIRECT_ORIGINS:"https://portal.example.test"},async()=>new Response(JSON.stringify({id:"pre_1",init_point:"https://evil.example.test/checkout"})));
  assert.equal((await hostileMercado.createCheckoutSession({idempotencyKey:"key",catalogReference:"plan_1",successTarget:"https://portal.example.test/billing/checkout/success",cancelTarget:"https://portal.example.test/billing/checkout/cancel",payerEmail:"payer@example.test"})).kind,"uncertain");
});
