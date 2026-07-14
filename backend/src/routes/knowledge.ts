import { Router } from "express";
import { getKnowledge } from "../services/knowledge.js";

const router = Router();

router.get("/knowledge", (req, res) => {
  res.json(getKnowledge());
});

export default router;