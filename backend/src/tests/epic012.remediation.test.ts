import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase } from "../config/database.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { CompanyKnowledgeRepository } from "../repositories/companyKnowledgeRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";
import { KnowledgeService } from "../knowledge/services/knowledgeServices.js";
import { KnowledgeDomainError } from "../knowledge/domain/knowledge.js";
import { SystemClock } from "../identity/infrastructure/systemClock.js";
import type { ActorContext } from "../knowledge/domain/actorContext.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../config/migrations.js";
import { WorkerPdfTextExtractor } from "../knowledge/infrastructure/pdfTextExtractor.js";

const extracted={services:["Service"],hours:"Always",locations:["Remote"],faq:[]};
const actor={userId:"usr_timeout",membershipId:"mem_timeout",role:"owner",capabilities:new Set()}as unknown as ActorContext;

test("never-settling and late-settling extraction time out, persist failure, and cannot complete late",async()=>{
  for(const late of[false,true]){
    const db=createDatabase(":memory:"),context=createWorkspaceContext(new WorkspaceRepository(db).resolveDefault()),companies=new CompanyRepository(db),company=companies.create(context,{name:`Timeout ${late}`,website:`https://timeout-${late}.test`}),repository=new CompanyKnowledgeRepository(db);
    const extractor={extract:async()=>late?await new Promise(resolve=>setTimeout(()=>resolve(extracted),40)):await new Promise<never>(()=>{})};
    const service=new KnowledgeService(companies,repository,{acquire:async()=>{throw 0;}},{extract:async()=>{throw 0;}},extractor,new SystemClock(),{extraction:10,ingestion:25});
    await assert.rejects(service.create(context,actor,company.id,"manual_text",{name:"Facts",text:"facts"}),(error:unknown)=>error instanceof KnowledgeDomainError&&error.code==="knowledge_extraction_timeout");
    await new Promise(resolve=>setTimeout(resolve,50));
    const row=db.prepare("SELECT status,failure_code FROM knowledge_source_revisions").get()as{status:string;failure_code:string};assert.equal(row.status,"failed");assert.equal(row.failure_code,"knowledge_extraction_timeout");
    assert.equal(repository.loadPublished(context,company.id),null);db.close();
  }
});

test("A to B to A historical digest is controlled and leaves B current",async()=>{
  const db=createDatabase(":memory:"),context=createWorkspaceContext(new WorkspaceRepository(db).resolveDefault()),companies=new CompanyRepository(db),company=companies.create(context,{name:"History",website:"https://history.test"}),repository=new CompanyKnowledgeRepository(db),service=new KnowledgeService(companies,repository,{acquire:async()=>{throw 0;}},{extract:async()=>{throw 0;}},{extract:async()=>extracted},new SystemClock());
  const a=await service.create(context,actor,company.id,"manual_text",{name:"A",text:"a"}),publishedA=service.publish(context,actor,company.id,{sourceRevisionIds:[a.revision.id],expectedKnowledgeVersionId:null}).version!;
  const b=await service.create(context,actor,company.id,"manual_text",{name:"B",text:"b"}),publishedB=service.publish(context,actor,company.id,{sourceRevisionIds:[b.revision.id],expectedKnowledgeVersionId:publishedA.id}).version!;
  assert.throws(()=>service.publish(context,actor,company.id,{sourceRevisionIds:[a.revision.id],expectedKnowledgeVersionId:publishedB.id}),(error:unknown)=>error instanceof KnowledgeDomainError&&error.code==="knowledge_historical_version_conflict");
  assert.equal(repository.loadCurrentVersion(context,company.id)?.id,publishedB.id);db.close();
});

