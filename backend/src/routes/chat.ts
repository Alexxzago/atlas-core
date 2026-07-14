import { Router } from "express";
import { askAtlas } from "../agents/atlas.js";

const router = Router();

router.post("/chat", async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({
      error: "Message is required",
    });
  }

  const answer = await askAtlas(message);

  res.json({
    answer,
  });
});

export default router;