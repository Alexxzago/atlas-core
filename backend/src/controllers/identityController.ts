import type { RequestHandler } from "express";
import { InvalidEmailAddressError } from "../identity/domain/email.js";
import type { Locale } from "../identity/domain/user.js";
import type { RegistrationService } from "../identity/services/registrationService.js";
import type { ResendEmailVerificationService } from "../identity/services/resendEmailVerificationService.js";
import type { VerifyEmailService } from "../identity/services/verifyEmailService.js";
import { AuthenticationConflict, AuthenticationFailure, type AuthenticationService, type SessionGrant } from "../identity/services/authenticationService.js";
import { PasswordPolicyError } from "../identity/domain/authentication.js";
import type { RequestOriginPolicy } from "../identity/infrastructure/requestOriginPolicy.js";
import { EffectiveRequestAuthorityResolver } from "../identity/infrastructure/requestOriginPolicy.js";

function registrationInput(body: unknown): { email: string; locale: Locale } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new InvalidEmailAddressError();
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "email" && key !== "locale")
    || typeof record.email !== "string" || (record.locale !== "en" && record.locale !== "es")) {
    throw new InvalidEmailAddressError();
  }
  return { email: record.email, locale: record.locale };
}

function record(body:unknown):Record<string,unknown>{if(!body||typeof body!=="object"||Array.isArray(body))throw new AuthenticationFailure();return body as Record<string,unknown>;}
function stringField(body:Record<string,unknown>,name:string):string{const value=body[name];if(typeof value!=="string")throw new AuthenticationFailure();return value;}
function cookie(request:Parameters<RequestHandler>[0],name:string):string|null{const header=request.headers.cookie;if(!header)return null;for(const part of header.split(";")){const [key,...rest]=part.trim().split("=");if(key===name)return decodeURIComponent(rest.join("="));}return null;}
const authorityResolver=new EffectiveRequestAuthorityResolver();
function originAllowed(request:Parameters<RequestHandler>[0],policy:RequestOriginPolicy):boolean{const authority=authorityResolver.resolve({protocol:request.protocol,host:request.headers.host});return !!authority&&policy.allows({origin:request.headers.origin,fetchSite:typeof request.headers["sec-fetch-site"]==="string"?request.headers["sec-fetch-site"]:undefined,effectiveProtocol:authority.protocol,effectiveAuthority:authority.authority});}
function cookieValue(service:AuthenticationService,grant:SessionGrant):string{const secure=service.cookieName().startsWith("__Host-");const maxAge=Math.max(0,Math.floor((Date.parse(grant.absoluteExpiresAt)-Date.now())/1000));return `${service.cookieName()}=${encodeURIComponent(grant.rawIdentifier)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?"; Secure":""}`;}
function clearCookie(service:AuthenticationService):string{return `${service.cookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${service.cookieName().startsWith("__Host-")?"; Secure":""}`;}
function safe(handler:RequestHandler):RequestHandler{return async(req,res,next)=>{try{await handler(req,res,next);}catch(error:unknown){if(error instanceof PasswordPolicyError){res.status(400).json({error:"Password does not meet policy."});return;}if(error instanceof AuthenticationConflict){res.status(409).json({error:"Authentication state changed. Try again."});return;}if(error instanceof AuthenticationFailure){res.status(401).json({error:"Authentication failed."});return;}res.status(503).json({error:"Authentication is temporarily unavailable."});}};}

