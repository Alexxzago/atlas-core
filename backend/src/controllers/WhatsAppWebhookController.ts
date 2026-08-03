import type { RequestHandler } from "express";
import type { WhatsAppWebhookService } from "../whatsapp/services/WhatsAppWebhookService.js";

export function createWhatsAppWebhookControllers(service: WhatsAppWebhookService): { readonly verify: RequestHandler; readonly receive: RequestHandler } {
  return {
    verify: (req, res): void => {
      const mode = req.query["hub.mode"], token = req.query["hub.verify_token"], challengeValue = req.query["hub.challenge"], challenge = service.verify(mode, token, challengeValue);
      diagnostic("whatsapp_webhook_verification", { remoteIp: remoteIp(req), hubMode: typeof mode === "string" ? mode : null, hubChallengePresent: typeof challengeValue === "string", verifyTokenMatch: service.verify("subscribe", token, "diagnostic") !== null });
      if (challenge === null) { res.sendStatus(403); return; }
      res.type("text/plain").send(challenge);
    },
    receive: (req, res): void => {
      const raw = req.body, signature = req.headers["x-hub-signature-256"], signatureValid = Buffer.isBuffer(raw) && service.signatureValid(raw, signature), summary = Buffer.isBuffer(raw) ? payloadSummary(raw) : emptySummary;
      diagnostic("whatsapp_webhook_received", { remoteIp: remoteIp(req), contentLength: req.headers["content-length"] ?? null, signaturePresent: typeof signature === "string" && signature.length > 0, signatureValid, ...summary });
      if (!signatureValid) { diagnostic("whatsapp_webhook_signature_rejected", { remoteIp: remoteIp(req) }); res.sendStatus(401); return; }
      if (service.parseEvents(raw).length === 0) diagnostic("whatsapp_webhook_payload_ignored", summary);
      void service.acknowledge(raw).then(() => res.sendStatus(200)).catch(() => res.sendStatus(500));
    },
  };
}

type WebhookPayloadSummary = { readonly bodyObject: string | null; readonly entryCount: number; readonly changesCount: number; readonly fieldNames: string[]; };
const emptySummary: WebhookPayloadSummary = { bodyObject: null, entryCount: 0, changesCount: 0, fieldNames: [] };
function payloadSummary(raw: Buffer): WebhookPayloadSummary { try { const value = JSON.parse(raw.toString("utf8")) as { object?: unknown; entry?: unknown }; const entries = Array.isArray(value?.entry) ? value.entry : [], changes = entries.flatMap((entry) => entry && typeof entry === "object" && Array.isArray((entry as { changes?: unknown }).changes) ? (entry as { changes: unknown[] }).changes : []); return { bodyObject: typeof value?.object === "string" ? value.object : null, entryCount: entries.length, changesCount: changes.length, fieldNames: changes.flatMap((change) => change && typeof change === "object" && typeof (change as { field?: unknown }).field === "string" ? [(change as { field: string }).field] : []) }; } catch { return emptySummary; } }
function remoteIp(req: Parameters<RequestHandler>[0]): string | null { return req.ip || req.socket.remoteAddress || null; }
function diagnostic(event: string, value: Record<string, unknown>): void { console.info(JSON.stringify({ event, timestamp: new Date().toISOString(), ...value })); }
