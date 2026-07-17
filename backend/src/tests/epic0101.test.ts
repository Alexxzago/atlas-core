import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createDatabase } from "../config/database.js";
import type { Clock, CredentialEnrollmentDeliveryPort, CredentialEnrollmentDeliveryRequest } from "../identity/application/ports.js";
import { reconstructUser } from "../identity/domain/user.js";
import { ExactRequestOriginPolicy, type RequestOriginPolicy } from "../identity/infrastructure/requestOriginPolicy.js";
import { SecureRandomProvider, ScryptPasswordProvider, Sha256CredentialEnrollmentHashProvider, Sha256SessionIdentifierProvider } from "../identity/infrastructure/securityProviders.js";
import { AuthenticationFailure, AuthenticationService } from "../identity/services/authenticationService.js";
import { SqliteAuthenticationTransaction } from "../repositories/identityTransaction.js";
import { UserRepository } from "../repositories/userRepository.js";
import { createAuthenticationControllers } from "../controllers/identityController.js";
import { createIdentityRouter } from "../routes/identity.js";

class MutableClock implements Clock { public value="2026-07-17T12:00:00.000Z";public now():string{return this.value;} }
class Delivery implements CredentialEnrollmentDeliveryPort { public request:CredentialEnrollmentDeliveryRequest|null=null;public async deliver(request:CredentialEnrollmentDeliveryRequest){this.request=request;return "accepted" as const;} }

async function setup(){
  const database=createDatabase(":memory:"),clock=new MutableClock(),delivery=new Delivery();
  new UserRepository(database).create(reconstructUser({id:"usr_bootstrap",status:"active",locale:"es",authenticationIdentities:[{id:"aid_bootstrap",email:"person@example.com",normalizedEmail:"person@example.com",emailVerified:true,createdAt:clock.now(),updatedAt:clock.now()}],createdAt:clock.now(),updatedAt:clock.now()}));
  const service=new AuthenticationService(new SqliteAuthenticationTransaction(database),new SecureRandomProvider(),new Sha256CredentialEnrollmentHashProvider(),new ScryptPasswordProvider(),new Sha256SessionIdentifierProvider(),clock,delivery,"http://localhost:5173",false);
  await service.requestEnrollment("person@example.com");const proof=new URL(delivery.request!.enrollmentUrl).searchParams.get("proof")!;
  await service.completeEnrollment(proof,"safe bootstrap password","safe bootstrap password");
  return{database,clock,service,grant:await service.login("person@example.com","safe bootstrap password","loopback")};
}

test("migration adds positive CSRF generation without changing Session identifiers",async()=>{const{database,grant}=await setup();const row=database.prepare("SELECT csrf_generation,identifier_digest FROM sessions").get()as{csrf_generation:number;identifier_digest:string};assert.equal(row.csrf_generation,1);assert.equal(JSON.stringify(row).includes(grant.rawIdentifier),false);assert.throws(()=>database.prepare("UPDATE sessions SET csrf_generation=0").run());database.close();});

test("bootstrap preserves Session ID, rotates CSRF, increments generation and extends only idle expiry",async()=>{const{database,clock,service,grant}=await setup();const before=database.prepare("SELECT identifier_digest,csrf_digest,idle_expires_at,absolute_expires_at FROM sessions WHERE state='active'").get()as Record<string,unknown>;clock.value="2026-07-17T12:10:00.000Z";const result=service.bootstrapSession(grant.rawIdentifier);const after=database.prepare("SELECT identifier_digest,csrf_digest,csrf_generation,idle_expires_at,absolute_expires_at FROM sessions WHERE state='active'").get()as Record<string,unknown>;assert.equal(result.identity.email,"person@example.com");assert.equal(result.csrfGeneration,2);assert.equal(service.validateCsrf(grant.rawIdentifier,grant.csrfToken),false);assert.equal(service.validateCsrf(grant.rawIdentifier,result.csrfToken),true);assert.equal(after.identifier_digest,before.identifier_digest);assert.notEqual(after.csrf_digest,before.csrf_digest);assert.equal(after.csrf_generation,2);assert.notEqual(after.idle_expires_at,before.idle_expires_at);assert.equal(after.absolute_expires_at,before.absolute_expires_at);database.close();});

