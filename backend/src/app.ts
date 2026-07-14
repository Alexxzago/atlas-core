import express from "express";
import healthRouter from "./routes/health.js";
import knowledgeRouter from "./routes/knowledge.js";
import chatRouter from "./routes/chat.js";

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.send("🚀 Atlas Core está funcionando.");
});

app.use(healthRouter);
app.use(knowledgeRouter);
app.use(chatRouter);

export default app;