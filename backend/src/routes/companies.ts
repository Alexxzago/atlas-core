import { Router } from "express";
import type { RequestHandler } from "express";

export function createCompaniesRouter(list: RequestHandler, create: RequestHandler): Router {
  const router = Router();
  router.get("/", list);
  router.post("/", create);
  return router;
}
