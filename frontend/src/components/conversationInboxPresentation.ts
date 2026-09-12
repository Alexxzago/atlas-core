import type { ConversationInboxItem } from "../types/api";

export type ConversationState = "attention" | "human" | "automated" | "empty" | "unknown";
export interface ConversationListItemViewModel { readonly id: string; readonly identity: string | null; readonly preview: string | null; readonly channel: ConversationInboxItem["channel"]; readonly state: ConversationState; readonly controlledByCurrentActor: boolean; readonly attentionRequired: boolean; readonly lastActivityAt: string | null; readonly unreadCount: number; }

export function mapConversationState(item: ConversationInboxItem): ConversationState {
  if (!item.preview) return "empty";
  if (item.controlState === "human_required") return "attention";
  if (item.controlState === "human_controlled") return "human";
  if (item.controlState === "automated") return "automated";
  return "unknown";
}
export function buildConversationListItem(item: ConversationInboxItem): ConversationListItemViewModel { return { id:item.conversationId, identity:item.contactLabel.trim()||null, preview:item.preview?.trim()||null, channel:item.channel, state:mapConversationState(item), controlledByCurrentActor:item.controlledByCurrentActor, attentionRequired:item.controlState==="human_required", lastActivityAt:item.lastActivityAt||null, unreadCount:item.unreadCount }; }
export function buildConversationInboxViewModel(items: readonly ConversationInboxItem[]): readonly ConversationListItemViewModel[] { return items.map(buildConversationListItem).sort((a,b)=>(b.lastActivityAt??"").localeCompare(a.lastActivityAt??"")); }