test("separate SQLite connections map real write contention without partial Knowledge rows",()=>{const directory=mkdtempSync(join(tmpdir(),"atlas-knowledge-lock-")),path=join(directory,"atlas.sqlite"),first=createDatabase(path),second=createDatabase(path);try{second.exec("PRAGMA busy_timeout=1");const context=createWorkspaceContext(new WorkspaceRepository(first).resolveDefault()),company=new CompanyRepository(first).create(context,{name:"Lock",website:"https://lock.test"}),repository=new CompanyKnowledgeRepository(second);first.exec("BEGIN IMMEDIATE");assert.throws(()=>repository.createSourceAndPending(context,company.id,{id:"ksrc_lock",revisionId:"ksrv_lock",kind:"manual_text",name:"Lock",normalizedName:"lock",locator:null,mediaType:"text/plain",inputBytes:1,createdAt:new Date().toISOString()}),(error:unknown)=>error instanceof KnowledgeDomainError&&error.code==="knowledge_temporarily_unavailable");first.exec("ROLLBACK");assert.equal((second.prepare("SELECT COUNT(*) count FROM knowledge_sources WHERE company_id=?").get(company.id)as{count:number}).count,0);}finally{first.close();second.close();rmSync(directory,{recursive:true,force:true});}});

test("exact applied migration 9 upgrades additively through migration 10 without data or checksum drift",()=>{const directory=mkdtempSync(join(tmpdir(),"atlas-migration-10-")),path=join(directory,"atlas.sqlite"),db=new DatabaseSync(path);try{db.exec("PRAGMA foreign_keys=ON");runMigrations(db,9);const before=db.prepare("SELECT checksum FROM schema_migrations WHERE id=9").get()as{checksum:string};assert.equal(before.checksum,"91d87eb541b129067ce2822e3035f7de45b3760b535f918bad25583c5e4a095a");assert.equal((db.prepare("SELECT type FROM sqlite_master WHERE name='company_knowledge'").get()as{type:string}).type,"view");const context=createWorkspaceContext(new WorkspaceRepository(db).resolveDefault()),companies=new CompanyRepository(db),without=companies.create(context,{name:"No publication",website:"https://no-publication.test"});runMigrations(db);assert.equal((db.prepare("SELECT checksum FROM schema_migrations WHERE id=9").get()as{checksum:string}).checksum,before.checksum);assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='company_knowledge'").get(),undefined);assert.equal((db.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='trigger' AND name LIKE 'knowledge_ready_null_text%'").get()as{count:number}).count,2);assert.equal((db.prepare("SELECT COUNT(*) count FROM company_knowledge_publications WHERE company_id=?").get(without.id)as{count:number}).count,0);assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);runMigrations(db);assert.equal((db.prepare("SELECT COUNT(*) count FROM schema_migrations").get()as{count:number}).count,11);}finally{db.close();rmSync(directory,{recursive:true,force:true});}});

test("publication transaction rolls back after every frozen write step",async()=>{
  for(const point of ["version_insert","manifest_insert","publication_write","company_status"] as const){
    const db=createDatabase(":memory:"),context=createWorkspaceContext(new WorkspaceRepository(db).resolveDefault()),companies=new CompanyRepository(db),company=companies.create(context,{name:`Rollback ${point}`,website:`https://${point}.test`});
    const repository=new CompanyKnowledgeRepository(db,p=>{if(p===point)throw new Error(`fault:${point}`);});
    const service=new KnowledgeService(companies,repository,{acquire:async()=>{throw 0;}},{extract:async()=>{throw 0;}},{extract:async()=>extracted},new SystemClock());
    const created=await service.create(context,actor,company.id,"manual_text",{name:"Facts",text:"facts"});
    assert.throws(()=>service.publish(context,actor,company.id,{sourceRevisionIds:[created.revision.id],expectedKnowledgeVersionId:null}),new RegExp(`fault:${point}`));
    assert.equal((db.prepare("SELECT COUNT(*) count FROM company_knowledge_versions").get()as{count:number}).count,0);
    assert.equal((db.prepare("SELECT COUNT(*) count FROM company_knowledge_version_sources").get()as{count:number}).count,0);
    assert.equal((db.prepare("SELECT COUNT(*) count FROM company_knowledge_publications").get()as{count:number}).count,0);
    assert.equal((db.prepare("SELECT status FROM companies WHERE id=?").get(company.id)as{status:string}).status,"processing");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);db.close();
  }
});

