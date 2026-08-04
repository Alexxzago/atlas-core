import type { ConversationInboxItem } from "../types/api";

export type ConversationState = "attention" | "human" | "automated" | "empty" | "unknown";
export interface ConversationListItemViewModel { readonly id: string; readonly identity: string | null; readonly preview: string | null; readonly channel: ConversationInboxItem["channel"]; readonly state: ConversationState; readonly lastActivityAt: string | null; }

export function mapConversationState(item: ConversationInboxItem): ConversationState {
  if (!item.preview) return "empty";
  if (item.controlState === "human_required") return "attention";
  if (item.controlState === "human_controlled") return "human";
  if (item.controlState === "automated") return "automated";
  return "unknown";
}
export function buildConversationListItem(item: ConversationInboxItem): ConversationListItemViewModel { return { id:item.conversationId, identity:item.participant?.trim()||null, preview:item.preview?.trim()||null, channel:item.channel, state:mapConversationState(item), lastActivityAt:item.lastActivityAt||null }; }
export function buildConversationInboxViewModel(items: readonly ConversationInboxItem[]): readonly ConversationListItemViewModel[] { return items.map(buildConversationListItem).sort((a,b)=>(b.lastActivityAt??"").localeCompare(a.lastActivityAt??"")); }
