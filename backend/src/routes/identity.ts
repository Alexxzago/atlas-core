import { Router, type RequestHandler } from "express";

export function createIdentityRouter(controllers: {
  register: RequestHandler;
  resend: RequestHandler;
  verify: RequestHandler;
  requestEnrollment?:RequestHandler; completeEnrollment?:RequestHandler; login?:RequestHandler; bootstrap?:RequestHandler; refresh?:RequestHandler; current?:RequestHandler; replacePassword?:RequestHandler; logout?:RequestHandler; bootstrapStatus?: RequestHandler; platformBootstrap?: RequestHandler;
}): Router {
  const router = Router();
  router.post("/register", controllers.register);
  router.post("/resend-verification", controllers.resend);
  router.get("/verify-email", controllers.verify);
  if (controllers.bootstrapStatus && controllers.platformBootstrap) {
    router.get("/bootstrap/status", controllers.bootstrapStatus);
    router.post("/bootstrap", controllers.platformBootstrap);
  }
  if(controllers.requestEnrollment&&controllers.completeEnrollment&&controllers.login&&controllers.bootstrap&&controllers.refresh&&controllers.current&&controllers.replacePassword&&controllers.logout){
    router.post("/credential-enrollment/request",controllers.requestEnrollment);router.post("/credential-enrollment/complete",controllers.completeEnrollment);
    router.post("/login",controllers.login);router.post("/session/bootstrap",controllers.bootstrap);router.post("/session/refresh",controllers.refresh);router.get("/me",controllers.current);
    router.post("/password/replace",controllers.replacePassword);router.post("/logout",controllers.logout);
  }
  return router;
}
