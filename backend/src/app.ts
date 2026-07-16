import express from "express";
import healthRouter from "./routes/health.js";
import { authorizedCompaniesRouter,chatRouter, companiesRouter, identityRouter, knowledgeRouter, scrapeRouter,workspacesRouter } from "./composition.js";

const app = express();

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

export default app;
