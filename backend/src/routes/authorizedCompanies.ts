import { Router, raw, type Request, type RequestHandler } from "express";
import type { UserRepositoryPort } from "../application/ports/repositories.js";
import type { AuthenticationService } from "../identity/services/authenticationService.js";
import type { UserId } from "../identity/domain/user.js";
import type { Permission } from "../workspace/domain/membership.js";
import { AuthorizationService } from "../workspace/services/authorizationService.js";
import { WorkspaceResolver } from "../workspace/services/workspaceResolver.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import { createActorContext, type ActorContext } from "../knowledge/domain/actorContext.js";

interface ContextualControllers {
  list: (context: WorkspaceContext) => RequestHandler;
  create: (context: WorkspaceContext) => RequestHandler;
  get: (context: WorkspaceContext) => RequestHandler;
  update: (context: WorkspaceContext) => RequestHandler;
  delete: (context: WorkspaceContext) => RequestHandler;
  onboard: (context: WorkspaceContext, actor: ActorContext) => RequestHandler;
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
  knowledgeControllers?: Record<string, (context: WorkspaceContext, actor: ActorContext) => RequestHandler>;
  pdfBodyParser?: RequestHandler;
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
    controller: (context: WorkspaceContext, actor: ActorContext) => RequestHandler,
  ): RequestHandler => async (req, res, next): Promise<void> => {
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Pragma", "no-cache");
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
      const actor = createActorContext({ userId: decision.userId, membershipId: decision.membershipId, role: decision.role, capabilities: decision.capabilities });
      await controller(context, actor)(req, res, next);
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
  const k=dependencies.knowledgeControllers;
  if(k){
    const pdfBody=dependencies.pdfBodyParser??raw({type:"application/pdf",limit:"10mb"});
    router.get("/:workspaceId/companies/:companyId/knowledge/sources",authorize("knowledge:read",false,k.list!));
    router.get("/:workspaceId/companies/:companyId/knowledge/sources/:sourceId/revisions/:revisionId",authorize("knowledge:read",false,k.revision!));
    router.get("/:workspaceId/companies/:companyId/knowledge/publication",authorize("knowledge:read",false,k.publication!));
    router.post("/:workspaceId/companies/:companyId/knowledge/sources/manual",authorize("knowledge:ingest",true,k.createManual!));
    router.post("/:workspaceId/companies/:companyId/knowledge/sources/url",authorize("knowledge:ingest",true,k.createUrl!));
    const authorizedPdf=(controller:(context:WorkspaceContext,actor:ActorContext)=>RequestHandler)=>authorize("knowledge:ingest",true,(context,actor)=>(req,res,next)=>pdfBody(req,res,error=>error?next(error):controller(context,actor)(req,res,next)));
    router.post("/:workspaceId/companies/:companyId/knowledge/sources/pdf",authorizedPdf(k.createPdf!));
    router.post("/:workspaceId/companies/:companyId/knowledge/sources/:sourceId/revisions/manual",authorize("knowledge:ingest",true,k.reviseManual!));
    router.post("/:workspaceId/companies/:companyId/knowledge/sources/:sourceId/revisions/url",authorize("knowledge:ingest",true,k.reviseUrl!));
    router.post("/:workspaceId/companies/:companyId/knowledge/sources/:sourceId/revisions/pdf",authorizedPdf(k.revisePdf!));
    router.post("/:workspaceId/companies/:companyId/knowledge/sources/:sourceId/archive",authorize("knowledge:archive",true,k.archive!));
    router.post("/:workspaceId/companies/:companyId/knowledge/publication",authorize("knowledge:publish",true,k.publish!));
  }
  return router;
}
