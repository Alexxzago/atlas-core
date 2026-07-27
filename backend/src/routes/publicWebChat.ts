import express, { Router, type Request, type Response } from "express";
import type { PublicWebChatSessionService } from "../webChat/services/publicWebChatSessionService.js";
import { PublicWebChatSessionUnavailableError } from "../webChat/services/publicWebChatSessionService.js";
import { PublicWebChatConversationInProgressError, PublicWebChatConversationRuntimeError, PublicWebChatConversationUnavailableError, PublicWebChatConversationValidationError, type PublicWebChatConversationService } from "../webChat/services/publicWebChatConversationService.js";

const developmentCookie = "atlas_web_chat_session";
const productionCookie = "__Host-atlas_web_chat_session";

function cookie(request: Request, name: string): string | null { for (const part of (request.headers.cookie ?? "").split(";")) { const [key, ...rest] = part.trim().split("="); if (key === name) { try { return decodeURIComponent(rest.join("=")); } catch { return null; } } } return null; }
function unavailable(response: Response): void { response.status(404).json({ error: "Web Chat is unavailable." }); }
function invalidMessage(response: Response): void { response.status(400).json({ error: "Message is invalid." }); }
function sameOrigin(request: Request): boolean {
  const origin = request.headers.origin;
  if (!origin) return request.headers["sec-fetch-site"] !== "cross-site" && request.headers["sec-fetch-site"] !== "same-site";
  try { return new URL(origin).origin === `${request.protocol}://${request.get("host")}` && request.headers["sec-fetch-site"] !== "cross-site" && request.headers["sec-fetch-site"] !== "same-site"; }
  catch { return false; }
}

export function createPublicWebChatRouter(service: PublicWebChatSessionService, conversations: PublicWebChatConversationService, production: boolean): Router {
  const router = Router(), cookieName = production ? productionCookie : developmentCookie;
  const set = (response: Response, raw: string, expiresAt: string): void => { const age = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000)); response.setHeader("set-cookie", `${cookieName}=${encodeURIComponent(raw)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${production ? "; Secure" : ""}`); };
  const clear = (response: Response): void => { response.setHeader("set-cookie", `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${production ? "; Secure" : ""}`); };
  router.post("/:connectionPublicId/session", (request, response): void => {
    if (request.headers["content-type"] && !request.is("application/json")) { response.status(415).json({ error: "Web Chat is unavailable." }); return; }
    try { const value = service.start(request.params.connectionPublicId, cookie(request, cookieName)); set(response, value.rawToken, value.expiresAt); response.status(201).json({ state: value.state, expiresAt: value.expiresAt }); }
    catch (error: unknown) { if (error instanceof PublicWebChatSessionUnavailableError) unavailable(response); else { console.error("Public Web Chat Session start failed.", error); unavailable(response); } }
  });
  router.get("/:connectionPublicId/session", (request, response): void => { try { response.json(service.state(request.params.connectionPublicId, cookie(request, cookieName))); } catch { unavailable(response); } });
  router.delete("/:connectionPublicId/session", (request, response): void => { try { service.close(request.params.connectionPublicId, cookie(request, cookieName)); clear(response); response.status(204).end(); } catch { clear(response); unavailable(response); } });
  router.get("/:connectionPublicId/messages", (request, response): void => { try { response.json(conversations.history(request.params.connectionPublicId, cookie(request, cookieName))); } catch { unavailable(response); } });
  router.post("/:connectionPublicId/messages", (request, response, next): void => {
    if (!request.is("application/json")) { response.status(415).json({ error: "Message is invalid." }); return; }
    if (!sameOrigin(request)) { unavailable(response); return; }
    const length = Number(request.headers["content-length"]);
    if (Number.isFinite(length) && length > 8 * 1024) { response.status(413).json({ error: "Message is invalid." }); return; }
    express.json({ limit: "8kb", strict: true })(request, response, next);
  }, (request, response): void => {
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("message" in body)) { invalidMessage(response); return; }
    void conversations.sendMessage(request.params.connectionPublicId, cookie(request, cookieName), (body as { message: unknown }).message)
      .then((result) => { response.json(result); })
      .catch((error: unknown) => {
        if (error instanceof PublicWebChatConversationValidationError) invalidMessage(response);
        else if (error instanceof PublicWebChatConversationUnavailableError) unavailable(response);
        else if (error instanceof PublicWebChatConversationInProgressError) response.status(409).json({ error: { code: "conversation_busy", message: "Message cannot be sent right now." } });
        else if (error instanceof PublicWebChatConversationRuntimeError) response.status(503).json({ error: "Message cannot be sent right now." });
        else response.status(503).json({ error: "Message cannot be sent right now." });
      });
  });
  router.use((error: unknown, _request: Request, response: Response, next: (error: unknown) => void): void => {
    if (typeof error === "object" && error !== null && "type" in error) {
      const type = (error as { type?: unknown }).type;
      if (type === "entity.too.large") { response.status(413).json({ error: "Message is invalid." }); return; }
      if (type === "entity.parse.failed") { invalidMessage(response); return; }
    }
    next(error);
  });
  return router;
}
