import { Router, type Request, type Response } from "express";
import type { PublicWebChatSessionService } from "../webChat/services/publicWebChatSessionService.js";
import { PublicWebChatSessionUnavailableError } from "../webChat/services/publicWebChatSessionService.js";

const developmentCookie = "atlas_web_chat_session";
const productionCookie = "__Host-atlas_web_chat_session";

function cookie(request: Request, name: string): string | null { for (const part of (request.headers.cookie ?? "").split(";")) { const [key, ...rest] = part.trim().split("="); if (key === name) return decodeURIComponent(rest.join("=")); } return null; }
function unavailable(response: Response): void { response.status(404).json({ error: "Web Chat is unavailable." }); }

export function createPublicWebChatRouter(service: PublicWebChatSessionService, production: boolean): Router {
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
  return router;
}
