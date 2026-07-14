import "dotenv/config";
import { Firecrawl } from "firecrawl";
import type { WebsiteScraper } from "../types/ports.js";

const firecrawl = new Firecrawl({
  apiKey: process.env.FIRECRAWL_API_KEY!,
});

export class FirecrawlProvider implements WebsiteScraper {
  public async scrape(url: string): Promise<{ markdown?: string }> {
    return firecrawl.scrape(url, { formats: ["markdown"] });
  }
}

export const firecrawlProvider = new FirecrawlProvider();
export const scrapeWebsite = (url: string): Promise<{ markdown?: string }> => firecrawlProvider.scrape(url);
