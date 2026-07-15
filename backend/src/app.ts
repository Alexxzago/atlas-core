import express from "express";
import healthRouter from "./routes/health.js";
import { chatRouter, companiesRouter, knowledgeRouter, scrapeRouter } from "./composition.js";

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.send("🚀 Atlas Core está funcionando.");
});

app.use(healthRouter);
app.use(knowledgeRouter);
app.use(chatRouter);
app.use(scrapeRouter);
app.use("/companies", companiesRouter);

export default app;
