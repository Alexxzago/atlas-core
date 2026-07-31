import type { RequestHandler } from "express";
import type { WhatsAppWebhookService } from "../whatsapp/services/WhatsAppWebhookService.js";

export function createWhatsAppWebhookControllers(service: WhatsAppWebhookService): { readonly verify: RequestHandler; readonly receive: RequestHandler } {
  return { verify: (req, res): void => { const challenge = service.verify(req.query["hub.mode"], req.query["hub.verify_token"], req.query["hub.challenge"]); if (challenge === null) { res.sendStatus(403); return; } res.type("text/plain").send(challenge); }, receive: (req, res): void => { const raw = req.body; if (!Buffer.isBuffer(raw) || !service.signatureValid(raw, req.headers["x-hub-signature-256"])) { res.sendStatus(401); return; } void service.acknowledge(raw).then(() => res.sendStatus(200)).catch(() => res.sendStatus(500)); } };
}
