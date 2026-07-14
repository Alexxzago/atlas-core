import { Router } from "express";
import type { RequestHandler } from "express";

export function createChatRouter(controller: RequestHandler): Router {
  const router = Router();
  router.post("/chat", controller);
  return router;
}
