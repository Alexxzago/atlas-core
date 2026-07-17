import { Router, type Request, type RequestHandler } from "express";
import type { UserRepositoryPort } from "../application/ports/repositories.js";
import type { AuthenticationService } from "../identity/services/authenticationService.js";
import type { UserId } from "../identity/domain/user.js";
import type { Permission } from "../workspace/domain/membership.js";
import { AuthorizationService } from "../workspace/services/authorizationService.js";
import { WorkspaceResolver } from "../workspace/services/workspaceResolver.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

interface ContextualControllers {
  list: (context: WorkspaceContext) => RequestHandler;
  create: (context: WorkspaceContext) => RequestHandler;
  get: (context: WorkspaceContext) => RequestHandler;
  update: (context: WorkspaceContext) => RequestHandler;
  delete: (context: WorkspaceContext) => RequestHandler;
  onboard: (context: WorkspaceContext) => RequestHandler;
}

interface ContextualAssistantControllers {
  list: (context: WorkspaceContext) => RequestHandler;
  create: (context: WorkspaceContext) => RequestHandler;
  get: (context: WorkspaceContext) => RequestHandler;
  update: (context: WorkspaceContext) => RequestHandler;
  transition: (context: WorkspaceContext) => RequestHandler;
  preview: (context: WorkspaceContext) => RequestHandler;
}

interface AuthorizedCompanyDependencies {
  authentication: AuthenticationService;
  users: UserRepositoryPort;
  authorization: AuthorizationService;
  resolver: WorkspaceResolver;
  controllers: ContextualControllers;
  assistantControllers: ContextualAssistantControllers;
}

function rawCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function workspaceId(req: Request): string {
  const value = req.params.workspaceId;
  if (typeof value !== "string") throw new Error("not found");
  return value;
}

function exactOrigin(req: Request): boolean {
  try {
    return typeof req.headers.origin === "string"
      && new URL(req.headers.origin).origin === `${req.protocol}://${req.headers.host}`;
  } catch { return false; }
}

export function createAuthorizedCompaniesRouter(dependencies: AuthorizedCompanyDependencies): Router {
  const router = Router();
  const authorize = (
    permission: Permission,
    changing: boolean,
    controller: (context: WorkspaceContext) => RequestHandler,
  ): RequestHandler => async (req, res, next): Promise<void> => {
    try {
      const raw = rawCookie(req, dependencies.authentication.cookieName());
      const identity = raw ? dependencies.authentication.current(raw) : null;
      if (!raw || !identity) throw new Error();
      if (changing) {
        const csrf = req.headers["x-csrf-token"];
        const fetchSite = req.headers["sec-fetch-site"];
        if (!exactOrigin(req) || typeof csrf !== "string" || fetchSite === "same-site" || fetchSite === "cross-site"
          || !dependencies.authentication.validateCsrf(raw, csrf)) throw new Error();
      }
      const user = dependencies.users.findById(identity.userId as UserId);
      if (!user) throw new Error();
      const decision = dependencies.authorization.authorize(user, workspaceId(req), permission);
      const context = dependencies.resolver.resolve(decision);
      await controller(context)(req, res, next);
    } catch { res.status(404).json({ error: "Resource not found." }); }
  };

  router.get("/:workspaceId/companies", authorize("company:read", false, dependencies.controllers.list));
  router.post("/:workspaceId/companies", authorize("company:manage", true, dependencies.controllers.create));
  router.get("/:workspaceId/companies/:companyId", authorize("company:read", false, dependencies.controllers.get));
  router.patch("/:workspaceId/companies/:companyId", authorize("company:manage", true, dependencies.controllers.update));
  router.delete("/:workspaceId/companies/:companyId", authorize("company:manage", true, dependencies.controllers.delete));
  router.post("/:workspaceId/companies/:companyId/onboard", authorize("onboarding:run", true, dependencies.controllers.onboard));
  router.get("/:workspaceId/companies/:companyId/assistant-profiles", authorize("company:read", false, dependencies.assistantControllers.list));
  router.post("/:workspaceId/companies/:companyId/assistant-profiles", authorize("company:manage", true, dependencies.assistantControllers.create));
  router.get("/:workspaceId/companies/:companyId/assistant-profiles/:assistantProfileId", authorize("company:read", false, dependencies.assistantControllers.get));
  router.patch("/:workspaceId/companies/:companyId/assistant-profiles/:assistantProfileId", authorize("company:manage", true, dependencies.assistantControllers.update));
  router.post("/:workspaceId/companies/:companyId/assistant-profiles/:assistantProfileId/transitions", authorize("company:manage", true, dependencies.assistantControllers.transition));
  router.post("/:workspaceId/companies/:companyId/assistant-profiles/:assistantProfileId/preview", authorize("assistant:preview", true, dependencies.assistantControllers.preview));
  return router;
}
