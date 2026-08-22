export interface GoogleCalendarHttpTransportPort {
  postFreeBusy(input: { readonly accessToken: string; readonly body: string; readonly signal: AbortSignal }): Promise<GoogleCalendarHttpResponse>;
}
export interface GoogleCalendarEventsHttpTransportPort {
  getEvent(input: { readonly accessToken: string; readonly calendarId: string; readonly eventId: string; readonly signal: AbortSignal }): Promise<GoogleCalendarHttpResponse>;
  insertEvent(input: { readonly accessToken: string; readonly calendarId: string; readonly body: string; readonly signal: AbortSignal }): Promise<GoogleCalendarHttpResponse>;
  patchEvent(input: { readonly accessToken: string; readonly calendarId: string; readonly eventId: string; readonly ifMatch: string; readonly body: string; readonly signal: AbortSignal }): Promise<GoogleCalendarHttpResponse>;
  deleteEvent(input: { readonly accessToken: string; readonly calendarId: string; readonly eventId: string; readonly ifMatch: string; readonly signal: AbortSignal }): Promise<GoogleCalendarHttpResponse>;
}

export interface GoogleCalendarHttpResponse { readonly status: number; readonly body: string; }
export class GoogleCalendarTransportError extends Error { public constructor(readonly kind: "too_large") { super("Google Calendar response is invalid."); } }

/** Fixed-purpose Google Calendar transport. The API origin and path are never connection-configurable. */
export class GoogleCalendarHttpTransport implements GoogleCalendarHttpTransportPort, GoogleCalendarEventsHttpTransportPort {
  public constructor(private readonly fetcher: typeof fetch = fetch, private readonly timeoutMilliseconds = 8_000, private readonly maximumResponseBytes = 65_536) {}
  public async postFreeBusy(input: { readonly accessToken: string; readonly body: string; readonly signal: AbortSignal }): Promise<GoogleCalendarHttpResponse> {
    return this.request("POST", "https://www.googleapis.com/calendar/v3/freeBusy", input.accessToken, input.signal, input.body);
  }
  public async getEvent(input: { readonly accessToken: string; readonly calendarId: string; readonly eventId: string; readonly signal: AbortSignal }): Promise<GoogleCalendarHttpResponse> { return this.request("GET", eventUrl(input.calendarId, input.eventId), input.accessToken, input.signal); }
  public async insertEvent(input: { readonly accessToken: string; readonly calendarId: string; readonly body: string; readonly signal: AbortSignal }): Promise<GoogleCalendarHttpResponse> { return this.request("POST", eventCollectionUrl(input.calendarId), input.accessToken, input.signal, input.body); }
  public async patchEvent(input: { readonly accessToken: string; readonly calendarId: string; readonly eventId: string; readonly ifMatch: string; readonly body: string; readonly signal: AbortSignal }): Promise<GoogleCalendarHttpResponse> { return this.request("PATCH", eventUrl(input.calendarId, input.eventId), input.accessToken, input.signal, input.body, input.ifMatch); }
  public async deleteEvent(input: { readonly accessToken: string; readonly calendarId: string; readonly eventId: string; readonly ifMatch: string; readonly signal: AbortSignal }): Promise<GoogleCalendarHttpResponse> { return this.request("DELETE", eventUrl(input.calendarId, input.eventId), input.accessToken, input.signal, undefined, input.ifMatch); }
  private async request(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, accessToken: string, externalSignal: AbortSignal, body?: string, ifMatch?: string): Promise<GoogleCalendarHttpResponse> { const signal = AbortSignal.any([externalSignal, AbortSignal.timeout(this.timeoutMilliseconds)]); const response = await this.fetcher(url, { method, redirect: "error", signal, headers: { authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(ifMatch === undefined ? {} : { "if-match": ifMatch }) }, ...(body === undefined ? {} : { body }) }); return { status: response.status, body: await boundedText(response, this.maximumResponseBytes, signal) }; }
}

async function boundedText(response: Response, maximum: number, signal: AbortSignal): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  try { while (true) { if (signal.aborted) throw new DOMException("Aborted", "AbortError"); const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > maximum) { await reader.cancel(); throw new GoogleCalendarTransportError("too_large"); } chunks.push(next.value); } return new TextDecoder().decode(concat(chunks, size)); }
  finally { reader.releaseLock(); }
}
function concat(chunks: readonly Uint8Array[], size: number): Uint8Array { const output = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return output; }
function eventCollectionUrl(calendarId: string): string { return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`; }
function eventUrl(calendarId: string, eventId: string): string { return `${eventCollectionUrl(calendarId)}/${encodeURIComponent(eventId)}`; }
