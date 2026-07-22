import type { RequestHandler, Response } from "express";
import type { OperationalAssistantExecutionService } from "../assistant/services/operationalAssistantExecutionService.js";
import { OperationalAssistantCompanyNotReadyError, OperationalAssistantExecutionNotFoundError, OperationalAssistantExecutionRateLimitedError, OperationalAssistantExecutionValidationError, OperationalAssistantKnowledgeUnavailableError, OperationalAssistantProfileNotExecutableError } from "../assistant/services/operationalAssistantExecutionService.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";

export function createOperationalAssistantExecutionController(service: OperationalAssistantExecutionService, context: WorkspaceContext): RequestHandler {
  return async (req, res): Promise<void> => {
    try {
      const result = await service.execute(context, req.params.companyId, req.body);
      res.json({ status: result.outcome, answer: result.answer });
    } catch (error: unknown) { respond(res, error); }
  };
}

function respond(res: Response, error: unknown): void {
  if (error instanceof OperationalAssistantExecutionValidationError) { res.status(400).json({ error: { code: "invalid_assistant_execution_request", message: "A valid Assistant Profile and message are required." } }); return; }
  if (error instanceof OperationalAssistantExecutionNotFoundError) { res.status(404).json({ error: "Resource not found." }); return; }
  if (error instanceof OperationalAssistantProfileNotExecutableError) { res.status(409).json({ error: { code: "assistant_profile_not_executable", message: "Assistant Profile is not ready for execution." } }); return; }
  if (error instanceof OperationalAssistantCompanyNotReadyError) { res.status(409).json({ error: { code: "company_not_ready", message: "Company is not ready for Assistant execution." } }); return; }
  if (error instanceof OperationalAssistantKnowledgeUnavailableError) { res.status(409).json({ error: { code: "knowledge_unavailable", message: "Company Knowledge is not available for execution." } }); return; }
  if (error instanceof OperationalAssistantExecutionRateLimitedError) { res.status(429).json({ error: { code: "assistant_execution_rate_limited", message: "Assistant execution is temporarily rate limited." } }); return; }
  res.status(503).json({ error: { code: "assistant_execution_unavailable", message: "Assistant execution is temporarily unavailable." } });
}
