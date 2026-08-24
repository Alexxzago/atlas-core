import type { MetaWhatsAppVerifiedAsset } from "../application/metaEmbeddedSignup.js";

const GRAPH_ORIGIN = "https://graph.facebook.com";
const DEFAULT_TIMEOUT_MILLISECONDS = 8_000;
const DEFAULT_MAXIMUM_RESPONSE_BYTES = 32 * 1024;
const MAXIMUM_PHONE_NUMBERS = 50;
const MAXIMUM_SUBSCRIBED_APPS = 100;

export type MetaEmbeddedSignupProviderFailure = "unauthorized" | "forbidden" | "not_found" | "conflict" | "rate_limited" | "unavailable" | "timeout" | "invalid_response" | "validation_error";
export type MetaCredentialOutcome = { readonly kind: "success"; readonly credential: { readonly accessToken: string; readonly tokenType?: string; readonly expiresInSeconds?: number } } | { readonly kind: MetaEmbeddedSignupProviderFailure };
export type MetaAssetVerificationOutcome = { readonly kind: "success"; readonly asset: MetaWhatsAppVerifiedAsset } | { readonly kind: MetaEmbeddedSignupProviderFailure };
export type MetaWabaSubscriptionOutcome = { readonly kind: "success"; readonly subscribed: boolean } | { readonly kind: MetaEmbeddedSignupProviderFailure };
export type MetaWabaSubscriptionMutationOutcome = { readonly kind: "success" } | { readonly kind: MetaEmbeddedSignupProviderFailure };

export interface MetaEmbeddedSignupProvider {
  exchangeAuthorizationCode(input: { readonly authorizationCode: string; readonly signal: AbortSignal }): Promise<MetaCredentialOutcome>;
  verifyAssets(input: { readonly whatsappBusinessAccountId: string; readonly phoneNumberId: string; readonly accessToken: string; readonly signal: AbortSignal }): Promise<MetaAssetVerificationOutcome>;
  inspectWabaSubscription(input: { readonly wabaId: string; readonly accessToken: string; readonly signal: AbortSignal }): Promise<MetaWabaSubscriptionOutcome>;
  subscribeWaba(input: { readonly wabaId: string; readonly accessToken: string; readonly signal: AbortSignal }): Promise<MetaWabaSubscriptionMutationOutcome>;
  unsubscribeWaba(input: { readonly wabaId: string; readonly accessToken: string; readonly signal: AbortSignal }): Promise<MetaWabaSubscriptionMutationOutcome>;
}

export class MetaEmbeddedSignupConfigurationError extends Error {}
export class MetaEmbeddedSignupTransportError extends Error {}

