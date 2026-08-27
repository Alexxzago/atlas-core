export interface ConversationEventFeedCursor { readonly v: 1; readonly w: number; readonly c: number; readonly s: number; }
export class ConversationEventFeedCursorError extends Error {}

export function encodeConversationEventFeedCursor(value: ConversationEventFeedCursor): string { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
export function decodeConversationEventFeedCursor(value: unknown): ConversationEventFeedCursor {
  if (typeof value !== "string" || value.length < 1 || value.length > 500 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new ConversationEventFeedCursorError();
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); } catch { throw new ConversationEventFeedCursorError(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ConversationEventFeedCursorError();
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== 4 || record.v !== 1 || !positive(record.w) || !positive(record.c) || !sequence(record.s)) throw new ConversationEventFeedCursorError();
  return Object.freeze({ v: 1, w: record.w, c: record.c, s: record.s });
}
function positive(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function sequence(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
