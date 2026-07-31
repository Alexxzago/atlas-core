import type { CredentialEnrollmentDeliveryPort, CredentialEnrollmentDeliveryRequest, EmailVerificationDeliveryPort, EmailVerificationDeliveryRequest, PasswordResetDeliveryPort, PasswordResetDeliveryRequest, VerificationDeliveryOutcome } from "../application/ports.js";

export class DevelopmentVerificationDelivery implements EmailVerificationDeliveryPort, CredentialEnrollmentDeliveryPort, PasswordResetDeliveryPort {
  public constructor(mode: string, private readonly write: (message: string) => void) {
    if (mode !== "development") throw new Error("Development verification delivery is forbidden outside development mode.");
  }

  public async deliver(request: EmailVerificationDeliveryRequest|CredentialEnrollmentDeliveryRequest|PasswordResetDeliveryRequest): Promise<VerificationDeliveryOutcome> {
    const url="verificationUrl" in request?request.verificationUrl:"enrollmentUrl" in request?request.enrollmentUrl:request.resetUrl;
    this.write(`Identity proof for ${request.recipient}: ${url}`);
    return "accepted";
  }
}

export class UnavailableVerificationDelivery implements EmailVerificationDeliveryPort, CredentialEnrollmentDeliveryPort, PasswordResetDeliveryPort {
  public async deliver(_request: EmailVerificationDeliveryRequest|CredentialEnrollmentDeliveryRequest|PasswordResetDeliveryRequest): Promise<VerificationDeliveryOutcome> {
    return "permanent_failure";
  }
}
