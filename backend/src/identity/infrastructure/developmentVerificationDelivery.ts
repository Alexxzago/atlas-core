import type { EmailVerificationDeliveryPort, EmailVerificationDeliveryRequest, VerificationDeliveryOutcome } from "../application/ports.js";

export class DevelopmentVerificationDelivery implements EmailVerificationDeliveryPort {
  public constructor(mode: string, private readonly write: (message: string) => void) {
    if (mode !== "development") throw new Error("Development verification delivery is forbidden outside development mode.");
  }

  public async deliver(request: EmailVerificationDeliveryRequest): Promise<VerificationDeliveryOutcome> {
    this.write(`Verification for ${request.recipient}: ${request.verificationUrl}`);
    return "accepted";
  }
}

export class UnavailableVerificationDelivery implements EmailVerificationDeliveryPort {
  public async deliver(_request: EmailVerificationDeliveryRequest): Promise<VerificationDeliveryOutcome> {
    return "permanent_failure";
  }
}
