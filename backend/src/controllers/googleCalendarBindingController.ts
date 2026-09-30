import type { RequestHandler } from "express";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import type { GoogleCalendarBindingService } from "../scheduling/services/googleCalendarBindingService.js";

export function createGoogleCalendarBindingControllers(service: GoogleCalendarBindingService): { readonly status:(context:WorkspaceContext)=>RequestHandler; readonly bind:(context:WorkspaceContext)=>RequestHandler; readonly unbind:(context:WorkspaceContext)=>RequestHandler; readonly reconnect:(context:WorkspaceContext)=>RequestHandler } {
  const company = (value: unknown): number => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 0;
  const body = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
  const result = (response: Parameters<RequestHandler>[1], value: unknown): void => { const kind = typeof value === "object" && value !== null && "kind" in value ? String((value as { kind: unknown }).kind) : ""; response.status(kind === "not_found" ? 404 : kind === "conflict" ? 409 : kind === "blocked" ? 423 : kind === "unavailable" ? 503 : 200).json(value); };
  const hidden = (response: Parameters<RequestHandler>[1]): void => { response.status(404).json({ error: { code: "resource_not_found", message: "Resource not found." } }); };
  return {
    status: context => (request, response) => { const resourceId = typeof request.params.resourceId === "string" ? request.params.resourceId : ""; void service.status(context, company(request.params.companyId), resourceId).then(value => value ? response.json(value) : hidden(response)).catch(() => hidden(response)); },
    bind: context => (request, response) => { const input = body(request.body), expectedVersion = Number.isSafeInteger(input.expectedVersion) ? Number(input.expectedVersion) : undefined, value = { resourceId: typeof input.resourceId === "string" ? input.resourceId : "", calendarId: typeof input.calendarId === "string" ? input.calendarId : "", ...(expectedVersion === undefined ? {} : { expectedVersion }) }; void service.bind(context, company(request.params.companyId), value).then(value => result(response, value)).catch(() => hidden(response)); },
    unbind: context => (request, response) => { const input = body(request.body); void service.unbind(context, company(request.params.companyId), { resourceId: typeof input.resourceId === "string" ? input.resourceId : "", expectedVersion: Number(input.expectedVersion) }).then(value => result(response, value)).catch(() => hidden(response)); },
    reconnect: context => (request, response) => { const input = body(request.body); void service.reconnect(context, company(request.params.companyId), { resourceId: typeof input.resourceId === "string" ? input.resourceId : "", expectedVersion: Number(input.expectedVersion) }).then(value => result(response, value)).catch(() => hidden(response)); },
  };
}
