import type { RequestHandler } from "express";
import { InvalidWebsiteUrlError, type OnboardingService } from "../services/onboardingService.js";

export function createOnboardingController(service: OnboardingService): RequestHandler {
  return async (req, res): Promise<void> => {
    try {
      const result = await service.onboard(req.body?.url as unknown as string);
      res.json(result);
    } catch (error: unknown) {
      if (error instanceof InvalidWebsiteUrlError) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error("Onboarding failed.", error);
      res.status(500).json({ error: "Unable to onboard company." });
    }
  };
}
