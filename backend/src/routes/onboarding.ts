import { Router } from "express";
import type { RequestHandler } from "express";

export function createOnboardingRouter(controller: RequestHandler): Router {
  const router = Router();
  router.post("/onboard", controller);
  return router;
}
