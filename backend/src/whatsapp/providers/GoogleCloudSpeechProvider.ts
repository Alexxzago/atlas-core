import { createSign } from "node:crypto";
import type { GoogleCloudSpeechServiceAccountConfiguration } from "../../config/googleCloudSpeechConfiguration.js";
import type { SpeechSynthesisPort, SpeechSynthesisResult } from "../application/speechSynthesisPort.js";
import type { SpeechTranscriptionPort, SpeechTranscriptionResult } from "../application/speechTranscriptionPort.js";

const scope = "https://www.googleapis.com/auth/cloud-platform";
const tokenSafetyMarginMilliseconds = 60_000;
const maximumResponseBytes = 16 * 1024 * 1024;

export class GoogleCloudSpeechProvider implements SpeechSynthesisPort, SpeechTranscriptionPort {
  private accessToken: { readonly value: string; readonly expiresAt: number } | null = null;
  private refreshing: Promise<string | null> | null = null;

  public constructor(private readonly credentials: GoogleCloudSpeechServiceAccountConfiguration, private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  public async synthesize(input: Parameters<SpeechSynthesisPort["synthesize"]>[0]): Promise<SpeechSynthesisResult> {
    const token = await this.token(input.signal);
    if (!token) return { kind: "retryable", safeFailureCategory: "provider_unavailable" };
    try {
      const response = await this.fetcher("https://texttospeech.googleapis.com/v1/text:synthesize", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ input: { text: input.text }, audioConfig: { audioEncoding: "OGG_OPUS" } }), signal: input.signal });
      if (!response.ok) return failure(response.status);
      const body = await boundedJson(response), encoded = body.audioContent;
      if (typeof encoded !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) return { kind: "failed", safeFailureCategory: "invalid_response" };
      const audio = Uint8Array.from(Buffer.from(encoded, "base64"));
      return audio.byteLength > 4 && audio.byteLength <= maximumResponseBytes && Buffer.from(audio.subarray(0, 4)).toString("ascii") === "OggS" ? { kind: "completed", audio, mimeType: "audio/ogg" } : { kind: "failed", safeFailureCategory: "invalid_response" };
    } catch { return aborted(input.signal) ? { kind: "retryable", safeFailureCategory: "timeout" } : { kind: "retryable", safeFailureCategory: "provider_unavailable" }; }
  }

  public async transcribe(input: Parameters<SpeechTranscriptionPort["transcribe"]>[0]): Promise<SpeechTranscriptionResult> {
    const token = await this.token(input.signal);
    if (!token) return { kind: "retryable", safeFailureCategory: "provider_unavailable" };
    const encoding = input.mimeType === "audio/ogg" ? "OGG_OPUS" : "LINEAR16";
    try {
      const response = await this.fetcher("https://speech.googleapis.com/v1/speech:recognize", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ config: { encoding, enableAutomaticPunctuation: true }, audio: { content: Buffer.from(input.audio).toString("base64") } }), signal: input.signal });
      if (!response.ok) return failure(response.status);
      const body = await boundedJson(response), result = Array.isArray(body.results) ? body.results[0] : null, alternative = isRecord(result) && Array.isArray(result.alternatives) ? result.alternatives[0] : null;
      if (!isRecord(alternative) || typeof alternative.transcript !== "string" || !alternative.transcript.trim()) return { kind: "failed", safeFailureCategory: "invalid_response" };
      const languageTag = typeof body.languageCode === "string" && body.languageCode.length <= 64 ? body.languageCode : null;
      return { kind: "completed", transcript: alternative.transcript, languageTag };
    } catch { return aborted(input.signal) ? { kind: "retryable", safeFailureCategory: "timeout" } : { kind: "retryable", safeFailureCategory: "provider_unavailable" }; }
  }

  private async token(signal: AbortSignal): Promise<string | null> {
    if (this.accessToken && this.accessToken.expiresAt - tokenSafetyMarginMilliseconds > this.now()) return this.accessToken.value;
    if (!this.refreshing) this.refreshing = this.refresh(signal).finally(() => { this.refreshing = null; });
    try { return await this.refreshing; } catch { return null; }
  }

  private async refresh(signal: AbortSignal): Promise<string | null> {
    const issuedAt = Math.floor(this.now() / 1_000), assertion = signedAssertion(this.credentials, issuedAt);
    try {
      const response = await this.fetcher(this.credentials.tokenUri, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(), signal });
      if (!response.ok) return null;
      const body = await boundedJson(response), token = body.access_token, expires = body.expires_in;
      if (typeof token !== "string" || !token || typeof expires !== "number" || !Number.isFinite(expires) || expires <= 0 || expires > 3_600) return null;
      this.accessToken = { value: token, expiresAt: this.now() + Math.floor(expires * 1_000) };
      return token;
    } catch { return null; }
  }
}

function signedAssertion(credentials: GoogleCloudSpeechServiceAccountConfiguration, issuedAt: number): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  const payload = encode({ iss: credentials.clientEmail, scope, aud: credentials.tokenUri, iat: issuedAt, exp: issuedAt + 3_600 });
  const signingInput = `${encode({ alg: "RS256", typ: "JWT" })}.${payload}`;
  const signer = createSign("RSA-SHA256"); signer.update(signingInput); signer.end();
  return `${signingInput}.${signer.sign(credentials.privateKey).toString("base64url")}`;
}
async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && (declaredLength < 0 || declaredLength > maximumResponseBytes)) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error();
  }
  if (!response.body) throw new Error();
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (size + next.value.byteLength > maximumResponseBytes) {
        await reader.cancel();
        throw new Error();
      }
      size += next.value.byteLength;
      chunks.push(next.value);
    }
  } catch (error: unknown) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!isRecord(value)) throw new Error();
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function aborted(signal: AbortSignal): boolean { return signal.aborted; }
function failure(status: number): SpeechSynthesisResult & SpeechTranscriptionResult { return status === 408 || status === 429 || status >= 500 ? { kind: "retryable", safeFailureCategory: status === 429 ? "rate_limited" : "provider_unavailable" } : { kind: "failed", safeFailureCategory: "provider_rejected" }; }
