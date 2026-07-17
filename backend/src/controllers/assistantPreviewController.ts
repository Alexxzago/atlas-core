import type { RequestHandler, Response } from "express";
import { AnswerGenerationUnavailableError } from "../assistant/application/assistantExecution.js";
import type { AssistantPreviewService } from "../assistant/services/assistantPreviewService.js";
import {
  AssistantPreviewCompanyNotReadyError,
  AssistantPreviewKnowledgeUnavailableError,
  AssistantPreviewNotFoundError,
  AssistantPreviewValidationError,
  AssistantProfileNotExecutableError,
} from "../assistant/services/assistantPreviewService.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

export function createAssistantPreviewController(service: AssistantPreviewService, context: WorkspaceContext): RequestHandler {
  return async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Pragma", "no-cache");
    try {
      const result = await service.preview(context, req.params.companyId, req.params.assistantProfileId, req.body);
      res.json({ status: result.outcome, answer: result.answer });
    } catch (error: unknown) { respond(res, error); }
  };
}

function respond(res: Response, error: unknown): void {
  if (error instanceof AssistantPreviewValidationError) {
    res.status(400).json({ error: { code: "invalid_preview_request", message: "A valid preview message is required." } }); return;
  }
  if (error instanceof AssistantPreviewNotFoundError) {
    res.status(404).json({ error: "Resource not found." }); return;
  }
  if (error instanceof AssistantProfileNotExecutableError) {
    res.status(409).json({ error: { code: "assistant_profile_not_executable", message: "Assistant Profile is not ready for preview." } }); return;
  }
  if (error instanceof AssistantPreviewCompanyNotReadyError) {
    res.status(409).json({ error: { code: "company_not_ready", message: "Company is not ready for Assistant preview." } }); return;
  }
  if (error instanceof AssistantPreviewKnowledgeUnavailableError) {
    res.status(409).json({ error: { code: "knowledge_unavailable", message: "Company Knowledge is not available for preview." } }); return;
  }
  if (!(error instanceof AnswerGenerationUnavailableError)) console.error("Assistant preview failed.", error);
  res.status(503).json({ error: { code: "assistant_preview_unavailable", message: "Assistant preview is temporarily unavailable." } });
}
