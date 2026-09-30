import { Router, type RequestHandler } from "express";
import type { AuthenticationService } from "../identity/services/authenticationService.js";
import type { UserId } from "../identity/domain/user.js";
import type { GoogleCalendarOAuthService } from "../integrations/application/googleCalendarOAuth.js";

export function createGoogleCalendarOAuthCallbackRouter(authentication: AuthenticationService, service: GoogleCalendarOAuthService, portalOrigin: string): Router {
  const router = Router();
  router.get("/callback", callback(authentication, service, portalOrigin));
  return router;
}

function callback(authentication: AuthenticationService, service: GoogleCalendarOAuthService, portalOrigin: string): RequestHandler {
  return (request, response): void => {
    response.setHeader("Cache-Control", "no-store, private");
    response.setHeader("Pragma", "no-cache");
    const raw = cookie(request.headers.cookie, authentication.cookieName()), state = typeof request.query.state === "string" ? request.query.state : "", code = typeof request.query.code === "string" ? request.query.code : "";
    void (async (): Promise<void> => {
      const actor = raw ? await authentication.current(raw) : null;
      const completed = actor ? await service.completeCallback(actor.userId as UserId, state, code) : null;
      // This fixed portal path intentionally carries no OAuth parameters or outcome details.
      const companyId = completed?.companyId;
      const target = new URL(companyId ? `/companies/${companyId}/assistant` : "/companies", portalOrigin);
      response.redirect(303, target.toString());
    })().catch(() => response.redirect(303, new URL("/companies", portalOrigin).toString()));
  };
}
function cookie(header: string | undefined, name: string): string | null { if (!header) return null; for (const entry of header.split(";")) { const [key, ...value] = entry.trim().split("="); if (key === name) return value.join("="); } return null; }
