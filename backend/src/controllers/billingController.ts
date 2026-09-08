import type { RequestHandler } from "express";
import type { BillingApplicationService } from "../billing/application/billingApplicationService.js";
import { AbuseLimitExceededError, billingActorLimit, billingWorkspaceLimit, type RateLimitService } from "../abuse/rateLimitService.js";
import { abuseScope } from "../abuse/sharedRateLimitRepository.js";

function object(value:unknown):Record<string,unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid"); return value as Record<string,unknown>; }
function exact(value:unknown, keys:readonly string[]):Record<string,unknown> { const result=object(value); if (Object.keys(result).length !== keys.length || Object.keys(result).some(key=>!keys.includes(key))) throw new Error("invalid"); return result; }
function identityId(value:unknown):string { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new Error("invalid"); return value; }
function catalogEntryId(value:unknown):string { return identityId(value); }
function idempotencyKey(value:unknown):string { if (typeof value !== "string" || !/^[\x21-\x7e]{1,200}$/.test(value)) throw new Error("invalid"); return value; }
function respond(res:Parameters<RequestHandler>[1], result:{status:string;redirectUrl?:string}):void { const code=result.status === "succeeded" ? 200 : result.status === "conflict" ? 409 : result.status === "in_progress" || result.status === "uncertain" ? 202 : result.status === "invalid" || result.status === "unsupported" ? 409 : 503; res.status(code).json(result); }
function safe(handler:RequestHandler):RequestHandler { return async(req,res,next)=>{ try { await handler(req,res,next); } catch(error:unknown) { if(error instanceof AbuseLimitExceededError){res.setHeader("Retry-After",String(error.retryAfterSeconds));res.status(429).json({error:{code:"rate_limited",message:"Request is temporarily unavailable."}});return;} res.status(400).json({ error:{ code:"validation_failed", message:"Billing request is invalid." } }); } }; }

export interface BillingRequestContext { readonly workspaceId:number; readonly callerIdentityId:string; }
export function createBillingControllers(service:BillingApplicationService,limits?:RateLimitService):Record<"summary"|"entitlements"|"catalog"|"payerIdentityOptions"|"setPayerIdentity"|"clearPayerIdentity"|"checkout"|"portal"|"cancel"|"reactivate",(context:BillingRequestContext)=>RequestHandler> { const limit=(context:BillingRequestContext):void=>{limits?.enforce(abuseScope("workspace",context.workspaceId,"actor",context.callerIdentityId),"actor",billingActorLimit);limits?.enforce(abuseScope("workspace",context.workspaceId),"company",billingWorkspaceLimit);}; return {
  summary:context=>safe((_req,res)=>{ const result=service.summary(context.workspaceId); if (!result) { res.status(404).json({ error:"Resource not found." }); return; } res.json(result); }),
  entitlements:context=>safe((_req,res)=>{ const result=service.entitlementsFor(context.workspaceId); if (!result) { res.status(404).json({ error:"Resource not found." }); return; } res.json(result); }),
  catalog:context=>safe((_req,res)=>{ const result=service.catalogForWorkspace(context.workspaceId); if (!result) { res.status(404).json({ error:"Resource not found." }); return; } res.json(result); }),
  payerIdentityOptions:context=>safe((_req,res)=>{ const result=service.payerIdentityOptionsFor(context.workspaceId,context.callerIdentityId); if (!result) { res.status(404).json({ error:"Resource not found." }); return; } res.json(result); }),
  setPayerIdentity:context=>safe((req,res)=>{ const body=exact(req.body,["identityId"]); respond(res,service.setPayerIdentity(context.workspaceId,context.callerIdentityId,identityId(body.identityId))); }),
  clearPayerIdentity:context=>safe((req,res)=>{ const body=exact(req.body,["identityId"]); respond(res,service.clearPayerIdentity(context.workspaceId,context.callerIdentityId,identityId(body.identityId))); }),
  checkout:context=>safe(async(req,res)=>{ const body=exact(req.body,["catalogEntryId"]);limit(context); const result=await service.checkout(context.workspaceId,catalogEntryId(body.catalogEntryId),idempotencyKey(req.headers["idempotency-key"])); respond(res,result); }),
  portal:context=>safe(async(req,res)=>{ exact(req.body,[]);limit(context); respond(res,await service.portal(context.workspaceId)); }),
  cancel:context=>safe(async(req,res)=>{ exact(req.body,[]);limit(context); respond(res,await service.cancel(context.workspaceId,idempotencyKey(req.headers["idempotency-key"]))); }),
  reactivate:context=>safe(async(req,res)=>{ exact(req.body,[]);limit(context); respond(res,await service.reactivate(context.workspaceId,idempotencyKey(req.headers["idempotency-key"]))); }),
}; }
