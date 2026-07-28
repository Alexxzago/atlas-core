import { Router, raw } from "express";
import type { RequestHandler } from "express";
export function createWhatsAppWebhookRouter(controllers: { readonly verify: RequestHandler; readonly receive: RequestHandler }): Router { const router = Router(); router.get("/whatsapp", controllers.verify); router.post("/whatsapp", raw({ type: "application/json", limit: "256kb" }), controllers.receive); return router; }
