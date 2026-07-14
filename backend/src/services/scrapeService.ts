import type { WebsiteScraper } from "../types/ports.js";

export class ScrapeService {
  public constructor(private readonly scraper: WebsiteScraper) {}
  public scrape(url: string): Promise<{ markdown?: string }> { return this.scraper.scrape(url); }
}
