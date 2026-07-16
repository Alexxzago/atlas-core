import type { RequestHandler } from "express";
import { InvalidEmailAddressError } from "../identity/domain/email.js";
import type { Locale } from "../identity/domain/user.js";
import type { RegistrationService } from "../identity/services/registrationService.js";
import type { ResendEmailVerificationService } from "../identity/services/resendEmailVerificationService.js";
import type { VerifyEmailService } from "../identity/services/verifyEmailService.js";

function registrationInput(body: unknown): { email: string; locale: Locale } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new InvalidEmailAddressError();
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "email" && key !== "locale")
    || typeof record.email !== "string" || (record.locale !== "en" && record.locale !== "es")) {
    throw new InvalidEmailAddressError();
  }
  return { email: record.email, locale: record.locale };
}

export function createRegistrationController(service: RegistrationService): RequestHandler {
  return async (request, response) => {
    try {
      const input = registrationInput(request.body);
      await service.register(input.email, input.locale);
      response.status(202).json({ status: "verification_requested" });
    } catch (error: unknown) {
      if (error instanceof InvalidEmailAddressError) { response.status(400).json({ error: "Invalid registration input." }); return; }
      response.status(202).json({ status: "verification_requested" });
    }
  };
}

export function createResendVerificationController(service: ResendEmailVerificationService): RequestHandler {
  return async (request, response) => {
    try {
      const input = registrationInput(request.body);
      await service.resend(input.email, input.locale);
      response.status(202).json({ status: "verification_requested" });
    } catch (error: unknown) {
      if (error instanceof InvalidEmailAddressError) { response.status(400).json({ error: "Invalid verification request." }); return; }
      response.status(202).json({ status: "verification_requested" });
    }
  };
}

export function createVerifyEmailController(service: VerifyEmailService): RequestHandler {
  return (request, response) => {
    const proof = request.query.proof;
    if (typeof proof !== "string" || Object.keys(request.query).some((key) => key !== "proof")) {
      response.status(400).json({ status: "invalid_or_expired" });
      return;
    }
    try {
      const result = service.verify(proof);
      response.status(result === "verified" ? 200 : 400).json({ status: result });
    } catch {
      response.status(503).json({ error: "Verification is temporarily unavailable." });
    }
  };
}
