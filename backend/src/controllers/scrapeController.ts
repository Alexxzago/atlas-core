import type { RequestHandler } from "express";
import type { ScrapeService } from "../services/scrapeService.js";

export function createScrapeController(service: ScrapeService): RequestHandler {
  return async (req, res): Promise<void> => {
    const { url } = req.body ?? {};
    if (typeof url !== "string" || !url.trim()) {
      res.status(400).json({ error: "URL is required." });
      return;
    }
    try {
      res.json(await service.scrape(url.trim()));
    } catch (error: unknown) {
      console.error("Website scrape failed.", error);
      res.status(500).json({ error: "Unable to scrape website." });
    }
  };
}
