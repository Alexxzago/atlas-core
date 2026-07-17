import { reconstructAssistantProfile, type AssistantProfile, type AssistantProfileStatus } from "./assistantProfile.js";

export class AssistantProfilePolicyError extends Error {}

export function nextUpdatedAt(currentUpdatedAt: string, clockValue: string): string {
  const current = timestamp(currentUpdatedAt);
  const clock = timestamp(clockValue);
  if (clock > current) return new Date(clock).toISOString();
  const next = current + 1;
  if (!Number.isSafeInteger(next)) throw new AssistantProfilePolicyError("Assistant Profile timestamp cannot advance.");
  return new Date(next).toISOString();
}

function timestamp(value: string): number {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new AssistantProfilePolicyError("Invalid Assistant Profile timestamp.");
  }
  return parsed.getTime();
}

export class AssistantProfileReadyPolicy {
  public assert(profile: AssistantProfile): void {
    if (!profile.name || !profile.businessRole || !profile.objective || !profile.tone
      || !profile.assistantLanguage || !profile.welcomeMessage || !profile.fallbackMessage) {
      throw new AssistantProfilePolicyError("Assistant Profile is not ready.");
    }
  }
}

export class AssistantProfileExecutionPolicy {
  private readonly ready = new AssistantProfileReadyPolicy();

  public assert(profile: AssistantProfile): void {
    if (profile.status !== "ready") throw new AssistantProfilePolicyError("Assistant Profile is not executable.");
    this.ready.assert(profile);
  }
}

export class AssistantProfileLifecyclePolicy {
  private readonly ready = new AssistantProfileReadyPolicy();

  public transition(profile: AssistantProfile, target: AssistantProfileStatus, at: string): AssistantProfile {
    const allowed: Record<AssistantProfileStatus, readonly AssistantProfileStatus[]> = {
      draft: ["ready", "archived"],
      ready: ["draft", "disabled", "archived"],
      disabled: ["ready", "draft", "archived"],
      archived: ["draft"],
    };
    if (!allowed[profile.status].includes(target)) throw new AssistantProfilePolicyError("Invalid Assistant Profile transition.");
    const updatedAt = nextUpdatedAt(profile.updatedAt, at);
    const changed = reconstructAssistantProfile({
      ...profile,
      status: target,
      updatedAt,
      archivedAt: target === "archived" ? updatedAt : null,
    });
    if (target === "ready") this.ready.assert(changed);
    return changed;
  }
}