test("publication rollback preserves an existing current publication and ready Company",async()=>{
  for(const point of ["version_insert","manifest_insert","publication_write","company_status"] as const){
    const db=createDatabase(":memory:"),context=createWorkspaceContext(new WorkspaceRepository(db).resolveDefault()),companies=new CompanyRepository(db),company=companies.create(context,{name:`Existing ${point}`,website:`https://existing-${point}.test`}),baseRepository=new CompanyKnowledgeRepository(db),baseService=new KnowledgeService(companies,baseRepository,{acquire:async()=>{throw 0;}},{extract:async()=>{throw 0;}},{extract:async()=>extracted},new SystemClock());
    const first=await baseService.create(context,actor,company.id,"manual_text",{name:"First",text:"first"}),published=baseService.publish(context,actor,company.id,{sourceRevisionIds:[first.revision.id],expectedKnowledgeVersionId:null}).version!;
    const second=await baseService.create(context,actor,company.id,"manual_text",{name:"Second",text:"second"}),repository=new CompanyKnowledgeRepository(db,p=>{if(p===point)throw new Error(`fault:${point}`);}),service=new KnowledgeService(companies,repository,{acquire:async()=>{throw 0;}},{extract:async()=>{throw 0;}},{extract:async()=>extracted},new SystemClock());
    const beforeVersions=(db.prepare("SELECT COUNT(*) count FROM company_knowledge_versions").get()as{count:number}).count,beforeManifest=(db.prepare("SELECT COUNT(*) count FROM company_knowledge_version_sources").get()as{count:number}).count;
    assert.throws(()=>service.publish(context,actor,company.id,{sourceRevisionIds:[second.revision.id],expectedKnowledgeVersionId:published.id}),new RegExp(`fault:${point}`));
    assert.equal(repository.loadCurrentVersion(context,company.id)?.id,published.id);assert.equal(companies.findById(context,company.id)?.status,"ready");assert.equal((db.prepare("SELECT COUNT(*) count FROM company_knowledge_versions").get()as{count:number}).count,beforeVersions);assert.equal((db.prepare("SELECT COUNT(*) count FROM company_knowledge_version_sources").get()as{count:number}).count,beforeManifest);assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);db.close();
  }
});

test("PDF containment enforces signature and byte boundaries plus crash timeout and abort",async()=>{
  const okWorker=`const{parentPort}=require('node:worker_threads');parentPort.postMessage({text:'safe',pages:1});`;
  const extractor=new WorkerPdfTextExtractor({workerCode:okWorker});
  const atBoundary=new Uint8Array(1050);atBoundary.set(Buffer.from("%PDF-"),1019);atBoundary.set(Buffer.from("BT\nstartxref\n0\n%%EOF"),1025);
  assert.equal((await extractor.extract(atBoundary,new AbortController().signal)).text,"safe");
  const outside=new Uint8Array(1025);outside.set(Buffer.from("%PDF-"),1020);
  await assert.rejects(extractor.extract(outside,new AbortController().signal),(e:unknown)=>e instanceof KnowledgeDomainError&&e.code==="unsupported_pdf");
  const maximum=new Uint8Array(10*1024*1024);maximum.set(Buffer.from("%PDF-BT"));maximum.set(Buffer.from("startxref\n0\n%%EOF"),maximum.length-20);
  assert.equal((await extractor.extract(maximum,new AbortController().signal)).inputBytes,maximum.byteLength);
  const over=new Uint8Array(maximum.byteLength+1);over.set(Buffer.from("%PDF-"));
  await assert.rejects(extractor.extract(over,new AbortController().signal),(e:unknown)=>e instanceof KnowledgeDomainError&&e.code==="unsupported_pdf");
  const bytes=Buffer.from("%PDF-safe\nBT\nstartxref\n0\n%%EOF");
  await assert.rejects(new WorkerPdfTextExtractor({workerCode:"throw new Error('crash')"}).extract(bytes,new AbortController().signal),(e:unknown)=>e instanceof KnowledgeDomainError&&e.code==="pdf_parse_failed");
  await assert.rejects(new WorkerPdfTextExtractor({workerCode:"setInterval(()=>{},1000)",timeoutMilliseconds:10}).extract(bytes,new AbortController().signal),(e:unknown)=>e instanceof KnowledgeDomainError&&e.code==="pdf_parse_failed");
  const controller=new AbortController(),pending=new WorkerPdfTextExtractor({workerCode:"setInterval(()=>{},1000)"}).extract(bytes,controller.signal);controller.abort();
  await assert.rejects(pending,(e:unknown)=>e instanceof KnowledgeDomainError&&e.code==="pdf_parse_failed");
});
