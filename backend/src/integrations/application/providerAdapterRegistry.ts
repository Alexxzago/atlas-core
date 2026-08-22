import type { IntegrationProviderValidationPort } from "./ports.js";
import type { ExternalBusyProviderPort, ExternalCalendarEventProviderPort } from "../../scheduling/application/externalCalendarPorts.js";

export type ProviderAdapterCapability = "validation" | "calendar_busy" | "calendar_events";
export interface ProviderAdapterRegistration { readonly provider: string; readonly kind: string; readonly validation?: IntegrationProviderValidationPort; readonly calendarBusy?: ExternalBusyProviderPort; readonly calendarEvents?: ExternalCalendarEventProviderPort; }
export interface ProviderAdapterRegistryPort { register(registration: ProviderAdapterRegistration): void; resolveValidation(provider: string, kind: string): IntegrationProviderValidationPort | null; resolveCalendarBusy(provider: string, kind: string): ExternalBusyProviderPort | null; resolveCalendarEvents(provider: string, kind: string): ExternalCalendarEventProviderPort | null; }
export class ProviderAdapterRegistryError extends Error {}
export class ProviderAdapterRegistry implements ProviderAdapterRegistryPort {
  private readonly values = new Map<string, ProviderAdapterRegistration>();
  public register(registration: ProviderAdapterRegistration): void { const key = identity(registration.provider, registration.kind); if (!registration.validation && !registration.calendarBusy && !registration.calendarEvents) throw new ProviderAdapterRegistryError("Provider adapter registration is invalid."); if (this.values.has(key)) throw new ProviderAdapterRegistryError("Provider adapter registration already exists."); this.values.set(key, Object.freeze({ ...registration, provider: registration.provider.trim(), kind: registration.kind.trim() })); }
  public resolveValidation(provider: string, kind: string): IntegrationProviderValidationPort | null { return this.values.get(identity(provider, kind))?.validation ?? null; }
  public resolveCalendarBusy(provider: string, kind: string): ExternalBusyProviderPort | null { return this.values.get(identity(provider, kind))?.calendarBusy ?? null; }
  public resolveCalendarEvents(provider: string, kind: string): ExternalCalendarEventProviderPort | null { return this.values.get(identity(provider, kind))?.calendarEvents ?? null; }
}
/** Bridges the existing Integration Connections validation port to registered adapters. */
export class RegistryIntegrationProviderValidator implements IntegrationProviderValidationPort {
  public constructor(private readonly registry: ProviderAdapterRegistryPort) {}
  public async validate(input: Parameters<IntegrationProviderValidationPort["validate"]>[0]): ReturnType<IntegrationProviderValidationPort["validate"]> { const adapter = this.registry.resolveValidation(input.provider, input.kind); return adapter ? adapter.validate(input) : { status: "invalid", failureCode: "provider_rejected" }; }
}
function identity(provider: string, kind: string): string { const value = `${provider}\u0000${kind}`; if (!/^[a-z][a-z0-9_.-]*\u0000[a-z][a-z0-9_.-]*$/.test(value)) throw new ProviderAdapterRegistryError("Provider adapter identity is invalid."); return value; }
