import type { RequestHandler } from "express";
import type { KnowledgeService } from "../services/knowledgeService.js";

export function createKnowledgeController(service: KnowledgeService): RequestHandler {
  return (req, res): void => {
    const companyId = Number(req.query.companyId);
    if (!Number.isInteger(companyId) || companyId <= 0) {
      res.status(400).json({ error: "A positive companyId is required." });
      return;
    }
    const knowledge = service.get(companyId);
    if (!knowledge) {
      res.status(404).json({ error: "Company knowledge was not found." });
      return;
    }
    res.json(knowledge);
  };
}
