import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express, { raw, type RequestHandler } from "express";
import { createAuthorizedCompaniesRouter } from "../routes/authorizedCompanies.js";

test("unauthorized and invalid-CSRF PDF requests are rejected before raw buffering",async()=>{
  let parserInvocations=0;
  const parse=raw({type:"application/pdf",limit:"10mb"});
  const pdfBodyParser:RequestHandler=(req,res,next)=>{parserInvocations++;parse(req,res,next);};
  const accepted:RequestHandler=(req,res)=>{assert.ok(Buffer.isBuffer(req.body));res.status(201).json({ok:true});};
  const noop:RequestHandler=(_req,res)=>res.status(501).end();
  const app=express();
  app.use("/workspaces",createAuthorizedCompaniesRouter({
    authentication:{cookieName:()=>"atlas",current:(rawId:string)=>rawId==="valid"?{userId:"usr_a"}:null,validateCsrf:(_raw:string,csrf:string)=>csrf==="valid"} as never,
    users:{findById:()=>({id:"usr_a"})} as never,
    authorization:{authorize:()=>({userId:"usr_a",membershipId:"mem_a",role:"owner",capabilities:new Set(["knowledge:ingest"]),workspaceId:"wsp_a"})} as never,
    resolver:{resolve:()=>({workspaceId:"wsp_a",workspaceKey:"a"})} as never,
    controllers:{list:()=>noop,create:()=>noop,get:()=>noop,update:()=>noop,delete:()=>noop,onboard:()=>noop},
    assistantControllers:{list:()=>noop,create:()=>noop,get:()=>noop,update:()=>noop,transition:()=>noop,preview:()=>noop},
    knowledgeControllers:{createPdf:()=>accepted} as never,pdfBodyParser,
  }));
  const listener=app.listen(0,"127.0.0.1");await new Promise<void>((resolve,reject)=>{listener.once("listening",resolve);listener.once("error",reject);});
  const origin=`http://127.0.0.1:${(listener.address()as AddressInfo).port}`,url=`${origin}/workspaces/wsp_public/companies/1/knowledge/sources/pdf?name=Facts`,body=Buffer.from("%PDF-safe");
  try{
    for(const headers of [{"content-type":"application/pdf"},{"content-type":"application/pdf",cookie:"atlas=valid",origin,"x-csrf-token":"wrong","sec-fetch-site":"same-origin"}]){
      const response=await fetch(url,{method:"POST",headers,body});assert.equal(response.status,404);assert.equal(response.headers.get("cache-control"),"no-store, private");assert.equal(response.headers.get("pragma"),"no-cache");assert.deepEqual(await response.json(),{error:"Resource not found."});
    }
    assert.equal(parserInvocations,0);
    const response=await fetch(url,{method:"POST",headers:{"content-type":"application/pdf",cookie:"atlas=valid",origin,"x-csrf-token":"valid","sec-fetch-site":"same-origin"},body});assert.equal(response.status,201);assert.equal(parserInvocations,1);assert.deepEqual(await response.json(),{ok:true});
  }finally{await new Promise<void>(resolve=>listener.close(()=>resolve()));}
});
