import { Router, json, raw, type Request, type RequestHandler } from "express";
import type { UserRepositoryPort } from "../application/ports/repositories.js";
import type { AuthenticationService } from "../identity/services/authenticationService.js";
import type { UserId } from "../identity/domain/user.js";
import type { Permission } from "../workspace/domain/membership.js";
import { AuthorizationService } from "../workspace/services/authorizationService.js";
import { WorkspaceResolver } from "../workspace/services/workspaceResolver.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import { createActorContext, type ActorContext } from "../knowledge/domain/actorContext.js";
import type { CompanyCoreControllers } from "../controllers/companyCoreController.js";
import { CommercialControlsRepository } from "../repositories/commercialControlsRepository.js";

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
  execution?: (context: WorkspaceContext) => RequestHandler;
}
interface ContextualAssistantReadinessControllers { get: (context: WorkspaceContext) => RequestHandler; refresh: (context: WorkspaceContext) => RequestHandler; }
interface ContextualDefaultAssistantControllers { get:(context:WorkspaceContext)=>RequestHandler; put:(context:WorkspaceContext,actor:ActorContext)=>RequestHandler; }

interface ContextualWebChatConnectionControllers {
  list: (context: WorkspaceContext) => RequestHandler;
  create: (context: WorkspaceContext) => RequestHandler;
  get: (context: WorkspaceContext) => RequestHandler;
  update: (context: WorkspaceContext) => RequestHandler;
}
interface ContextualWhatsAppConnectionControllers {
  list: (context: WorkspaceContext) => RequestHandler;
  create: (context: WorkspaceContext) => RequestHandler;
  get: (context: WorkspaceContext) => RequestHandler;
  update: (context: WorkspaceContext) => RequestHandler;
  status?: (context: WorkspaceContext) => RequestHandler;
  configureCredentials?: (context: WorkspaceContext) => RequestHandler;
  validate?: (context: WorkspaceContext) => RequestHandler;
  activate?: (context: WorkspaceContext) => RequestHandler;
  deactivate?: (context: WorkspaceContext) => RequestHandler;
}
interface ContextualConversationReadControllers {
  list: (context: WorkspaceContext) => RequestHandler;
  get: (context: WorkspaceContext) => RequestHandler;
}
interface ContextualConversationControlControllers { takeover: (context: WorkspaceContext, actor: ActorContext) => RequestHandler; release: (context: WorkspaceContext, actor: ActorContext) => RequestHandler; resolve: (context: WorkspaceContext, actor: ActorContext) => RequestHandler; }

interface AuthorizedCompanyDependencies {
  authentication: AuthenticationService;
  users: UserRepositoryPort;
  authorization: AuthorizationService;
  resolver: WorkspaceResolver;
  controllers: ContextualControllers;
  companyCoreControllers?: CompanyCoreControllers;
  assistantControllers: ContextualAssistantControllers;
  assistantReadinessControllers?: ContextualAssistantReadinessControllers;
  defaultAssistantControllers?: ContextualDefaultAssistantControllers;
  webChatConnectionControllers?: ContextualWebChatConnectionControllers;
  whatsAppConnectionControllers?: ContextualWhatsAppConnectionControllers;
  knowledgeControllers?: Record<string, (context: WorkspaceContext, actor: ActorContext) => RequestHandler>;
  conversationMessageController?: (context: WorkspaceContext, actor: ActorContext) => RequestHandler;
  conversationReadControllers?: ContextualConversationReadControllers;
  conversationControlControllers?: ContextualConversationControlControllers;
  pdfBodyParser?: RequestHandler;
  commercial?: CommercialControlsRepository;
}

