import express from "express";
import healthRouter from "./routes/health.js";
import { authorizedCompaniesRouter,chatRouter, companiesRouter, identityRouter, knowledgeRouter, scrapeRouter,workspacesRouter } from "./composition.js";

const app = express();
app.set("etag", false);

app.use(express.json());

app.get("/", (req, res) => {
  res.send("🚀 Atlas Core está funcionando.");
});

app.use(healthRouter);
app.use(scrapeRouter);
const trustedLocalMode=process.env.NODE_ENV!=="production"&&process.env.ATLAS_TRUSTED_LOCAL_MODE==="true";
if(trustedLocalMode){app.use(knowledgeRouter);app.use(chatRouter);app.use("/companies",companiesRouter);}
app.use("/identity", identityRouter);
app.use("/workspaces",workspacesRouter);
app.use("/workspaces",authorizedCompaniesRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction): void => {
  if (typeof error === "object" && error !== null && "type" in error && (error as { type?: unknown }).type === "entity.too.large") {
    res.status(413).json({ error: { code: "knowledge_input_too_large", message: "Knowledge input is too large." } });
    return;
  }
  next(error);
});

export default app;
