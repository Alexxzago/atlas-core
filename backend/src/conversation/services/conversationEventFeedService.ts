import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { ConversationRepositoryPort } from "../application/ports.js";
import { decodeConversationEventFeedCursor, encodeConversationEventFeedCursor } from "../domain/conversationEventFeed.js";

export class ConversationEventFeedValidationError extends Error {}
export class ConversationEventFeedNotFoundError extends Error {}
export class ConversationEventFeedService {
  public constructor(private readonly conversations: ConversationRepositoryPort) {}
  public async read(context: WorkspaceContext, companyIdValue: unknown, afterValue: unknown, limitValue: unknown) {
    const companyId = parseCompanyId(companyIdValue);
    if (!await this.conversations.hasCompany(context, companyId)) throw new ConversationEventFeedNotFoundError();
    const limit = parseLimit(limitValue), tail = await this.conversations.conversationEventTail(context, companyId);
    if (afterValue === undefined) return Object.freeze({ events: [], nextCursor: cursor(context, companyId, tail), hasMore: false, resyncRequired: false });
    let after: number;
    try { const decoded = decodeConversationEventFeedCursor(afterValue); if (decoded.w !== context.workspaceId || decoded.c !== companyId || decoded.s > tail) throw new Error(); after = decoded.s; }
    catch { return Object.freeze({ events: [], nextCursor: cursor(context, companyId, tail), hasMore: false, resyncRequired: true }); }
    const rows = await this.conversations.listConversationEventsAfter(context, companyId, after, limit + 1), events = rows.slice(0, limit);
    return Object.freeze({ events, nextCursor: cursor(context, companyId, events.length === 0 ? after : events[events.length - 1]!.sequence), hasMore: rows.length > limit, resyncRequired: false });
  }
}
function parseCompanyId(value: unknown): number { const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN; if (!Number.isSafeInteger(parsed) || parsed < 1) throw new ConversationEventFeedValidationError(); return parsed; }
function parseLimit(value: unknown): number { if (value === undefined) return 25; if (typeof value !== "string" || !/^[1-9][0-9]?$|^100$/.test(value)) throw new ConversationEventFeedValidationError(); return Number(value); }
function cursor(context: WorkspaceContext, companyId: number, sequence: number): string { return encodeConversationEventFeedCursor({ v: 1, w: context.workspaceId, c: companyId, s: sequence }); }
