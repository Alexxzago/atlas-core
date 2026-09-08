import type { RequestHandler, Response } from "express";
import type { ActorContext } from "../knowledge/domain/actorContext.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import { ProactiveActionOperatorConflictError, ProactiveActionOperatorNotFoundError, ProactiveActionOperatorService, ProactiveActionOperatorValidationError } from "../proactive/services/proactiveActionOperatorService.js";
import { AbuseLimitExceededError } from "../abuse/rateLimitService.js";

export function createProactiveActionControllers(service: ProactiveActionOperatorService) {
  const respond = (res: Response, error: unknown): void => { if (error instanceof AbuseLimitExceededError) { res.setHeader("Retry-After", String(error.retryAfterSeconds)); res.status(429).json({ error: { code: "rate_limited", message: "Request is temporarily unavailable." } }); return; } if (error instanceof ProactiveActionOperatorValidationError) { res.status(400).json({ error: "Proactive action is invalid." }); return; } if (error instanceof ProactiveActionOperatorNotFoundError) { res.status(404).json({ error: "Resource not found." }); return; } if (error instanceof ProactiveActionOperatorConflictError) { res.status(409).json({ error: { code: error.code, message: "Proactive action could not be applied." } }); return; } res.status(500).json({ error: "Proactive action could not be applied." }); };
  return {
    policy: (context: WorkspaceContext): RequestHandler => (req, res) => { try { res.json(service.policy(context, req.params.companyId)); } catch (error) { respond(res, error); } },
    updatePolicy: (context: WorkspaceContext, actor: ActorContext): RequestHandler => (req, res) => { try { res.json(service.updatePolicy(context, actor.userId, req.params.companyId, req.body)); } catch (error) { respond(res, error); } },
    create: (context: WorkspaceContext, actor: ActorContext): RequestHandler => (req, res) => { try { res.status(201).json(service.create(context, actor.userId, req.params.companyId, req.params.conversationId, req.body)); } catch (error) { respond(res, error); } },
    list: (context: WorkspaceContext): RequestHandler => (req, res) => { try { res.json({ items: service.list(context, req.params.companyId) }); } catch (error) { respond(res, error); } },
    detail: (context: WorkspaceContext): RequestHandler => (req, res) => { try { res.json(service.detail(context, req.params.companyId, req.params.actionId)); } catch (error) { respond(res, error); } },
    cancel: (context: WorkspaceContext, actor: ActorContext): RequestHandler => (req, res) => { try { res.json(service.cancel(context, actor.userId, req.params.companyId, req.params.actionId, req.body)); } catch (error) { respond(res, error); } },
  };
}
