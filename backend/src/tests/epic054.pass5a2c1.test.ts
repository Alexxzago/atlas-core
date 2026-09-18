import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createAsyncAssistantPersistence } from "../assistant/infrastructure/asyncAssistantFactory.js";
import { createCompany, type Company } from "../company/domain/company.js";
import type { CompanyEvent } from "../company/application/ports.js";
import { createAsyncWorkspaceCompanyPersistence } from "../company/infrastructure/asyncCompanyFactory.js";
import { runFreshAsyncMigrations } from "../config/asyncMigrations.js";
import { LocalSqlDatabase, type SqlDatabase } from "../config/sqlDatabase.js";
import { createAsyncKnowledgePersistence } from "../knowledge/infrastructure/asyncKnowledgeFactory.js";
import { assistantCapabilityKey } from "../assistant/domain/assistantCapability.js";
import { assistantProfileId, reconstructAssistantProfile } from "../assistant/domain/assistantProfile.js";

const at="2026-09-17T12:00:00.000Z", context={workspaceId:1,workspaceKey:"default"};
function event(company:Company):CompanyEvent{return{id:"evt-pass5a2c1",type:"CompanyCreated",aggregateVersion:company.version,sequence:1,occurredAt:at,actorId:null,payload:{companyId:company.id}};}

test("EPIC054 PASS5A2C1 persists Assistant configuration, capabilities, defaults, and readiness asynchronously",async()=>{
  const underlying=new LocalSqlDatabase(new DatabaseSync(":memory:")),events:string[]=[];
  const database:SqlDatabase={execute:(sql,args)=>underlying.execute(sql,args),executeScript:script=>underlying.executeScript(script),query:async(sql,args)=>{await new Promise<void>(resolve=>setImmediate(resolve));events.push("query");return underlying.query(sql,args);},transaction:operation=>underlying.transaction(()=>operation(database)),close:()=>underlying.close()};
  try{
    await runFreshAsyncMigrations(database);
    const company=createCompany({id:5421,workspaceId:1,identity:{name:"Async Persistence",slug:"async-persistence",website:"https://async-persistence.test"},createdAt:at});
    assert.equal((await createAsyncWorkspaceCompanyPersistence(database).companies.createWithEvents(context,company,[event(company)])).status,"created");
    const assistants=createAsyncAssistantPersistence(database),profile=reconstructAssistantProfile({id:assistantProfileId("asp_00000000000000000000000000005421"),companyId:5421,name:"Atlas",normalizedName:"atlas",description:null,businessRole:null,objective:null,audience:null,tone:"friendly",assistantLanguage:"en",welcomeMessage:null,fallbackMessage:"A human will help.",status:"ready",createdAt:at,updatedAt:at,archivedAt:null});
    events.length=0;const turn=new Promise<void>(resolve=>setImmediate(()=>{events.push("event-loop");resolve();}));
    assert.equal((await assistants.profiles.listActive(context,5421))?.length,0);await turn;assert.equal(events[0],"event-loop");assert.equal(events.filter(event=>event==="query").length,2);
    assert.equal((await assistants.profiles.create(context,5421,profile))?.id,profile.id);
    await database.execute("INSERT INTO users(id,status,full_name,locale,created_at,updated_at) VALUES(?,?,?,?,?,?)",["actor-pass5a2c1","active",null,"en",at,at]);
    assert.equal(await assistants.capabilities.replaceForProfile(context,5421,profile.id,[assistantCapabilityKey("live_data.read")],"actor-pass5a2c1",at),true);
    assert.deepEqual(await assistants.capabilities.listForProfile(context,5421,profile.id),[assistantCapabilityKey("live_data.read")]);
    assert.equal((await assistants.defaults.assign(context,{workspaceId:1,companyId:5421,assistantProfileId:profile.id,version:1,assignedAt:at,updatedAt:at,assignedByActorId:null,source:"test"},null))?.assistantProfileId,profile.id);
    await assistants.readiness.create(context,{id:"ard-pass5a2c1",assistantIdentifier:"default",workspaceId:1,companyId:5421,status:"blocked",blockers:["published_knowledge_missing"],knowledgeVersionId:null,assistantProfileId:profile.id,whatsAppConnectionId:null,policyVersion:"assistant-readiness-v1",configurationDigest:"digest",evaluatedAt:at});
    assert.equal((await assistants.readiness.findLatest(context,5421,null))?.id,"ard-pass5a2c1");
  }finally{await database.close();}
});

test("EPIC054 PASS5A2C1 persists Knowledge source completion and publication asynchronously",async()=>{
  const database=new LocalSqlDatabase(new DatabaseSync(":memory:"));
  try{
    await runFreshAsyncMigrations(database);
    const company=createCompany({id:5422,workspaceId:1,identity:{name:"Async Knowledge",slug:"async-knowledge",website:"https://async-knowledge.test"},createdAt:at});
    await createAsyncWorkspaceCompanyPersistence(database).companies.createWithEvents(context,company,[{...event(company),id:"evt-pass5a2c1-knowledge"}]);
    const repository=createAsyncKnowledgePersistence(database).knowledge,created=await repository.createSourceAndPending(context,5422,{id:"ksrc-pass5a2c1",revisionId:"ksrv-pass5a2c1",kind:"manual_text",name:"Facts",normalizedName:"facts",locator:null,mediaType:"text/plain",inputBytes:5,createdAt:at});
    assert.equal(created.revision.status,"pending");
    assert.equal((await database.query<{count:number}>("SELECT COUNT(*) count FROM knowledge_source_revisions r JOIN knowledge_sources s ON s.id=r.source_id JOIN companies co ON co.id=s.company_id WHERE r.id=? AND r.status='pending' AND co.workspace_id=? AND co.id=?",[created.revision.id,1,5422]))[0]?.count,1);
    assert.equal(await repository.completeRevision(context,5422,created.revision.id,{contentDigest:"digest",normalizedText:"facts",extracted:{services:["Sales"],hours:"Always",locations:[],faq:[]},normalizedBytes:5,normalizedCharacters:5,pageCount:null,completedAt:at}),true);
    const canonicalJson=JSON.stringify({company:{name:"Async Knowledge",website:"https://async-knowledge.test/",phone:"",email:""},business:{services:["Sales"],hours:"Always",locations:[]},faq:[]});
    const published=await repository.publish(context,5422,{expectedVersionId:null,versionId:"kver-pass5a2c1",snapshotDigest:"snapshot",canonicalJson,revisionIds:[created.revision.id],actorId:"actor",at});
    assert.equal(published.status,"created");assert.equal((await repository.loadPublished(context,5422))?.business.hours,"Always");
  }finally{await database.close();}
});
