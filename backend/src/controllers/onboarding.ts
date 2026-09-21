import type { RequestHandler } from "express";
import type { OnboardingService } from "../services/onboardingService.js";
import type { WorkspaceContext } from "../types/workspaceContext.js";
import type { ActorContext } from "../knowledge/domain/actorContext.js";
import {
  CompanyNotFoundError,
  CompanyValidationError,
} from "../services/companyValidation.js";
import { abuseScope } from "../abuse/sharedRateLimitRepository.js";
import { AbuseLimitExceededError, companyOnboardingActorLimit, companyOnboardingCompanyLimit, type RateLimitService } from "../abuse/rateLimitService.js";

export function createOnboardingController(service: OnboardingService, context: WorkspaceContext, actor?: ActorContext, limits?: RateLimitService): RequestHandler {
  return async (req, res): Promise<void> => {
    try {
      await service.validateTarget(context, req.params.companyId, req.body?.url);
      if (actor && limits) { const companyId = Number(req.params.companyId); await limits.enforce(abuseScope("workspace", context.workspaceId, "company", companyId, "actor", actor.userId), "actor", companyOnboardingActorLimit); await limits.enforce(abuseScope("workspace", context.workspaceId, "company", companyId), "company", companyOnboardingCompanyLimit); }
      const result = await service.onboard(context, req.params.companyId, req.body?.url, actor);
      res.json(result);
    } catch (error: unknown) {
      if (error instanceof AbuseLimitExceededError) { res.setHeader("Retry-After", String(error.retryAfterSeconds)); res.status(429).json({ error: { code: "rate_limited", message: "Request is temporarily unavailable." } }); return; }
      if (error instanceof CompanyValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof CompanyNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      console.error("Onboarding failed.", error);
      res.status(500).json({ error: "Unable to onboard company." });
    }
  };
}
