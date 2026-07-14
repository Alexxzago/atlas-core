import { Router } from "express";

const router = Router();

router.get("/health", (req, res) => {
  res.json({
    status: "online",
    service: "Atlas Core",
    version: "0.0.1",
  });
});

export default router;