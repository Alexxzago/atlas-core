import type { RequestHandler, Response } from "express";
import type { ActorContext } from "../knowledge/domain/actorContext.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import { VoicePolicyConflictError, VoicePolicyNotFoundError, VoicePolicyService, VoicePolicyValidationError } from "../whatsapp/services/voicePolicyService.js";

export function createGetVoicePolicyController(service: VoicePolicyService, context: WorkspaceContext): RequestHandler {
  return (req, res): void => { try { res.json(service.get(context, req.params.companyId, req.params.connectionId)); } catch (error: unknown) { respond(res, error); } };
}

export function createPutVoicePolicyController(service: VoicePolicyService, context: WorkspaceContext, actor: ActorContext): RequestHandler {
  return (req, res): void => { try { res.json(service.update(context, actor.userId, req.params.companyId, req.params.connectionId, req.body)); } catch (error: unknown) { respond(res, error); } };
}

function respond(res: Response, error: unknown): void {
  if (error instanceof VoicePolicyValidationError) { res.status(400).json({ error: "Voice policy is invalid." }); return; }
  if (error instanceof VoicePolicyNotFoundError) { res.status(404).json({ error: "Resource not found." }); return; }
  if (error instanceof VoicePolicyConflictError) { res.status(409).json({ error: "Voice policy changed." }); return; }
  res.status(500).json({ error: "Voice policy could not be updated." });
}
