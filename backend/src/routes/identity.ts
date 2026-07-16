import { Router, type RequestHandler } from "express";

export function createIdentityRouter(controllers: {
  register: RequestHandler;
  resend: RequestHandler;
  verify: RequestHandler;
}): Router {
  const router = Router();
  router.post("/register", controllers.register);
  router.post("/resend-verification", controllers.resend);
  router.get("/verify-email", controllers.verify);
  return router;
}
