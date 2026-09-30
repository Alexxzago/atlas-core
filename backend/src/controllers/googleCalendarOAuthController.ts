import type { RequestHandler } from "express";
import type { UserId } from "../identity/domain/user.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import type { GoogleCalendarOAuthService } from "../integrations/application/googleCalendarOAuth.js";
export function createGoogleCalendarOAuthControllers(service: GoogleCalendarOAuthService): { start: (context: WorkspaceContext, userId: UserId) => RequestHandler; status: (context: WorkspaceContext) => RequestHandler; complete: (context: WorkspaceContext, userId: UserId) => RequestHandler; revoke: (context: WorkspaceContext) => RequestHandler } {
  const company = (value: unknown): number => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 0;
  const send = (response: Parameters<RequestHandler>[1], value: unknown): void => { const kind = typeof value === "object" && value !== null && "kind" in value ? String((value as { kind: unknown }).kind) : ""; response.status(kind === "expired" ? 410 : kind === "unavailable" ? 503 : ["invalid_state", "replayed"].includes(kind) ? 409 : 200).json(value); };
  const secure = (response: Parameters<RequestHandler>[1]): void => { response.setHeader("Cache-Control", "no-store, private"); response.setHeader("Pragma", "no-cache"); };
  return {
    start: (context, userId) => (request, response) => { secure(response); void service.start(context, userId, company(request.params.companyId)).then(value => response.status(201).json(value)).catch(() => response.status(404).json({ error: { code: "resource_not_found", message: "Resource not found." } })); },
    status: (context) => (request, response) => { secure(response); void service.status(context, company(request.params.companyId)).then(value => response.json(value)); },
    complete: (context, userId) => (request, response) => { secure(response); const body = request.body as Record<string, unknown>; void service.complete(context, userId, company(request.params.companyId), String(request.params.attemptId), typeof body?.state === "string" ? body.state : "", typeof body?.code === "string" ? body.code : "").then(value => send(response, value)); },
    revoke: (context) => (request, response) => { secure(response); void service.revoke(context, company(request.params.companyId)).then(() => response.status(204).end()); },
  };
}