export class MetaEmbeddedSignupGraphProvider implements MetaEmbeddedSignupProvider {
  public constructor(
    private readonly configuration: MetaEmbeddedSignupConfiguration,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMilliseconds = DEFAULT_TIMEOUT_MILLISECONDS,
    private readonly maximumResponseBytes = DEFAULT_MAXIMUM_RESPONSE_BYTES
  ) {
    validateConfiguration(configuration);
    if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) throw new MetaEmbeddedSignupConfigurationError("META Embedded Signup timeout configuration is invalid.");
    if (!Number.isSafeInteger(maximumResponseBytes) || maximumResponseBytes < 1) throw new MetaEmbeddedSignupConfigurationError("META Embedded Signup response limit configuration is invalid.");
  }

  public async exchangeAuthorizationCode(input: { readonly authorizationCode: string; readonly signal: AbortSignal }): Promise<MetaCredentialOutcome> {
    if (!secret(input.authorizationCode, 4096)) return { kind: "validation_error" };
    try {
      const response = await this.request(this.oauthUrl(input.authorizationCode), input.signal);
      const outcome = status(response.status, "exchange");
      if (outcome) return outcome;
      return credential(response.body);
    } catch (error: unknown) {
      return failure(error);
    }
  }

  public async verifyAssets(input: { readonly whatsappBusinessAccountId: string; readonly phoneNumberId: string; readonly accessToken: string; readonly signal: AbortSignal }): Promise<MetaAssetVerificationOutcome> {
    if (!metaId(input.whatsappBusinessAccountId) || !metaId(input.phoneNumberId) || !secret(input.accessToken, 4096)) return { kind: "validation_error" };
    try {
      const waba = await this.request(this.wabaUrl(input.whatsappBusinessAccountId), input.signal, input.accessToken);
      const wabaOutcome = status(waba.status, "asset");
      if (wabaOutcome) return wabaOutcome;
      if (!matchingWaba(waba.body, input.whatsappBusinessAccountId)) return { kind: "invalid_response" };
      const phones = await this.request(this.phoneNumbersUrl(input.whatsappBusinessAccountId), input.signal, input.accessToken);
      const phoneOutcome = status(phones.status, "asset");
      if (phoneOutcome) return phoneOutcome;
      return phoneAsset(phones.body, input.whatsappBusinessAccountId, input.phoneNumberId);
    } catch (error: unknown) {
      return failure(error);
    }
  }

  public async inspectWabaSubscription(input: { readonly wabaId: string; readonly accessToken: string; readonly signal: AbortSignal }): Promise<MetaWabaSubscriptionOutcome> {
    if (!metaId(input.wabaId) || !secret(input.accessToken, 4096)) return { kind: "validation_error" };
    try { const response = await this.request(this.subscriptionUrl(input.wabaId), input.signal, input.accessToken, "GET"), outcome = status(response.status, "asset"); return outcome ?? subscription(response.body, this.configuration.appId); } catch (error: unknown) { return failure(error); }
  }
  public async subscribeWaba(input: { readonly wabaId: string; readonly accessToken: string; readonly signal: AbortSignal }): Promise<MetaWabaSubscriptionMutationOutcome> { return this.mutateSubscription(input, "POST"); }
  public async unsubscribeWaba(input: { readonly wabaId: string; readonly accessToken: string; readonly signal: AbortSignal }): Promise<MetaWabaSubscriptionMutationOutcome> { return this.mutateSubscription(input, "DELETE"); }
  private async mutateSubscription(input: { readonly wabaId: string; readonly accessToken: string; readonly signal: AbortSignal }, method: "POST" | "DELETE"): Promise<MetaWabaSubscriptionMutationOutcome> {
    if (!metaId(input.wabaId) || !secret(input.accessToken, 4096)) return { kind: "validation_error" };
    try { const response = await this.request(this.subscriptionUrl(input.wabaId), input.signal, input.accessToken, method), outcome = status(response.status, "asset"); return outcome ?? mutation(response.body); } catch (error: unknown) { return failure(error); }
  }
  private oauthUrl(code: string): string {
    const query = new URLSearchParams({ client_id: this.configuration.appId, client_secret: this.configuration.appSecret, code });
    return `${GRAPH_ORIGIN}/${this.configuration.graphApiVersion}/oauth/access_token?${query.toString()}`;
  }

  private wabaUrl(wabaId: string): string { return `${GRAPH_ORIGIN}/${this.configuration.graphApiVersion}/${wabaId}?fields=id`; }
  private phoneNumbersUrl(wabaId: string): string { return `${GRAPH_ORIGIN}/${this.configuration.graphApiVersion}/${wabaId}/phone_numbers?fields=id%2Cdisplay_phone_number%2Cverified_name&limit=${MAXIMUM_PHONE_NUMBERS}`; }

  private subscriptionUrl(wabaId: string): string { return GRAPH_ORIGIN + "/" + this.configuration.graphApiVersion + "/" + wabaId + "/subscribed_apps"; }
  private async request(url: string, externalSignal: AbortSignal, accessToken?: string, method: "GET" | "POST" | "DELETE" = "GET"): Promise<{ readonly status: number; readonly body: string }> {
    const signal = AbortSignal.any([externalSignal, AbortSignal.timeout(this.timeoutMilliseconds)]);
    const response = await this.fetcher(url, { method, redirect: "error", signal, ...(accessToken === undefined ? {} : { headers: { authorization: `Bearer ${accessToken}` } }) });
    const body = await boundedJson(response, this.maximumResponseBytes, signal);
    return { status: response.status, body };
  }
}

export interface MetaEmbeddedSignupConfiguration { readonly appId: string; readonly appSecret: string; readonly graphApiVersion: string; }

export function metaEmbeddedSignupProviderFromEnvironment(appId = process.env.META_APP_ID, appSecret = process.env.META_APP_SECRET, graphApiVersion = process.env.META_GRAPH_API_VERSION, fetcher: typeof fetch = fetch): MetaEmbeddedSignupGraphProvider | null {
  if (appId === undefined && appSecret === undefined && graphApiVersion === undefined) return null;
  if (appId === undefined || appSecret === undefined || graphApiVersion === undefined) throw new MetaEmbeddedSignupConfigurationError("META_APP_ID, META_APP_SECRET, and META_GRAPH_API_VERSION must be configured together.");
  return new MetaEmbeddedSignupGraphProvider({ appId, appSecret, graphApiVersion }, fetcher);
}

export function validateMetaGraphApiVersion(value: string): string {
  if (!/^v[1-9]\d*\.\d+$/.test(value)) throw new MetaEmbeddedSignupConfigurationError("META_GRAPH_API_VERSION is invalid.");
  return value;
}

function validateConfiguration(value: MetaEmbeddedSignupConfiguration): void {
  if (!metaId(value.appId)) throw new MetaEmbeddedSignupConfigurationError("META_APP_ID is invalid.");
  if (!secret(value.appSecret, 512)) throw new MetaEmbeddedSignupConfigurationError("META_APP_SECRET is invalid.");
  validateMetaGraphApiVersion(value.graphApiVersion);
}

