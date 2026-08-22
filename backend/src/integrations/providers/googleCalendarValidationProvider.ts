import type { IntegrationProviderValidationPort } from "../application/ports.js";
import type { GoogleCalendarAccessTokenProviderPort } from "./googleCalendarFreeBusyProvider.js";

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1";
const FREE_BUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";

export interface GoogleCalendarValidationHttpTransportPort {
  getEvents(input: { readonly accessToken: string; readonly signal: AbortSignal }): Promise<{ readonly status: number; readonly body: string }>;
  postFreeBusy(input: { readonly accessToken: string; readonly body: string; readonly signal: AbortSignal }): Promise<{ readonly status: number; readonly body: string }>;
}

export class GoogleCalendarValidationHttpTransport implements GoogleCalendarValidationHttpTransportPort {
  public constructor(private readonly fetcher: typeof fetch = fetch, private readonly timeoutMilliseconds = 8_000, private readonly maximumResponseBytes = 16_384) {}
  public getEvents(input: { readonly accessToken: string; readonly signal: AbortSignal }): Promise<{ readonly status: number; readonly body: string }> { return this.request(EVENTS_URL, "GET", input.accessToken, input.signal); }
  public postFreeBusy(input: { readonly accessToken: string; readonly body: string; readonly signal: AbortSignal }): Promise<{ readonly status: number; readonly body: string }> { return this.request(FREE_BUSY_URL, "POST", input.accessToken, input.signal, input.body); }
  private async request(url: string, method: "GET" | "POST", accessToken: string, externalSignal: AbortSignal, body?: string): Promise<{ readonly status: number; readonly body: string }> { const signal = AbortSignal.any([externalSignal, AbortSignal.timeout(this.timeoutMilliseconds)]); const response = await this.fetcher(url, { method, redirect: "error", signal, headers: { authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body }) }); return { status: response.status, body: await boundedText(response, this.maximumResponseBytes, signal) }; }
}

export class GoogleCalendarValidationProvider implements IntegrationProviderValidationPort {
  public constructor(private readonly tokens: GoogleCalendarAccessTokenProviderPort, private readonly transport: GoogleCalendarValidationHttpTransportPort, private readonly clock: { now(): string }) {}
  public async validate(input: Parameters<IntegrationProviderValidationPort["validate"]>[0]): ReturnType<IntegrationProviderValidationPort["validate"]> {
    if (input.provider !== "google_calendar" || input.kind !== "calendar") return invalid("provider_identity_mismatch");
    const secret = material(input.plaintextSecret); if (!secret) return invalid("credentials_invalid");
    const signal = new AbortController().signal, token = await this.tokens.acquire(secret, signal); if (token.kind !== "success") return invalid(token.kind === "unauthorized" ? "credentials_invalid" : token.kind === "timeout" ? "provider_timeout" : token.kind === "validation_error" || token.kind === "invalid_response" ? "provider_rejected" : "provider_unavailable");
    try {
      const events = await this.transport.getEvents({ accessToken: token.accessToken, signal }); const eventFailure = response(events.status, events.body, "events"); if (eventFailure) return invalid(eventFailure);
      const now = new Date(this.clock.now()); if (Number.isNaN(now.valueOf())) return invalid("provider_rejected"); const busy = await this.transport.postFreeBusy({ accessToken: token.accessToken, signal, body: JSON.stringify({ timeMin: now.toISOString(), timeMax: new Date(now.valueOf() + 300_000).toISOString(), timeZone: "UTC", items: [{ id: "primary" }] }) }); const busyFailure = response(busy.status, busy.body, "busy"); return busyFailure ? invalid(busyFailure) : { status: "valid" };
    } catch (error: unknown) { return invalid(error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError") || typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError" ? "provider_timeout" : "provider_unavailable"); }
  }
}

function material(secret: string): { readonly version: "v1"; readonly opaqueSecret: string } | null { try { const value: unknown = JSON.parse(secret); if (!value || typeof value !== "object" || Array.isArray(value)) return null; const row = value as Record<string, unknown>; return row.version === "v1" && typeof row.opaqueSecret === "string" && row.opaqueSecret.trim() && row.opaqueSecret.length <= 16_000 ? { version: "v1", opaqueSecret: row.opaqueSecret } : null; } catch { return null; } }
function response(status: number, body: string, probe: "events" | "busy"): "credentials_invalid" | "provider_rejected" | "provider_unavailable" | "provider_timeout" | null { if (status === 401) return "credentials_invalid"; if (status === 403) return "provider_rejected"; if (status === 429 || status >= 500) return "provider_unavailable"; if (status === 408 || status === 504) return "provider_timeout"; if (status < 200 || status >= 300) return "provider_rejected"; try { const value: unknown = JSON.parse(body); if (!value || typeof value !== "object" || Array.isArray(value)) return "provider_rejected"; const row = value as Record<string, unknown>; if (probe === "events") return Array.isArray(row.items) ? null : "provider_rejected"; const calendars = row.calendars; if (!calendars || typeof calendars !== "object" || Array.isArray(calendars)) return "provider_rejected"; const primary = (calendars as Record<string, unknown>).primary; return primary && typeof primary === "object" && !Array.isArray(primary) && !("errors" in primary) && Array.isArray((primary as Record<string, unknown>).busy) ? null : "provider_rejected"; } catch { return "provider_rejected"; } }
function invalid(failureCode: "credentials_invalid" | "provider_identity_mismatch" | "provider_unavailable" | "provider_timeout" | "provider_rejected") { return { status: "invalid" as const, failureCode }; }
async function boundedText(response: Response, maximum: number, signal: AbortSignal): Promise<string> { if (!response.body) return ""; const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0; try { while (true) { if (signal.aborted) throw new DOMException("Aborted", "AbortError"); const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > maximum) { await reader.cancel(); throw new GoogleCalendarValidationResponseTooLargeError(); } chunks.push(next.value); } const output = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return new TextDecoder("utf-8", { fatal: true }).decode(output); } finally { reader.releaseLock(); } }
export class GoogleCalendarValidationResponseTooLargeError extends Error { public constructor() { super("Google Calendar validation response is invalid."); } }
