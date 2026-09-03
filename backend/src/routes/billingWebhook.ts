import { Router, raw } from "express";
import type { RequestHandler } from "express";

export function createBillingWebhookRouter(controllers: { readonly stripe: RequestHandler; readonly mercadoPago: RequestHandler }): Router { const router = Router(); const body = raw({ type: "application/json", limit: "256kb" }); router.post("/billing/stripe", body, controllers.stripe); router.post("/billing/mercadopago", body, controllers.mercadoPago); return router; }
