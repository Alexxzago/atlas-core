import { reconstructUser, type User, type UserStatus } from "./user.js";

export class InvalidUserStatusTransitionError extends Error {
  public constructor(current: UserStatus, target: UserStatus) {
    super(`User status cannot transition from ${current} to ${target}.`);
  }
}

const allowedTransitions = {
  pending_verification: ["disabled", "deleted"],
  active: ["locked", "disabled", "deleted"],
  locked: ["active", "disabled", "deleted"],
  disabled: ["active", "deleted"],
  deleted: [],
} as const satisfies Readonly<Record<UserStatus, readonly UserStatus[]>>;

export function transitionUserStatus(user: User, target: UserStatus, timestamp: string): User {
  const hasVerifiedIdentity = user.authenticationIdentities.some((identity) => identity.emailVerified);
  if (!(allowedTransitions[user.status] as readonly UserStatus[]).includes(target)
    || ((target === "active" || target === "locked") && !hasVerifiedIdentity)) {
    throw new InvalidUserStatusTransitionError(user.status, target);
  }
  return reconstructUser({
    ...user,
    status: target,
    authenticationIdentities: user.authenticationIdentities,
    updatedAt: timestamp,
  });
}
