import type { RequestHandler } from "express";
import type { AsyncBillingWebhookService, BillingWebhookService } from "../billing/application/billingWebhookService.js";
import type { BillingProviderKind } from "../billing/domain/billing.js";

export function createBillingWebhookController(service: BillingWebhookService | AsyncBillingWebhookService, provider: BillingProviderKind): RequestHandler { return async (req, res): Promise<void> => { if (!Buffer.isBuffer(req.body)) { res.sendStatus(400); return; } try { const result = await service.receive(provider, req.body, req.headers); res.sendStatus(result === "invalid" ? 400 : 200); } catch { res.sendStatus(500); } }; }
