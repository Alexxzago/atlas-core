import type { RequestHandler, Response } from "express";
import type { WebChatConnection } from "../webChat/domain/webChatConnection.js";
import { WebChatConnectionNotFoundError, WebChatConnectionProfileNotExecutableError, WebChatConnectionService, WebChatConnectionValidationError } from "../webChat/services/webChatConnectionService.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

export function createWebChatConnectionController(service: WebChatConnectionService, context: WorkspaceContext): RequestHandler { return (req, res): void => { try { res.status(201).json(response(service.create(context, req.params.companyId, req.body))); } catch (error: unknown) { respond(res, error); } }; }
export function createListWebChatConnectionsController(service: WebChatConnectionService, context: WorkspaceContext): RequestHandler { return (req, res): void => { try { res.json(service.list(context, req.params.companyId).map(response)); } catch (error: unknown) { respond(res, error); } }; }
export function createGetWebChatConnectionController(service: WebChatConnectionService, context: WorkspaceContext): RequestHandler { return (req, res): void => { try { res.json(response(service.get(context, req.params.companyId, req.params.connectionId))); } catch (error: unknown) { respond(res, error); } }; }
export function createUpdateWebChatConnectionController(service: WebChatConnectionService, context: WorkspaceContext): RequestHandler { return (req, res): void => { try { res.json(response(service.setStatus(context, req.params.companyId, req.params.connectionId, req.body))); } catch (error: unknown) { respond(res, error); } }; }

function response(value: WebChatConnection): WebChatConnection { return value; }
function respond(res: Response, error: unknown): void {
  if (error instanceof WebChatConnectionValidationError) { res.status(400).json({ error: error.message }); return; }
  if (error instanceof WebChatConnectionNotFoundError) { res.status(404).json({ error: error.message }); return; }
  if (error instanceof WebChatConnectionProfileNotExecutableError) { res.status(409).json({ error: error.message }); return; }
  console.error("Web Chat Connection operation failed.", error); res.status(500).json({ error: "Web Chat Connection operation failed." });
}