test("bootstrap rejects logout, expiry and credential mismatch",async()=>{const first=await setup();first.service.logout(first.grant.rawIdentifier);assert.throws(()=>first.service.bootstrapSession(first.grant.rawIdentifier),AuthenticationFailure);first.database.close();const expired=await setup();expired.clock.value="2026-07-18T12:00:00.000Z";assert.throws(()=>expired.service.bootstrapSession(expired.grant.rawIdentifier),AuthenticationFailure);expired.database.close();const mismatch=await setup();mismatch.database.prepare("UPDATE password_credentials SET credential_version=2 WHERE state='active'").run();assert.throws(()=>mismatch.service.bootstrapSession(mismatch.grant.rawIdentifier),AuthenticationFailure);mismatch.database.close();});

test("RequestOriginPolicy freezes exact Origin and Fetch Metadata behavior",()=>{const production=new ExactRequestOriginPolicy(["https://app.example.com"],true),base={origin:"https://app.example.com",effectiveProtocol:"https" as const,effectiveAuthority:"app.example.com"};assert.equal(production.allows({...base,fetchSite:"same-origin"}),true);assert.equal(production.allows({...base,fetchSite:undefined}),true);assert.equal(production.allows({...base,fetchSite:"none"}),true);assert.equal(production.allows({...base,fetchSite:"same-site"}),false);assert.equal(production.allows({...base,fetchSite:"cross-site"}),false);assert.equal(production.allows({...base,origin:undefined,fetchSite:"same-origin"}),false);assert.equal(production.allows({...base,origin:"https://evil.example.com",fetchSite:"same-origin"}),false);const development=new ExactRequestOriginPolicy(["http://localhost:5173"],false);assert.equal(development.allows({origin:"http://localhost:5173",fetchSite:"same-origin",effectiveProtocol:"http",effectiveAuthority:"localhost:5173"}),true);});

test("bootstrap HTTP contract is no-store, generic, empty-body only, and exposes no tenant or Session fields",async()=>{
  const{database,service,grant}=await setup();const allow={allows:()=>true} satisfies RequestOriginPolicy;
  const authentication=createAuthenticationControllers(service,allow);const noop=((_request:unknown,response:{status:(value:number)=>{json:(body:unknown)=>void}}):void=>{response.status(501).json({});}) as never;
  const app=express();app.set("etag",false);app.use(express.json());app.use("/identity",createIdentityRouter({register:noop,resend:noop,verify:noop,...authentication}));
  const listener=app.listen(0,"127.0.0.1");await new Promise<void>((resolve,reject)=>{listener.once("listening",resolve);listener.once("error",reject);});
  const address=listener.address()as AddressInfo,origin=`http://127.0.0.1:${address.port}`,cookie=`${service.cookieName()}=${encodeURIComponent(grant.rawIdentifier)}`;
  try{
    const response=await fetch(`${origin}/identity/session/bootstrap`,{method:"POST",headers:{"content-type":"application/json",cookie,origin,"sec-fetch-site":"same-origin"},body:"{}"});
    assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store, private");assert.equal(response.headers.get("pragma"),"no-cache");assert.equal(response.headers.get("etag"),null);
    const body=await response.json()as Record<string,unknown>;assert.equal(body.status,"authenticated");assert.equal(typeof body.csrfToken,"string");assert.equal(body.csrfGeneration,2);assert.equal("sessionId"in body,false);assert.equal("workspace"in body,false);assert.equal("company"in body,false);
    assert.equal((await fetch(`${origin}/identity/session/bootstrap`,{method:"POST",headers:{"content-type":"application/json",origin},body:"{}"})).status,401);
    assert.equal((await fetch(`${origin}/identity/session/bootstrap`,{method:"POST",headers:{"content-type":"application/json",cookie,origin},body:'{"unexpected":true}'})).status,400);
  }finally{await new Promise<void>((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));database.close();}
});
