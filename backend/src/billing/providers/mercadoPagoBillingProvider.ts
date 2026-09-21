import { createHash } from "node:crypto";
import { mercadoPagoBillingProviderCapabilities, type BillingCommercialOfferValidation, type BillingProvider, type BillingProviderResult, type BillingSubscriptionReadResult } from "../application/billingProvider.js";
import { type ProviderEvidenceState } from "../domain/billing.js";

export interface MercadoPagoBillingProviderConfiguration {
  readonly accessToken:string;
  readonly apiBaseUrl:string;
  readonly timeoutMs:number;
  readonly allowedRedirectOrigins:readonly string[];
}

export type MercadoPagoFetch=(input:string,init:RequestInit)=>Promise<Response>;

export class MercadoPagoBillingConfigurationError extends Error {}

export function mercadoPagoBillingProviderFromEnvironment(environment:NodeJS.ProcessEnv=process.env,fetcher:MercadoPagoFetch=fetch):MercadoPagoBillingProvider {
  const accessToken=environment.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if(!accessToken)throw new MercadoPagoBillingConfigurationError("MERCADOPAGO_ACCESS_TOKEN is required when Mercado Pago is configured.");
  const apiBaseUrl=environment.MERCADOPAGO_API_BASE_URL?.trim()||"https://api.mercadopago.com";
  const timeoutMs=Number(environment.MERCADOPAGO_TIMEOUT_MS??"10000");
  const origins=(environment.MERCADOPAGO_ALLOWED_REDIRECT_ORIGINS??"").split(",").map(value=>value.trim()).filter(Boolean);
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60_000)throw new MercadoPagoBillingConfigurationError("MERCADOPAGO_TIMEOUT_MS is invalid.");
  if(!origins.length)throw new MercadoPagoBillingConfigurationError("MERCADOPAGO_ALLOWED_REDIRECT_ORIGINS is required when Mercado Pago is configured.");
  try {
    return new MercadoPagoBillingProvider({
      accessToken,
      apiBaseUrl,
      timeoutMs,
      allowedRedirectOrigins:[...new Set(origins.map(origin=>{
        const url=new URL(origin);
        if(url.origin!==origin||url.protocol!=="https:")throw new Error();
        return url.origin;
      }))]
    },fetcher);
  } catch {
    throw new MercadoPagoBillingConfigurationError("Mercado Pago Billing configuration is invalid.");
  }
}

export class MercadoPagoBillingProvider implements BillingProvider {
  public readonly capabilities=mercadoPagoBillingProviderCapabilities;

