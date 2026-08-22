import type { ExternalProviderCredentialMaterial } from "../application/externalProviderCredentials.js";
import type { GoogleCalendarAccessTokenProviderPort } from "./googleCalendarFreeBusyProvider.js";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export class GoogleCalendarOAuthConfigurationError extends Error {}

export class GoogleCalendarAccessTokenProvider implements GoogleCalendarAccessTokenProviderPort {
  public constructor(private readonly clientId: string, private readonly clientSecret: string, private readonly fetcher: typeof fetch = fetch, private readonly timeoutMilliseconds = 8_000, private readonly maximumResponseBytes = 16_384) {
    if (!clientId.trim() || !clientSecret.trim()) throw new GoogleCalendarOAuthConfigurationError("Google Calendar OAuth configuration is invalid.");
  }

  public async acquire(material: ExternalProviderCredentialMaterial, signal: AbortSignal): Promise<Awaited<ReturnType<GoogleCalendarAccessTokenProviderPort["acquire"]>>> {
    const refreshToken = material.version === "v1" ? material.opaqueSecret.trim() : "";
    if (!refreshToken || refreshToken.length > 16_384) return { kind: "validation_error" };
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMilliseconds)]);
    try {
      const response = await this.fetcher(TOKEN_ENDPOINT, { method: "POST", redirect: "error", signal: requestSignal, headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: this.clientId, client_secret: this.clientSecret, refresh_token: refreshToken }).toString() });
      const body = await boundedText(response, this.maximumResponseBytes, requestSignal);
      if (response.status === 400) return invalidGrant(body) ? { kind: "unauthorized" } : { kind: "validation_error" };
      if (response.status === 401) return { kind: "unauthorized" };
      if (response.status === 403) return { kind: "forbidden" };
      if (response.status === 429) return { kind: "rate_limited" };
      if (response.status === 408 || response.status === 504) return { kind: "timeout" };
      if (response.status >= 500) return { kind: "unavailable" };
      if (response.status < 200 || response.status >= 300) return { kind: "validation_error" };
      const accessToken = token(body);
      return accessToken ? { kind: "success", accessToken } : { kind: "invalid_response" };
    } catch (error: unknown) {
      return error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError") || typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError" ? { kind: "timeout" } : { kind: "unavailable" };
    }
  }
}

export function googleCalendarAccessTokenProviderFromEnvironment(clientId: string | undefined, clientSecret: string | undefined, fetcher?: typeof fetch): GoogleCalendarAccessTokenProvider | null {
  const id = clientId?.trim() ?? "", secret = clientSecret?.trim() ?? "";
  if (!id && !secret) return null;
  if (!id || !secret) throw new GoogleCalendarOAuthConfigurationError("GOOGLE_CALENDAR_OAUTH_CLIENT_ID and GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET must both be configured.");
  return new GoogleCalendarAccessTokenProvider(id, secret, fetcher);
}

async function boundedText(response: Response, maximum: number, signal: AbortSignal): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  try { while (true) { if (signal.aborted) throw new DOMException("Aborted", "AbortError"); const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > maximum) { await reader.cancel(); throw new Error("too_large"); } chunks.push(next.value); } return new TextDecoder().decode(concat(chunks, size)); }
  finally { reader.releaseLock(); }
}

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array { const output = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return output; }
function token(body: string): string | null { try { const value: unknown = JSON.parse(body); if (!value || typeof value !== "object" || Array.isArray(value)) return null; const accessToken = (value as Record<string, unknown>).access_token; return typeof accessToken === "string" && accessToken.trim() && accessToken.length <= 16_384 ? accessToken : null; } catch { return null; } }
function invalidGrant(body: string): boolean { try { const value: unknown = JSON.parse(body); return !!value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).error === "invalid_grant"; } catch { return false; } }
