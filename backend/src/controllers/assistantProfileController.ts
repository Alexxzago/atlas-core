import type { RequestHandler, Response } from "express";
import type { AssistantProfileService } from "../assistant/services/assistantProfileService.js";
import { AssistantProfileConflictError, AssistantProfileNotFoundError, AssistantProfileValidationError } from "../assistant/services/assistantProfileService.js";
import type { AssistantProfile } from "../assistant/domain/assistantProfile.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

export function createListAssistantProfilesController(service: AssistantProfileService, context: WorkspaceContext): RequestHandler {
  return (req, res): void => {
    try { res.json(service.list(context, req.params.companyId).map(toResponse)); }
    catch (error: unknown) { respond(res, error); }
  };
}

export function createGetAssistantProfileController(service: AssistantProfileService, context: WorkspaceContext): RequestHandler {
  return (req, res): void => {
    try { res.json(toResponse(service.get(context, req.params.companyId, req.params.assistantProfileId))); }
    catch (error: unknown) { respond(res, error); }
  };
}

export function createAssistantProfileController(service: AssistantProfileService, context: WorkspaceContext): RequestHandler {
  return (req, res): void => {
    try { res.status(201).json(toResponse(service.create(context, req.params.companyId, req.body))); }
    catch (error: unknown) { respond(res, error); }
  };
}

export function createUpdateAssistantProfileController(service: AssistantProfileService, context: WorkspaceContext): RequestHandler {
  return (req, res): void => {
    try { res.json(toResponse(service.update(context, req.params.companyId, req.params.assistantProfileId, req.body))); }
    catch (error: unknown) { respond(res, error); }
  };
}

export function createTransitionAssistantProfileController(service: AssistantProfileService, context: WorkspaceContext): RequestHandler {
  return (req, res): void => {
    try {
      const body = req.body;
      if (typeof body !== "object" || body === null || Array.isArray(body)
        || Object.keys(body).length !== 1 || !("targetStatus" in body)) {
        throw new AssistantProfileValidationError("Transition body is invalid.");
      }
      res.json(toResponse(service.transition(context, req.params.companyId, req.params.assistantProfileId, (body as { targetStatus: unknown }).targetStatus)));
    } catch (error: unknown) { respond(res, error); }
  };
}

function toResponse(profile: AssistantProfile): Omit<AssistantProfile, "companyId" | "normalizedName"> {
  const { companyId: _companyId, normalizedName: _normalizedName, ...response } = profile;
  return response;
}

function respond(res: Response, error: unknown): void {
  if (error instanceof AssistantProfileValidationError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof AssistantProfileNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof AssistantProfileConflictError) {
    res.status(409).json({ error: error.message });
    return;
  }
  console.error("Assistant Profile operation failed.", error);
  res.status(500).json({ error: "Assistant Profile operation failed." });
}