  public constructor(private readonly config:MercadoPagoBillingProviderConfiguration,private readonly fetcher:MercadoPagoFetch=fetch) {
    if(!config.accessToken||!/^https:\/\//u.test(config.apiBaseUrl)||!Number.isSafeInteger(config.timeoutMs)||config.timeoutMs<1)throw new Error("Mercado Pago Billing configuration is invalid.");
  }

  public createCheckoutSession(input:{readonly idempotencyKey:string;readonly catalogReference:string;readonly successTarget:string;readonly cancelTarget:string;readonly correlationToken?:string;readonly payerEmail?:string}):Promise<BillingProviderResult> {
    if(!this.plan(input.catalogReference)||!this.redirect(input.successTarget)||!this.email(input.payerEmail))return Promise.resolve({kind:"failed",code:"invalid_request"});
    return this.createPreapproval(input);
  }

  public createPortalSession(_input:{readonly billingAccountReference:string;readonly returnTarget:string}):Promise<BillingProviderResult> { return Promise.resolve({kind:"failed",code:"invalid_request"}); }
  public cancelAtPeriodEnd(_input:{readonly idempotencyKey:string;readonly subscriptionReference:string}):Promise<BillingProviderResult> { return Promise.resolve({kind:"failed",code:"invalid_request"}); }
  public reactivateSubscription(_input:{readonly idempotencyKey:string;readonly subscriptionReference:string}):Promise<BillingProviderResult> { return Promise.resolve({kind:"failed",code:"invalid_request"}); }
  public async readSubscription(input:{readonly subscriptionReference:string}):Promise<BillingSubscriptionReadResult> { if(!this.plan(input.subscriptionReference))return {kind:"failed",code:"invalid_request"}; const body=await this.get(`/preapproval/${encodeURIComponent(input.subscriptionReference)}`);if(body==="not_found")return {kind:"not_found"};if(!body)return {kind:"uncertain"};const id=typeof body.id==="string"&&this.plan(body.id)?body.id:null;if(id!==input.subscriptionReference)return {kind:"uncertain"};const state=this.preapprovalState(body.status);if(!state)return {kind:"uncertain"};const start=this.date(body.date_created),end=this.date(body.next_payment_date);if(start===undefined||end===undefined)return {kind:"uncertain"};const providerCommercialReference=typeof body.preapproval_plan_id==="string"&&this.plan(body.preapproval_plan_id)?body.preapproval_plan_id:null;return {kind:"success",evidence:Object.freeze({providerSubscriptionId:id,providerCommercialReference,providerEvidenceState:state,currentPeriodStart:start,currentPeriodEnd:end,trialEndsAt:null,cancelAtPeriodEnd:false})}; }
  public async recoverOperation(input:{readonly kind:import("../domain/billingOperations.js").BillingOperationKind;readonly idempotencyKey:string;readonly catalogReference?:string|undefined;readonly correlationToken?:string|undefined}):Promise<BillingProviderResult>{if(input.kind!=="checkout_session_create"||!input.catalogReference||!input.correlationToken||!this.plan(input.catalogReference))return{kind:"failed",code:"invalid_request"};const body=await this.get(`/preapproval/search?preapproval_plan_id=${encodeURIComponent(input.catalogReference)}&q=${encodeURIComponent(input.correlationToken)}`);if(!body||body==="not_found")return{kind:"uncertain"};const results=Array.isArray(body.results)?body.results:[];const exact=results.filter((value:unknown)=>value&&typeof value==="object"&&(value as Record<string,unknown>).external_reference===input.correlationToken&&(value as Record<string,unknown>).preapproval_plan_id===input.catalogReference)as Record<string,unknown>[];if(exact.length!==1)return{kind:"uncertain"};const id=typeof exact[0]!.id==="string"&&this.plan(exact[0]!.id)?exact[0]!.id:null,initPoint=typeof exact[0]!.init_point==="string"&&this.redirect(exact[0]!.init_point)?exact[0]!.init_point:null;return id&&initPoint?{kind:"success",providerObjectId:id,redirectUrl:initPoint}:{kind:"uncertain"};}
  public async validateCommercialOffer(input:{readonly catalogReference:string;readonly currency:string;readonly amountMinor:number;readonly interval:"month"|"year"}):Promise<BillingCommercialOfferValidation>{if(!this.plan(input.catalogReference)||input.currency!=="ARS"||!Number.isSafeInteger(input.amountMinor)||input.amountMinor<1)return{kind:"invalid"};const body=await this.get(`/preapproval_plan/${encodeURIComponent(input.catalogReference)}`);if(body==="not_found")return{kind:"invalid"};if(!body)return{kind:"unavailable"};const recurring=body.auto_recurring,expected=input.interval==="month"?1:12,amount=recurring&&typeof recurring==="object"?this.minor((recurring as Record<string,unknown>).transaction_amount):null;return body.status==="active"&&body.currency_id==="ARS"&&amount===input.amountMinor&&recurring&&typeof recurring==="object"&&Number((recurring as Record<string,unknown>).frequency)===expected&&(recurring as Record<string,unknown>).frequency_type==="months"?{kind:"ready"}:{kind:"invalid"};}

  private plan(value:string):boolean { return typeof value==="string"&&value.trim().length>0&&value.length<=200; }
  private email(value:string|undefined):value is string { return typeof value==="string"&&value.trim().length>0&&value.length<=320&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value); }
  private redirect(value:string):boolean { try { const url=new URL(value); return url.protocol==="https:"&&this.config.allowedRedirectOrigins.includes(url.origin); } catch { return false; } }
  private externalReference(idempotencyKey:string):string { return `atlas_${createHash("sha256").update(idempotencyKey).digest("hex").slice(0,58)}`; }
  private minor(value:unknown):number|null { const decimal=typeof value==="string"?value:typeof value==="number"&&Number.isFinite(value)?String(value):null,parts=decimal&&/^(\d+)(?:\.(\d{1,2}))?$/u.exec(decimal);if(!parts)return null;const minor=BigInt(parts[1]!)*100n+BigInt((parts[2]??"").padEnd(2,"0"));return minor<=BigInt(Number.MAX_SAFE_INTEGER)?Number(minor):null; }
  private date(value:unknown):string|null|undefined { if(value===null||value===undefined)return null;if(typeof value!=="string")return undefined;const parsed=Date.parse(value);return Number.isNaN(parsed)?undefined:new Date(parsed).toISOString(); }
  private preapprovalState(value:unknown):ProviderEvidenceState|null { if(typeof value!=="string")return null;switch(value){case "pending":return "checkout_pending";case "authorized":return "active";case "paused":return "paused";case "cancelled":case "canceled":return "canceled";default:return "unknown";} }
  private async get(path:string):Promise<Record<string,unknown>|"not_found"|null> { const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.config.timeoutMs);try{const response=await this.fetcher(`${this.config.apiBaseUrl}${path}`,{method:"GET",headers:new Headers({Authorization:`Bearer ${this.config.accessToken}`}),signal:controller.signal});if(response.status===404)return "not_found";if(!response.ok)return null;const body:unknown=await response.json();return body&&typeof body==="object"?body as Record<string,unknown>:null;}catch{return null;}finally{clearTimeout(timer);} }

  private async createPreapproval(input:{readonly idempotencyKey:string;readonly catalogReference:string;readonly successTarget:string;readonly correlationToken?:string;readonly payerEmail?:string}):Promise<BillingProviderResult> {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),this.config.timeoutMs);
    try {
      const response=await this.fetcher(`${this.config.apiBaseUrl}/preapproval`,{
        method:"POST",
        headers:new Headers({Authorization:`Bearer ${this.config.accessToken}`,"Content-Type":"application/json"}),
        body:JSON.stringify({preapproval_plan_id:input.catalogReference,payer_email:input.payerEmail,back_url:input.successTarget,external_reference:input.correlationToken??this.externalReference(input.idempotencyKey)}),
        signal:controller.signal
      });
      if(!response.ok)return response.status>=400&&response.status<500?{kind:"failed",code:"invalid_request"}:{kind:"uncertain"};
      let body:unknown;
      try { body=await response.json(); } catch { return {kind:"uncertain"}; }
      if(!body||typeof body!=="object")return {kind:"uncertain"};
       const record=body as Record<string,unknown>,externalReference=input.correlationToken??this.externalReference(input.idempotencyKey);
       if((record.preapproval_plan_id!==undefined&&record.preapproval_plan_id!==input.catalogReference)||(record.external_reference!==undefined&&record.external_reference!==externalReference))return {kind:"uncertain"};
      const id=typeof record.id==="string"&&record.id.length>0&&record.id.length<=200?record.id:null;
      const initPoint=typeof record.init_point==="string"&&this.redirect(record.init_point)?record.init_point:null;
      return id&&initPoint?{kind:"success",providerObjectId:id,redirectUrl:initPoint}:{kind:"uncertain"};
    } catch { return {kind:"uncertain"}; } finally { clearTimeout(timer); }
  }
}
