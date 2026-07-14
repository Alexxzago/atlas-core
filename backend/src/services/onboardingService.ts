import type { CompanyRepository } from "../repositories/companyRepository.js";
import type { KnowledgeRepository } from "../repositories/knowledgeRepository.js";
import type { CompanyKnowledge } from "../types/companyKnowledge.js";
import type { KnowledgeExtractor, MarkdownDebugStore, WebsiteScraper } from "../types/ports.js";
import { validateCompanyKnowledge } from "./knowledgeBuilder.js";

export class InvalidWebsiteUrlError extends Error {}
export class OnboardingError extends Error {}

export interface OnboardingResult {
  companyId: number;
  status: "ready";
  knowledge: CompanyKnowledge;
}

export class OnboardingService {
  public constructor(
    private readonly companies: CompanyRepository,
    private readonly knowledge: KnowledgeRepository,
    private readonly scraper: WebsiteScraper,
    private readonly extractor: KnowledgeExtractor,
    private readonly cleaner: (markdown: string) => string,
    private readonly debugStore: MarkdownDebugStore
  ) {}

  public async onboard(rawUrl: string): Promise<OnboardingResult> {
    const website = this.normalizeWebsiteUrl(rawUrl);
    const existing = this.companies.findByWebsite(website);
    const processingCompany: {
      name: string;
      website: string;
      phone?: string;
      email?: string;
      status: "processing";
    } = {
      name: existing?.name ?? new URL(website).hostname,
      website,
      status: "processing",
    };
    if (existing) {
      processingCompany.phone = existing.phone;
      processingCompany.email = existing.email;
    }
    const company = this.companies.save(processingCompany);

    try {
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
        company: { ...validated.company, website },
      };

      const updatedCompany = this.companies.save({
        name: finalKnowledge.company.name || new URL(website).hostname,
        website,
        phone: finalKnowledge.company.phone,
        email: finalKnowledge.company.email,
        status: "processing",
      });
      this.knowledge.save(updatedCompany.id, finalKnowledge);
      this.companies.updateStatus(updatedCompany.id, "ready");

      return { companyId: updatedCompany.id, status: "ready", knowledge: finalKnowledge };
    } catch (error: unknown) {
      try {
        this.companies.updateStatus(company.id, "failed");
      } catch {
        // Preserve the original onboarding failure.
      }
      throw new OnboardingError("Unable to onboard company.", { cause: error });
    }
  }

  private normalizeWebsiteUrl(rawUrl: string): string {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) {
      throw new InvalidWebsiteUrlError("A website URL is required.");
    }

    let url: URL;
    try {
      url = new URL(rawUrl.trim());
    } catch {
      throw new InvalidWebsiteUrlError("The website URL is invalid.");
    }

    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
      throw new InvalidWebsiteUrlError("The website URL must use HTTP or HTTPS.");
    }

    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return url.toString().replace(/\/$/, "");
  }
}
