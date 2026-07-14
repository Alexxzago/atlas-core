import { Router } from "express";
import type { RequestHandler } from "express";

export function createScrapeRouter(controller: RequestHandler): Router {
  const router = Router();
  router.post("/scrape", controller);
  return router;
}
