import express, { type Router } from "express";
import healthRouter from "./routes/health.js";

export interface AppRouters { readonly authorizedCompaniesRouter: Router; readonly chatRouter: Router; readonly companiesRouter: Router; readonly identityRouter: Router; readonly knowledgeRouter: Router; readonly scrapeRouter: Router; readonly workspacesRouter: Router; }
export interface AppOptions { readonly production?: boolean; readonly trustedLocalMode?: boolean; }

function operationalPath(url: string): boolean { return /^\/workspaces\/[^/]+\/companies\/[^/]+\/assistant\/executions\/?(?:\?.*)?$/i.test(url); }

export function createApp(routers: AppRouters, options: AppOptions = {}): express.Express {
  const app = express();
  if (options.production) app.set("trust proxy", 1);
  app.set("etag", false);
  app.use(express.json({ type: (req) => !(req.method === "POST" && operationalPath(req.url ?? "")) }));
  app.get("/", (_req, res) => { res.send("Atlas Core is running."); });
  app.use(healthRouter);
  app.use(routers.scrapeRouter);
  const trustedLocalMode = options.trustedLocalMode ?? (!Boolean(options.production) && process.env.ATLAS_TRUSTED_LOCAL_MODE === "true");
  if (trustedLocalMode) { app.use(routers.knowledgeRouter); app.use(routers.chatRouter); app.use("/companies", routers.companiesRouter); }
  app.use("/identity", routers.identityRouter);
  app.use("/workspaces", routers.workspacesRouter);
  app.use("/workspaces", routers.authorizedCompaniesRouter);
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction): void => {
    if (typeof error === "object" && error !== null && "type" in error && (error as { type?: unknown }).type === "entity.too.large") { res.status(413).json({ error: { code: "knowledge_input_too_large", message: "Knowledge input is too large." } }); return; }
    next(error);
  });
  return app;
}
