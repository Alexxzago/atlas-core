import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createPlatformPilotReadinessController } from "../controllers/platformPilotReadinessController.js";
import { PlatformPilotReadinessService } from "../platformAdmin/services/platformPilotReadinessService.js";
import { createPlatformAdminRouter } from "../routes/platformAdmin.js";

test("EPIC053 PASS4 projects authoritative readiness as safe aggregates and isolates unavailable companies",async()=>{
  const service=new PlatformPilotReadinessService({workspaceContext:(id:string)=>id==="wsp_test"?{workspaceId:1,workspaceKey:"test"}:null,readinessCompanies:()=>[{id:1,name:"Ready"},{id:2,name:"Unavailable"}]} as never,{get:async(_context:unknown,id:number)=>{if(id===2)throw new Error("provider failure");return{overall:"pilot_ready",classification:"pilot_ready",evaluatedAt:"2026-01-01T00:00:00.000Z",checks:[{id:"web_chat",required:false,status:"complete",owner:null,reasonCode:null}],nextAction:null,policyVersion:"pilot-readiness-v1"};}} as never);
  const result=await service.workspace("wsp_test");
  assert.deepEqual(result.aggregate,{totalCompanies:2,pilotReady:1,notReady:0,unavailable:1});
  assert.deepEqual(result.companies[0],{companyId:1,companyName:"Ready",state:"available",overall:"pilot_ready",classification:"pilot_ready",evaluatedAt:"2026-01-01T00:00:00.000Z",issues:[]});
  assert.deepEqual(result.companies[1],{companyId:2,companyName:"Unavailable",state:"unavailable"});
  assert.equal(JSON.stringify(result).toLowerCase().includes("nextaction"),false);
  assert.equal(JSON.stringify(result).toLowerCase().includes("provider"),false);
  await assert.rejects(service.workspace("wsp_missing"));
});

test("EPIC053 PASS4 exposes platform readiness only through non-disclosing admin authorization",async()=>{const app=express(),projection={aggregate:{totalCompanies:1,pilotReady:0,notReady:1,unavailable:0},companies:[{companyId:1,companyName:"Demo",state:"available" as const,overall:"not_ready" as const,classification:"setup_incomplete" as const,evaluatedAt:"2026-01-01T00:00:00.000Z",issues:[{id:"published_knowledge",required:true,status:"incomplete" as const,owner:"customer" as const,reasonCode:"published_knowledge_missing"}]}]};app.use("/admin",createPlatformAdminRouter({cookieName:()=>"atlas",current:(raw:string)=>raw==="ok"?{userId:"usr_admin"}:null,validateCsrf:()=>false}as never,{isPlatformAdministrator:(id:string)=>id==="usr_admin"}as never,{workspacePilotReadiness:createPlatformPilotReadinessController({workspace:async()=>projection}as never)}as never));const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));const origin=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;try{const response=await fetch(`${origin}/admin/workspaces/wsp_test/pilot-readiness`,{headers:{cookie:"atlas=ok"}});assert.equal(response.status,200);const body=await response.json()as {data:unknown};assert.deepEqual(body.data,projection);const serialized=JSON.stringify(body).toLowerCase();for(const forbidden of["nextaction","actionpath","token","credential","provider","secret"])assert.equal(serialized.includes(forbidden),false);assert.equal((await fetch(`${origin}/admin/workspaces/wsp_test/pilot-readiness`)).status,404);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}});