export function createAuthenticationControllers(service:AuthenticationService,originPolicy:RequestOriginPolicy):Record<"requestEnrollment"|"completeEnrollment"|"login"|"bootstrap"|"refresh"|"current"|"replacePassword"|"logout",RequestHandler>{
  const stateChange=(request:Parameters<RequestHandler>[0]):string=>{if(!originAllowed(request,originPolicy))throw new AuthenticationFailure();const raw=cookie(request,service.cookieName());if(!raw||typeof request.headers["x-csrf-token"]!=="string"||!service.validateCsrf(raw,request.headers["x-csrf-token"]))throw new AuthenticationFailure();return raw;};
  return {
    requestEnrollment:safe(async(req,res)=>{const b=record(req.body);await service.requestEnrollment(stringField(b,"email"));res.status(202).json({status:"credential_enrollment_requested"});}),
    completeEnrollment:safe(async(req,res)=>{const b=record(req.body);await service.completeEnrollment(stringField(b,"proof"),stringField(b,"password"),stringField(b,"confirmation"));res.status(204).end();}),
    login:safe(async(req,res)=>{const b=record(req.body);const grant=await service.login(stringField(b,"email"),stringField(b,"password"),req.ip??"unknown");res.setHeader("set-cookie",cookieValue(service,grant));res.status(200).json({status:"authenticated",csrfToken:grant.csrfToken,csrfGeneration:grant.csrfGeneration});}),
    bootstrap:async(req,res)=>{res.setHeader("Cache-Control","no-store, private");res.setHeader("Pragma","no-cache");if(!originAllowed(req,originPolicy)){res.status(403).json({error:"Request not allowed."});return;}let body:Record<string,unknown>;try{body=record(req.body);}catch{res.status(400).json({error:"Invalid request."});return;}if(Object.keys(body).length!==0){res.status(400).json({error:"Invalid request."});return;}const raw=cookie(req,service.cookieName());if(!raw){res.status(401).json({status:"unauthenticated"});return;}try{const result=service.bootstrapSession(raw);res.status(200).json({status:"authenticated",identity:result.identity,csrfToken:result.csrfToken,csrfGeneration:result.csrfGeneration});}catch(error:unknown){if(error instanceof AuthenticationConflict){res.status(409).json({error:"Authentication state changed. Try again."});return;}if(error instanceof AuthenticationFailure){res.setHeader("set-cookie",clearCookie(service));res.status(401).json({status:"unauthenticated"});return;}res.status(503).json({error:"Authentication is temporarily unavailable."});}},
    refresh:safe((req,res)=>{const raw=stateChange(req);const grant=service.refresh(raw);res.setHeader("set-cookie",cookieValue(service,grant));res.json({status:"refreshed",csrfToken:grant.csrfToken});}),
    current:safe((req,res)=>{const raw=cookie(req,service.cookieName());const current=raw?service.current(raw):null;if(!current){res.status(401).json({status:"unauthenticated"});return;}res.json({...current,workspaceAccess:"none"});}),
    replacePassword:safe(async(req,res)=>{const raw=stateChange(req);const b=record(req.body);await service.replacePassword(raw,stringField(b,"currentPassword"),stringField(b,"newPassword"),stringField(b,"confirmation"));res.setHeader("set-cookie",clearCookie(service));res.status(204).end();}),
    logout:async(req,res)=>{const raw=cookie(req,service.cookieName());if(!raw){res.setHeader("set-cookie",clearCookie(service));res.status(204).end();return;}if(!originAllowed(req,originPolicy)){res.status(403).json({error:"Request not allowed."});return;}if(typeof req.headers["x-csrf-token"]!=="string"||!service.validateCsrf(raw,req.headers["x-csrf-token"])){res.status(401).json({error:"Authentication failed."});return;}try{service.logout(raw);res.setHeader("set-cookie",clearCookie(service));res.status(204).end();}catch{res.status(503).json({error:"Authentication is temporarily unavailable."});}},
  };
}

export function createRegistrationController(service: RegistrationService): RequestHandler {
  return async (request, response) => {
    try {
      const input = registrationInput(request.body);
      await service.register(input.email, input.locale);
      response.status(202).json({ status: "verification_requested" });
    } catch (error: unknown) {
      if (error instanceof InvalidEmailAddressError) { response.status(400).json({ error: "Invalid registration input." }); return; }
      response.status(202).json({ status: "verification_requested" });
    }
  };
}

export function createResendVerificationController(service: ResendEmailVerificationService): RequestHandler {
  return async (request, response) => {
    try {
      const input = registrationInput(request.body);
      await service.resend(input.email, input.locale);
      response.status(202).json({ status: "verification_requested" });
    } catch (error: unknown) {
      if (error instanceof InvalidEmailAddressError) { response.status(400).json({ error: "Invalid verification request." }); return; }
      response.status(202).json({ status: "verification_requested" });
    }
  };
}

export function createVerifyEmailController(service: VerifyEmailService): RequestHandler {
  return (request, response) => {
    const proof = request.query.proof;
    if (typeof proof !== "string" || Object.keys(request.query).some((key) => key !== "proof")) {
      response.status(400).json({ status: "invalid_or_expired" });
      return;
    }
    try {
      const result = service.verify(proof);
      response.status(result === "verified" ? 200 : 400).json({ status: result });
    } catch {
      response.status(503).json({ error: "Verification is temporarily unavailable." });
    }
  };
}
