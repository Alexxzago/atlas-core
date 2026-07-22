import { randomBytes, createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { CompanyKnowledgeRepository } from "../repositories/companyKnowledgeRepository.js";
import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import { compileCompanyKnowledge } from "../knowledge/domain/compiler.js";
import { KnowledgeService } from "../knowledge/services/knowledgeServices.js";
import { SystemClock } from "../identity/infrastructure/systemClock.js";
import type { KnowledgeExtractor, WebsiteScraper } from "../types/ports.js";
import { validateCompanyKnowledge } from "../services/knowledgeBuilder.js";

export function publishKnowledgeFixture(database: DatabaseSync, context: WorkspaceContext, companyId: number, knowledge: CompanyKnowledge): void {
  const suffix=randomBytes(16).toString("hex"),sourceId=`ksrc_${suffix}`,revisionId=`ksrv_${suffix}`,now="2026-01-01T00:00:00.000Z";
  const repository=new CompanyKnowledgeRepository(database),extracted={services:knowledge.business.services,hours:knowledge.business.hours,locations:knowledge.business.locations,faq:knowledge.faq};
  repository.createSourceAndPending(context,companyId,{id:sourceId,revisionId,kind:"manual_text",name:`Fixture ${suffix}`,normalizedName:`fixture ${suffix}`,locator:null,mediaType:"text/plain",inputBytes:0,createdAt:now});
  repository.completeRevision(context,companyId,revisionId,{contentDigest:createHash("sha256").update("fixture").digest("hex"),normalizedText:"fixture",extracted,normalizedBytes:7,normalizedCharacters:7,pageCount:null,completedAt:now});
  const company=new CompanyRepository(database).findById(context,companyId);if(!company)throw new Error("Fixture company was not found.");
  const compiled=compileCompanyKnowledge(company,[repository.findRevision(context,companyId,sourceId,revisionId)!]);
  repository.publish(context,companyId,{expectedVersionId:repository.loadCurrentVersion(context,companyId)?.id??null,versionId:`kver_${suffix}`,snapshotDigest:compiled.snapshotDigest,canonicalJson:compiled.canonicalJson,revisionIds:compiled.revisionIds,actorId:"system:test-fixture",at:now});
}

export function frozenKnowledgeFixtureService(database:DatabaseSync,companies:CompanyRepository,scraper:WebsiteScraper,extractor:KnowledgeExtractor,cleaner:(text:string)=>string):KnowledgeService{
  return new KnowledgeService(companies,new CompanyKnowledgeRepository(database),{acquire:async(url)=>{const value=cleaner((await scraper.scrape(url)).markdown??"");if(!value.trim())throw new Error("empty");return{text:value,mediaType:"text/plain",inputBytes:Buffer.byteLength(value),finalUrl:url};}},{extract:async()=>{throw new Error("PDF not configured");}},{extract:async(_kind,text,url)=>{const value=validateCompanyKnowledge(await extractor.extract(text,url??""));return{services:value.business.services,hours:value.business.hours,locations:value.business.locations,faq:value.faq};}},new SystemClock());
}
