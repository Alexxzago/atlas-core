import type { CompanyRepositoryPort, KnowledgeRepositoryPort } from "../application/ports/repositories.js";
import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { KnowledgeExtractor, MarkdownDebugStore, WebsiteScraper } from "../types/ports.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import {
  CompanyNotFoundError,
  DuplicateWebsiteError,
  normalizeWebsiteUrl,
  parseCompanyId,
} from "./companyValidation.js";
import type { KnowledgeService as FrozenKnowledgeService } from "../knowledge/services/knowledgeServices.js";
import type { ActorContext } from "../knowledge/domain/actorContext.js";
import { createSystemActorContext } from "../knowledge/domain/actorContext.js";
import { KnowledgeDomainError } from "../knowledge/domain/knowledge.js";

export class OnboardingError extends Error {}

export interface OnboardingResult {
  companyId: number;
  status: "ready";
  knowledge: CompanyKnowledge;
}

export class OnboardingService {
  public constructor(
    private readonly companies: CompanyRepositoryPort,
    private readonly knowledge: KnowledgeRepositoryPort,
    private readonly scraper: WebsiteScraper,
    private readonly extractor: KnowledgeExtractor,
    private readonly cleaner: (markdown: string) => string,
    private readonly debugStore: MarkdownDebugStore,
    private readonly frozenKnowledge?: FrozenKnowledgeService,
  ) {}

  public async onboard(context: WorkspaceContext, companyIdValue: unknown, rawUrl: unknown, actor?: ActorContext): Promise<OnboardingResult> {
    const companyId = parseCompanyId(companyIdValue);
    const website = normalizeWebsiteUrl(rawUrl);
    const company = this.companies.findById(context, companyId);
    if (!company) throw new CompanyNotFoundError("Company was not found.");
    const existingPublishedKnowledge = this.knowledge.load(context, companyId);

    const websiteOwner = this.companies.findByWebsite(context, website);
    if (websiteOwner && websiteOwner.id !== company.id) {
      throw new DuplicateWebsiteError("A company already uses this website.");
    }
    if (!this.frozenKnowledge) throw new OnboardingError("Frozen Knowledge service is required.");
    return this.frozenOnboard(context, company, website, actor??createSystemActorContext("legacy-onboarding"),existingPublishedKnowledge!==null);
  }

  private async frozenOnboard(context:WorkspaceContext,company:import("../types/company.js").Company,website:string,actor:ActorContext,hadPublishedKnowledge:boolean):Promise<OnboardingResult>{
    const updated=this.companies.update(context,company.id,{...company,website,status:company.status});if(!updated)throw new CompanyNotFoundError("Company was not found.");
    try{
      const sources=this.frozenKnowledge!.list(context,company.id);const existing=sources.find(item=>item.name==="Website onboarding"&&item.kind==="public_url"&&item.status==="active");
      const result=existing?await this.frozenKnowledge!.revise(context,actor,company.id,existing.id,"public_url",{url:website,expectedSourceVersion:existing.version}):await this.frozenKnowledge!.create(context,actor,company.id,"public_url",{name:"Website onboarding",url:website});
      let current=null;try{current=this.frozenKnowledge!.current(context,company.id);}catch(error:unknown){if(!(error instanceof KnowledgeDomainError)||error.code!=="knowledge_unavailable")throw error;}
      const publication=this.frozenKnowledge!.publish(context,actor,company.id,{sourceRevisionIds:[result.revision.id],expectedKnowledgeVersionId:current?.id??null});
      return{companyId:company.id,status:"ready",knowledge:publication.version!.knowledge};
    }catch(error:unknown){if(!hadPublishedKnowledge)this.companies.updateStatus(context,company.id,"failed");throw new OnboardingError("Unable to onboard company.",{cause:error});}
  }

}
