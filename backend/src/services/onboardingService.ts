import type { CompanyRepositoryPort, KnowledgeRepositoryPort } from "../application/ports/repositories.js";
import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { KnowledgeExtractor, MarkdownDebugStore, WebsiteScraper } from "../types/ports.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import { validateCompanyKnowledge } from "./knowledgeBuilder.js";
import {
  CompanyNotFoundError,
  DuplicateWebsiteError,
  normalizeWebsiteUrl,
  parseCompanyId,
} from "./companyValidation.js";

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
    private readonly debugStore: MarkdownDebugStore
  ) {}

  public async onboard(context: WorkspaceContext, companyIdValue: unknown, rawUrl: unknown): Promise<OnboardingResult> {
    const companyId = parseCompanyId(companyIdValue);
    const website = normalizeWebsiteUrl(rawUrl);
    const company = this.companies.findById(context, companyId);
    if (!company) throw new CompanyNotFoundError("Company was not found.");

    const websiteOwner = this.companies.findByWebsite(context, website);
    if (websiteOwner && websiteOwner.id !== company.id) {
      throw new DuplicateWebsiteError("A company already uses this website.");
    }

    const processingCompany = this.companies.update(context, company.id, {
      ...company,
      website,
      status: "processing",
    });
    if (!processingCompany) throw new CompanyNotFoundError("Company was not found.");

    try {
      // A retry invalidates the previous snapshot. It must not be served as if
      // it were knowledge refreshed by this onboarding attempt.
      this.knowledge.delete(context, company.id);
      const scrapeResult = await this.scraper.scrape(website);
      if (!scrapeResult.markdown?.trim()) {
        throw new Error("Website scraper returned no content.");
      }

      const cleanedMarkdown = this.cleaner(scrapeResult.markdown);
      if (!cleanedMarkdown.trim()) {
        throw new Error("Website content is empty after cleaning.");
      }

      await this.debugStore.save(company.id, cleanedMarkdown);
      const extracted = await this.extractor.extract(cleanedMarkdown, website);
      const validated = validateCompanyKnowledge(extracted);
      const finalKnowledge: CompanyKnowledge = {
        ...validated,
        company: {
          name: validated.company.name || processingCompany.name,
          website,
          phone: validated.company.phone || processingCompany.phone,
          email: validated.company.email || processingCompany.email,
        },
      };

      const updatedCompany = this.companies.update(context, company.id, {
        name: finalKnowledge.company.name,
        website,
        phone: finalKnowledge.company.phone,
        email: finalKnowledge.company.email,
        status: "processing",
      });
      if (!updatedCompany) throw new Error("Company disappeared during onboarding.");
      if (!this.knowledge.save(context, updatedCompany.id, finalKnowledge)) {
        throw new Error("Company knowledge could not be saved in the workspace.");
      }
      this.companies.updateStatus(context, updatedCompany.id, "ready");

      return { companyId: updatedCompany.id, status: "ready", knowledge: finalKnowledge };
    } catch (error: unknown) {
      try {
        this.companies.updateStatus(context, company.id, "failed");
      } catch (statusError: unknown) {
        throw new OnboardingError("Onboarding failed and company status could not be updated.", {
          cause: new AggregateError([error, statusError]),
        });
      }
      throw new OnboardingError("Unable to onboard company.", { cause: error });
    }
  }

}
