export interface GoogleCloudSpeechServiceAccountConfiguration {
  readonly projectId: string;
  readonly clientEmail: string;
  readonly privateKey: string;
  readonly tokenUri: "https://oauth2.googleapis.com/token";
}

export class GoogleCloudSpeechConfigurationError extends Error {
  public constructor() { super("Google Cloud speech configuration is invalid."); }
}

export function googleCloudSpeechConfiguration(environment: NodeJS.ProcessEnv = process.env): GoogleCloudSpeechServiceAccountConfiguration | null {
  const encoded = environment.GOOGLE_CLOUD_SPEECH_SERVICE_ACCOUNT_JSON_B64?.trim();
  if (!encoded) return null;
  try {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) throw new Error();
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(encoded, "base64"));
    const value: unknown = JSON.parse(decoded);
    if (!isRecord(value) || value.type !== "service_account" || !validText(value.project_id, 1, 256) || !validText(value.client_email, 3, 320) || !validText(value.private_key, 64, 32_768) || value.token_uri !== "https://oauth2.googleapis.com/token") throw new Error();
    return Object.freeze({ projectId: value.project_id, clientEmail: value.client_email, privateKey: value.private_key, tokenUri: value.token_uri });
  } catch { throw new GoogleCloudSpeechConfigurationError(); }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validText(value: unknown, minimum: number, maximum: number): value is string { return typeof value === "string" && value.trim().length >= minimum && value.length <= maximum; }
