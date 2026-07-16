export type EmailAddress = string & { readonly __brand: "EmailAddress" };
export type NormalizedEmail = string & { readonly __brand: "NormalizedEmail" };

export class InvalidEmailAddressError extends Error {
  public constructor() {
    super("Email address is invalid.");
  }
}

export function createEmailAddress(value: string): EmailAddress {
  const email = value.trim();
  const separator = email.lastIndexOf("@");
  const localPart = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const valid = email.length <= 254
    && separator > 0
    && localPart.length <= 64
    && !localPart.startsWith(".")
    && !localPart.endsWith(".")
    && !localPart.includes("..")
    && domain.length > 0
    && domain.includes(".")
    && !domain.startsWith(".")
    && !domain.endsWith(".")
    && !/\s/.test(email);

  if (!valid) throw new InvalidEmailAddressError();
  return email as EmailAddress;
}

export function normalizeEmail(email: EmailAddress): NormalizedEmail {
  return email.toLowerCase() as NormalizedEmail;
}

export function createNormalizedEmail(value: string): NormalizedEmail {
  return normalizeEmail(createEmailAddress(value));
}
