import { Router } from "express";
import type { RequestHandler } from "express";

export interface CompanyControllers {
  list: RequestHandler;
  create: RequestHandler;
  get: RequestHandler;
  update: RequestHandler;
  delete: RequestHandler;
  onboard: RequestHandler;
}

export function createCompaniesRouter(controllers: CompanyControllers): Router {
  const router = Router();
  router.get("/", controllers.list);
  router.post("/", controllers.create);
  router.get("/:companyId", controllers.get);
  router.patch("/:companyId", controllers.update);
  router.delete("/:companyId", controllers.delete);
  router.post("/:companyId/onboard", controllers.onboard);
  return router;
}
