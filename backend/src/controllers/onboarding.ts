import type { RequestHandler } from "express";
import type { OnboardingService } from "../services/onboardingService.js";
import {
  CompanyNotFoundError,
  CompanyValidationError,
  DuplicateWebsiteError,
} from "../services/companyValidation.js";

export function createOnboardingController(service: OnboardingService): RequestHandler {
  return async (req, res): Promise<void> => {
    try {
      const result = await service.onboard(req.params.companyId, req.body?.url);
      res.json(result);
    } catch (error: unknown) {
      if (error instanceof CompanyValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof CompanyNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof DuplicateWebsiteError) {
        res.status(409).json({ error: error.message });
        return;
      }
      console.error("Onboarding failed.", error);
      res.status(500).json({ error: "Unable to onboard company." });
    }
  };
}
