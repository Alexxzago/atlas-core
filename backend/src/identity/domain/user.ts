import { createEmailAddress, normalizeEmail, type EmailAddress, type NormalizedEmail } from "./email.js";

export type UserId = string & { readonly __brand: "UserId" };
export type AuthenticationIdentityId = string & { readonly __brand: "AuthenticationIdentityId" };
export type UserStatus = "pending_verification" | "active" | "locked" | "disabled" | "deleted";
export type Locale = "en" | "es";

export interface AuthenticationIdentity {
  readonly id: AuthenticationIdentityId;
  readonly email: EmailAddress;
  readonly normalizedEmail: NormalizedEmail;
  readonly emailVerified: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface User {
  readonly id: UserId;
  readonly status: UserStatus;
  readonly locale: Locale;
  readonly authenticationIdentities: readonly AuthenticationIdentity[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PendingUserInput {
  userId: string;
  authenticationIdentityId: string;
  email: string;
  locale: Locale;
  timestamp: string;
}

export interface UserState {
  id: string;
  status: UserStatus;
  locale: Locale;
  authenticationIdentities: readonly {
    id: string;
    email: string;
    normalizedEmail: string;
    emailVerified: boolean;
    createdAt: string;
    updatedAt: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

export class InvalidIdentityStateError extends Error {
  public constructor(message = "Identity state is invalid.") {
    super(message);
  }
}

function createIdentifier<T extends string>(value: string, label: string): T {
  const identifier = value.trim();
  if (identifier.length === 0) throw new InvalidIdentityStateError(`${label} is required.`);
  return identifier as T;
}

function validateTimestamp(value: string): string {
  if (value.length === 0 || !Number.isFinite(Date.parse(value))) {
    throw new InvalidIdentityStateError("Identity timestamp is invalid.");
  }
  return value;
}

function validateLocale(value: string): Locale {
  if (value !== "en" && value !== "es") throw new InvalidIdentityStateError("Locale is not supported.");
  return value;
}

function validateStatus(value: string): UserStatus {
  if (value !== "pending_verification" && value !== "active" && value !== "locked"
    && value !== "disabled" && value !== "deleted") {
    throw new InvalidIdentityStateError("User status is invalid.");
  }
  return value;
}

export function createPendingUser(input: PendingUserInput): User {
  return reconstructUser({
    id: input.userId,
    status: "pending_verification",
    locale: input.locale,
    authenticationIdentities: [{
      id: input.authenticationIdentityId,
      email: input.email,
      normalizedEmail: normalizeEmail(createEmailAddress(input.email)),
      emailVerified: false,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
    }],
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  });
}

export function reconstructUser(state: UserState): User {
  if (state.authenticationIdentities.length === 0) {
    throw new InvalidIdentityStateError("User requires an authentication identity.");
  }

  const normalizedEmails = new Set<string>();
  const identities = state.authenticationIdentities.map((identity): AuthenticationIdentity => {
    const email = createEmailAddress(identity.email);
    const normalizedEmail = normalizeEmail(email);
    if (identity.normalizedEmail !== normalizedEmail) {
      throw new InvalidIdentityStateError("Normalized email does not match the email address.");
    }
    if (normalizedEmails.has(normalizedEmail)) {
      throw new InvalidIdentityStateError("Authentication identities must have unique normalized emails.");
    }
    normalizedEmails.add(normalizedEmail);
    return Object.freeze({
      id: createIdentifier<AuthenticationIdentityId>(identity.id, "Authentication identity ID"),
      email,
      normalizedEmail,
      emailVerified: identity.emailVerified,
      createdAt: validateTimestamp(identity.createdAt),
      updatedAt: validateTimestamp(identity.updatedAt),
    });
  });

  const status = validateStatus(state.status);
  const hasVerifiedIdentity = identities.some((identity) => identity.emailVerified);
  if ((status === "active" || status === "locked") && !hasVerifiedIdentity) {
    throw new InvalidIdentityStateError("Active and locked users require a verified authentication identity.");
  }
  if (status === "pending_verification" && hasVerifiedIdentity) {
    throw new InvalidIdentityStateError("Pending users cannot have a verified authentication identity.");
  }

  return Object.freeze({
    id: createIdentifier<UserId>(state.id, "User ID"),
    status,
    locale: validateLocale(state.locale),
    authenticationIdentities: Object.freeze(identities),
    createdAt: validateTimestamp(state.createdAt),
    updatedAt: validateTimestamp(state.updatedAt),
  });
}

export function userId(value: string): UserId {
  return createIdentifier<UserId>(value, "User ID");
}
