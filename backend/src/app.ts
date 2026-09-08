import express, { type Router } from "express";
import healthRouter from "./routes/health.js";
import { createRequestId, normalizeOperationalError, operationalLogger, withRequestContext } from "./observability/operationalLogger.js";

export interface AppRouters { readonly authorizedCompaniesRouter: Router; readonly billingRouter?: Router; readonly chatRouter: Router; readonly companiesRouter: Router; readonly identityRouter: Router; readonly knowledgeRouter: Router; readonly publicWebChatRouter: Router; readonly scrapeRouter: Router; readonly whatsAppWebhookRouter?: Router; readonly billingWebhookRouter?: Router; readonly workspacesRouter: Router; readonly platformAdminRouter?: Router; }
export interface AppOptions { readonly production?: boolean; readonly trustedLocalMode?: boolean; }

function operationalPath(url: string): boolean { return /^\/workspaces\/[^/]+\/companies\/[^/]+\/assistant\/executions\/?(?:\?.*)?$/i.test(url); }
function publicMessagePath(url: string): boolean { return /^\/public\/web-chat\/[^/]+\/messages\/?(?:\?.*)?$/i.test(url); }
function routePattern(url: string): string { const path = url.split("?", 1)[0] ?? "/"; if (path.startsWith("/webhooks/")) return "/webhooks/:provider"; if (path.startsWith("/identity/")) return "/identity/:action"; if (path.startsWith("/workspaces/")) return "/workspaces/:workspaceId"; if (path.startsWith("/public/web-chat/")) return "/public/web-chat/:connection"; return path === "/" || path === "/health" || path === "/ready" ? path : "/other"; }

export function createApp(routers: AppRouters, options: AppOptions = {}): express.Express {
  const app = express();
  // Render/Vercel forwarding cannot currently prove an unspoofable original client address.
  app.set("trust proxy", false);
  app.set("etag", false);
  app.disable("x-powered-by");
  app.use((_request, response, next): void => { response.setHeader("X-Content-Type-Options", "nosniff"); response.setHeader("Referrer-Policy", "no-referrer"); next(); });
  app.use((request, response, next): void => {
    const requestId = createRequestId(), started = performance.now(), pattern = routePattern(request.url);
    withRequestContext(requestId, () => {
      response.on("finish", () => { withRequestContext(requestId, () => operationalLogger.info("http_request_completed", { httpMethod: request.method, routePattern: pattern, httpStatus: response.statusCode, durationMs: Math.round(performance.now() - started), outcome: response.statusCode >= 500 ? "failed" : "completed" })); });
      next();
    });
  });
  app.use(express.json({ limit: "100kb", type: (req) => { const path = (req.url ?? "").split("?", 1)[0] ?? ""; return !(req.method === "POST" && (operationalPath(req.url ?? "") || publicMessagePath(req.url ?? "") || /^\/webhooks\/(whatsapp|billing\/(stripe|mercadopago))\/?$/i.test(path))); } }));
  app.get("/", (_req, res) => { res.send("Atlas Core is running."); });
  app.use(healthRouter);
  if (!options.production) app.use(routers.scrapeRouter);
  if (routers.whatsAppWebhookRouter) app.use("/webhooks", routers.whatsAppWebhookRouter);
  if (routers.billingWebhookRouter) app.use("/webhooks", routers.billingWebhookRouter);
  app.use("/public/web-chat", routers.publicWebChatRouter);
  const trustedLocalMode = options.trustedLocalMode ?? (!Boolean(options.production) && process.env.ATLAS_TRUSTED_LOCAL_MODE === "true");
  if (trustedLocalMode) { app.use(routers.knowledgeRouter); app.use(routers.chatRouter); app.use("/companies", routers.companiesRouter); }
  app.use("/identity", routers.identityRouter);
  if (routers.platformAdminRouter) app.use("/admin", routers.platformAdminRouter);
  app.use("/workspaces", routers.workspacesRouter);
  if (routers.billingRouter) app.use("/workspaces", routers.billingRouter);
  app.use("/workspaces", routers.authorizedCompaniesRouter);
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction): void => {
    operationalLogger.warn("http_request_failed", { safeErrorCategory: normalizeOperationalError(error) });
    if (typeof error === "object" && error !== null && "type" in error && (error as { type?: unknown }).type === "entity.parse.failed") { res.status(400).json({ error: { code: "validation_failed", message: "Request body must be valid JSON." } }); return; }
    if (typeof error === "object" && error !== null && "type" in error && (error as { type?: unknown }).type === "entity.too.large") { res.status(413).json({ error: { code: "knowledge_input_too_large", message: "Knowledge input is too large." } }); return; }
    next(error);
  });
  return app;
}
