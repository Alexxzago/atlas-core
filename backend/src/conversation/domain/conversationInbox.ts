import type { ConversationControlState } from "./conversationControl.js";

export interface ConversationInboxFilters {
  readonly controlState: ConversationControlState | null;
  readonly state: "open" | "closed" | null;
  readonly channel: "internal" | "web_chat" | "whatsapp" | null;
  readonly unreadOnly: boolean;
}

export interface ConversationInboxPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

interface CursorPayload extends ConversationInboxFilters {
  readonly v: 1;
  readonly w: number;
  readonly c: number;
  readonly a: string;
  readonly i: string;
}

export function encodeConversationInboxCursor(value: Omit<CursorPayload, "v">): string {
  return Buffer.from(JSON.stringify({ v: 1, ...value }), "utf8").toString("base64url");
}

export function decodeConversationInboxCursor(value: string, workspaceId: number, companyId: number, filters: ConversationInboxFilters): Pick<CursorPayload, "a" | "i"> | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<CursorPayload>;
    if (parsed.v !== 1 || parsed.w !== workspaceId || parsed.c !== companyId || parsed.a === undefined || typeof parsed.a !== "string" || typeof parsed.i !== "string" || parsed.controlState !== filters.controlState || parsed.state !== filters.state || parsed.channel !== filters.channel || parsed.unreadOnly !== filters.unreadOnly) return null;
    return { a: parsed.a, i: parsed.i };
  } catch { return null; }
}