function status(httpStatus: number, operation: "exchange" | "asset"): { readonly kind: MetaEmbeddedSignupProviderFailure } | null {
  if (httpStatus >= 200 && httpStatus < 300) return null;
  if (httpStatus === 400) return { kind: operation === "exchange" ? "unauthorized" : "validation_error" };
  if (httpStatus === 401) return { kind: "unauthorized" };
  if (httpStatus === 403) return { kind: "forbidden" };
  if (httpStatus === 404) return { kind: "not_found" };
  if (httpStatus === 409) return { kind: "conflict" };
  if (httpStatus === 429) return { kind: "rate_limited" };
  if (httpStatus === 408 || httpStatus === 504) return { kind: "timeout" };
  return httpStatus >= 500 ? { kind: "unavailable" } : { kind: "invalid_response" };
}

function credential(body: string): MetaCredentialOutcome {
  try {
    const parsed = jsonObject(body), accessToken = parsed.access_token;
    if (!secretString(accessToken, 4096)) return { kind: "invalid_response" };
    const tokenType = optionalString(parsed.token_type, 64), expiresInSeconds = optionalExpiry(parsed.expires_in);
    if (tokenType === false || expiresInSeconds === false) return { kind: "invalid_response" };
    return Object.freeze({ kind: "success", credential: Object.freeze({ accessToken, ...(tokenType === undefined ? {} : { tokenType }), ...(expiresInSeconds === undefined ? {} : { expiresInSeconds }) }) });
  } catch { return { kind: "invalid_response" }; }
}

function subscription(body: string, appId: string): MetaWabaSubscriptionOutcome {
  try { const data = jsonObject(body).data; if (!Array.isArray(data) || data.length > MAXIMUM_SUBSCRIBED_APPS) return { kind: "invalid_response" }; let subscribed = false; for (const item of data) { const entry = jsonObject(item), authority = entry.whatsapp_business_api_data; if (authority !== undefined) { const value = jsonObject(authority); if (typeof value.id !== "string") return { kind: "invalid_response" }; if (value.id === appId) subscribed = true; } } return Object.freeze({ kind: "success", subscribed }); } catch { return { kind: "invalid_response" }; }
}
function mutation(body: string): MetaWabaSubscriptionMutationOutcome { try { return jsonObject(body).success === true ? { kind: "success" } : { kind: "invalid_response" }; } catch { return { kind: "invalid_response" }; } }
function matchingWaba(body: string, expectedId: string): boolean {
  try { return jsonObject(body).id === expectedId; } catch { return false; }
}

function phoneAsset(body: string, wabaId: string, phoneId: string): MetaAssetVerificationOutcome {
  try {
    const data = jsonObject(body).data;
    if (!Array.isArray(data) || data.length > MAXIMUM_PHONE_NUMBERS) return { kind: "invalid_response" };
    const matches = data.filter(entry => jsonObject(entry).id === phoneId);
    if (matches.length === 0) return { kind: "not_found" };
    if (matches.length !== 1) return { kind: "invalid_response" };
    const selected = jsonObject(matches[0]), displayPhoneNumber = safeDisplay(selected.display_phone_number), verifiedDisplayName = safeDisplay(selected.verified_name);
    if (displayPhoneNumber === false || verifiedDisplayName === false) return { kind: "invalid_response" };
    // The PASS 1 asset contract deliberately retains only the safe phone display.
    return Object.freeze({ kind: "success", asset: Object.freeze({ whatsappBusinessAccountId: wabaId, phoneNumberId: phoneId, displayPhoneNumber: displayPhoneNumber ?? null }) });
  } catch { return { kind: "invalid_response" }; }
}

async function boundedJson(response: Response, maximum: number, signal: AbortSignal): Promise<string> {
  if (!response.body || !isJson(response.headers.get("content-type"))) throw new MetaEmbeddedSignupTransportError("Meta response is invalid.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const next = await reader.read();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) throw new MetaEmbeddedSignupTransportError("Meta response is invalid.");
      size += next.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new MetaEmbeddedSignupTransportError("Meta response is too large."); }
      chunks.push(next.value);
    }
    const output = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(output);
  } finally { reader.releaseLock(); }
}

function failure(error: unknown): { readonly kind: MetaEmbeddedSignupProviderFailure } {
  if (error instanceof MetaEmbeddedSignupTransportError) return { kind: "invalid_response" };
  return error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError") || (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError") ? { kind: "timeout" } : { kind: "unavailable" };
}

function jsonObject(value: unknown): Record<string, unknown> { if (typeof value === "string") return jsonObject(JSON.parse(value)); if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid"); return value as Record<string, unknown>; }
function metaId(value: string): boolean { return /^\d{1,64}$/.test(value); }
function secret(value: string, maximum: number): boolean { return secretString(value, maximum); }
function secretString(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value); }
function optionalString(value: unknown, maximum: number): string | undefined | false { return value === undefined ? undefined : secretString(value, maximum) ? value : false; }
function optionalExpiry(value: unknown): number | undefined | false { return value === undefined ? undefined : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 315_576_000 ? value : false; }
function safeDisplay(value: unknown): string | undefined | false { if (value === undefined) return undefined; if (typeof value !== "string") return false; const normalized = value.normalize("NFKC").trim(); return normalized && Array.from(normalized).length <= 128 && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : false; }
function isJson(contentType: string | null): boolean { return contentType !== null && /^application\/json(?:\s*;|$)/i.test(contentType); }
