import type { CredentialEnrollmentDeliveryPort, CredentialEnrollmentDeliveryRequest, EmailVerificationDeliveryPort, EmailVerificationDeliveryRequest, VerificationDeliveryOutcome } from "../application/ports.js";

export class DevelopmentVerificationDelivery implements EmailVerificationDeliveryPort, CredentialEnrollmentDeliveryPort {
  public constructor(mode: string, private readonly write: (message: string) => void) {
    if (mode !== "development") throw new Error("Development verification delivery is forbidden outside development mode.");
  }

  public async deliver(request: EmailVerificationDeliveryRequest|CredentialEnrollmentDeliveryRequest): Promise<VerificationDeliveryOutcome> {
    const url="verificationUrl" in request?request.verificationUrl:request.enrollmentUrl;
    this.write(`Identity proof for ${request.recipient}: ${url}`);
    return "accepted";
  }
}

export class UnavailableVerificationDelivery implements EmailVerificationDeliveryPort, CredentialEnrollmentDeliveryPort {
  public async deliver(_request: EmailVerificationDeliveryRequest|CredentialEnrollmentDeliveryRequest): Promise<VerificationDeliveryOutcome> {
    return "permanent_failure";
  }
}