let productionConversationMessageController: ((context: WorkspaceContext, actor: ActorContext) => RequestHandler) | null = null;
let productionConversationReadControllers: ContextualConversationReadControllers | null = null;
let productionConversationControlControllers: ContextualConversationControlControllers | null = null;
let productionCompanyCoreControllers: CompanyCoreControllers | null = null;
let productionAssistantReadinessControllers: ContextualAssistantReadinessControllers | null = null;
let productionDefaultAssistantControllers: ContextualDefaultAssistantControllers | null = null;
let productionCommercialControls: CommercialControlsRepository | null = null;
export function configureProductionConversationMessageController(controller: (context: WorkspaceContext, actor: ActorContext) => RequestHandler): void { productionConversationMessageController = controller; }
export function configureProductionConversationReadControllers(controllers: ContextualConversationReadControllers): void { productionConversationReadControllers = controllers; }
export function configureProductionConversationControlControllers(controllers: ContextualConversationControlControllers): void { productionConversationControlControllers = controllers; }
export function configureProductionCompanyCoreControllers(controllers: CompanyCoreControllers): void { productionCompanyCoreControllers = controllers; }
export function configureProductionAssistantReadinessControllers(controllers: ContextualAssistantReadinessControllers): void { productionAssistantReadinessControllers = controllers; }
export function configureProductionDefaultAssistantControllers(controllers: ContextualDefaultAssistantControllers): void { productionDefaultAssistantControllers = controllers; }
export function configureProductionCommercialControls(controls: CommercialControlsRepository): void { productionCommercialControls = controls; }

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
    if (typeof req.headers.origin !== "string") return false;
    const origin = new URL(req.headers.origin).origin;
    const configured = (process.env.ATLAS_ALLOWED_ORIGINS ?? process.env.ATLAS_VERIFICATION_ORIGIN ?? "")
      .split(",").map((value) => value.trim()).filter(Boolean);
    return configured.length > 0 ? configured.some((value) => new URL(value).origin === origin) : origin === `${req.protocol}://${req.headers.host}`;
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
        if (!exactOrigin(req) || typeof csrf !== "string" || fetchSite !== "same-origin"
          || !dependencies.authentication.validateCsrf(raw, csrf)) throw new Error();
      }
      const user = dependencies.users.findById(identity.userId as UserId);
      if (!user) throw new Error();
      const decision = dependencies.authorization.authorize(user, workspaceId(req), permission);
      if (changing && dependencies.commercial && !dependencies.commercial.isWorkspaceActive(decision.workspaceId)) { res.status(409).json({ error: { code: "commercial_account_suspended", message: "Commercial account is suspended." } }); return; }
      const context = dependencies.resolver.resolve(decision);
      const actor = createActorContext({ userId: decision.userId, membershipId: decision.membershipId, role: decision.role, capabilities: decision.capabilities });
      await controller(context, actor)(req, res, next);
    } catch { res.status(404).json({ error: "Resource not found." }); }
  };

  const companyCore = dependencies.companyCoreControllers ?? productionCompanyCoreControllers;
  if (companyCore) {
    router.get("/:workspaceId/companies", authorize("company:read", false, companyCore.list));
    router.post("/:workspaceId/companies", authorize("company:manage", true, companyCore.create));
    router.post("/:workspaceId/companies/onboarding", authorize("company:manage", true, companyCore.createOnboarding));
    router.get("/:workspaceId/companies/slug/:slug", authorize("company:read", false, companyCore.getBySlug));
    router.get("/:workspaceId/companies/:companyId", authorize("company:read", false, companyCore.get));
    router.patch("/:workspaceId/companies/:companyId/identity", authorize("company:manage", true, companyCore.updateIdentity));
    router.patch("/:workspaceId/companies/:companyId/branding", authorize("company:manage", true, companyCore.updateBranding));
    router.patch("/:workspaceId/companies/:companyId/configuration", authorize("company:manage", true, companyCore.updateConfiguration));
    router.post("/:workspaceId/companies/:companyId/readiness/evaluate", authorize("company:manage", true, companyCore.evaluateReadiness));
    router.post("/:workspaceId/companies/:companyId/readiness/apply", authorize("company:manage", true, companyCore.applyReadiness));
    router.post("/:workspaceId/companies/:companyId/suspend", authorize("company:manage", true, companyCore.suspend));
    router.post("/:workspaceId/companies/:companyId/restore", authorize("company:manage", true, companyCore.restore));
    router.post("/:workspaceId/companies/:companyId/archive", authorize("company:manage", true, companyCore.archive));
  }

  if (!companyCore) {
    router.get("/:workspaceId/companies", authorize("company:read", false, dependencies.controllers.list));
    router.post("/:workspaceId/companies", authorize("company:manage", true, dependencies.controllers.create));
    router.get("/:workspaceId/companies/:companyId", authorize("company:read", false, dependencies.controllers.get));
  }
  router.post("/:workspaceId/companies/:companyId/onboard", authorize("onboarding:run", true, dependencies.controllers.onboard));
  router.get("/:workspaceId/companies/:companyId/assistant-profiles", authorize("company:read", false, dependencies.assistantControllers.list));
  router.post("/:workspaceId/companies/:companyId/assistant-profiles", authorize("company:manage", true, dependencies.assistantControllers.create));
  router.get("/:workspaceId/companies/:companyId/assistant-profiles/:assistantProfileId", authorize("company:read", false, dependencies.assistantControllers.get));
  router.patch("/:workspaceId/companies/:companyId/assistant-profiles/:assistantProfileId", authorize("company:manage", true, dependencies.assistantControllers.update));
  router.post("/:workspaceId/companies/:companyId/assistant-profiles/:assistantProfileId/transitions", authorize("company:manage", true, dependencies.assistantControllers.transition));
  router.post("/:workspaceId/companies/:companyId/assistant-profiles/:assistantProfileId/preview", authorize("assistant:preview", true, dependencies.assistantControllers.preview));
  const readiness = dependencies.assistantReadinessControllers ?? productionAssistantReadinessControllers;
  if (readiness) {
    router.get("/:workspaceId/companies/:companyId/assistant/readiness", authorize("company:read", false, readiness.get));
    router.post("/:workspaceId/companies/:companyId/assistant/readiness/refresh", authorize("company:manage", true, readiness.refresh));
  }
  const defaults=dependencies.defaultAssistantControllers??productionDefaultAssistantControllers;
  if(defaults){router.get("/:workspaceId/companies/:companyId/assistant/default",authorize("company:read",false,defaults.get));router.put("/:workspaceId/companies/:companyId/assistant/default",authorize("company:manage",true,defaults.put));}
  const operationalJson = json({ type: "application/json", limit: 8 * 1024 });
  const operationalExecution = dependencies.assistantControllers.execution ? authorize("chat:use", true, (context) => (req, res, next) => {
    if (!req.is("application/json")) {
      res.status(415).json({ error: { code: "assistant_execution_media_type_unsupported", message: "Assistant execution requires application/json." } });
      return;
    }
    operationalJson(req, res, (error?: unknown) => {
      if (error) {
        const type = typeof error === "object" && error !== null && "type" in error ? (error as { type?: unknown }).type : null;
        if (type === "entity.too.large") { res.status(413).json({ error: { code: "assistant_execution_input_too_large", message: "Assistant execution input is too large." } }); return; }
        res.status(400).json({ error: { code: "invalid_assistant_execution_request", message: "A valid Assistant Profile and message are required." } });
        return;
      }
      dependencies.assistantControllers.execution!(context)(req, res, next);
    });
  }) : null;
  if (operationalExecution) router.post("/:workspaceId/companies/:companyId/assistant/executions", operationalExecution);
  const conversationMessageController = dependencies.conversationMessageController ?? productionConversationMessageController;
  if (conversationMessageController) router.post("/:workspaceId/companies/:companyId/conversations/:conversationId/messages", authorize("conversation:message:send", true, conversationMessageController));
  const conversationReads = dependencies.conversationReadControllers ?? productionConversationReadControllers;
  if (conversationReads) {
    router.get("/:workspaceId/companies/:companyId/conversations", authorize("company:read", false, conversationReads.list));
    router.get("/:workspaceId/companies/:companyId/conversations/:conversationId", authorize("company:read", false, conversationReads.get));
  }
  const conversationControls = dependencies.conversationControlControllers ?? productionConversationControlControllers;
  if (conversationControls) {
    router.post("/:workspaceId/companies/:companyId/conversations/:conversationId/takeover", authorize("conversation:manage", true, conversationControls.takeover));
    router.post("/:workspaceId/companies/:companyId/conversations/:conversationId/release", authorize("conversation:manage", true, conversationControls.release));
    router.post("/:workspaceId/companies/:companyId/conversations/:conversationId/resolve", authorize("conversation:manage", true, conversationControls.resolve));
  }
  const webChat = dependencies.webChatConnectionControllers;
  if (webChat) {
    router.get("/:workspaceId/companies/:companyId/web-chat-connections", authorize("company:read", false, webChat.list));
    router.post("/:workspaceId/companies/:companyId/web-chat-connections", authorize("company:manage", true, webChat.create));
    router.get("/:workspaceId/companies/:companyId/web-chat-connections/:connectionId", authorize("company:read", false, webChat.get));
    router.patch("/:workspaceId/companies/:companyId/web-chat-connections/:connectionId", authorize("company:manage", true, webChat.update));
  }
  const whatsApp = dependencies.whatsAppConnectionControllers;
  if (whatsApp) {
    router.get("/:workspaceId/companies/:companyId/whatsapp-connections", authorize("company:read", false, whatsApp.list));
    router.post("/:workspaceId/companies/:companyId/whatsapp-connections", authorize("company:manage", true, whatsApp.create));
    router.get("/:workspaceId/companies/:companyId/whatsapp-connections/:connectionId", authorize("company:read", false, whatsApp.get));
    router.patch("/:workspaceId/companies/:companyId/whatsapp-connections/:connectionId", authorize("company:manage", true, whatsApp.update));
    if (whatsApp.status) router.get("/:workspaceId/companies/:companyId/whatsapp-connections/:connectionId/status", authorize("company:read", false, whatsApp.status));
    if (whatsApp.configureCredentials) router.put("/:workspaceId/companies/:companyId/whatsapp-connections/:connectionId/credentials", authorize("company:manage", true, whatsApp.configureCredentials));
    if (whatsApp.validate) router.post("/:workspaceId/companies/:companyId/whatsapp-connections/:connectionId/validation", authorize("company:manage", true, whatsApp.validate));
    if (whatsApp.activate) router.post("/:workspaceId/companies/:companyId/whatsapp-connections/:connectionId/activation", authorize("company:manage", true, whatsApp.activate));
    if (whatsApp.deactivate) router.post("/:workspaceId/companies/:companyId/whatsapp-connections/:connectionId/deactivation", authorize("company:manage", true, whatsApp.deactivate));
  }
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
