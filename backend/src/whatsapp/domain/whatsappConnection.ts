import type { AssistantProfileId } from "../../assistant/domain/assistantProfile.js";
import type { ConversationId, ConversationParticipantId } from "../../conversation/domain/conversation.js";

export type WhatsAppConnectionId = string & { readonly __brand: "WhatsAppConnectionId" };
export type WhatsAppConversationBindingId = string & { readonly __brand: "WhatsAppConversationBindingId" };
export type WhatsAppConnectionStatus = "active" | "inactive";

export interface WhatsAppConnection {
  readonly id: WhatsAppConnectionId;
  readonly workspaceId: number;
  readonly companyId: number;
  readonly assistantProfileId: AssistantProfileId;
  readonly phoneNumberId: string;
  readonly whatsappBusinessAccountId: string;
  readonly status: WhatsAppConnectionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WhatsAppConversationBinding {
  readonly id: WhatsAppConversationBindingId;
  readonly whatsAppConnectionId: WhatsAppConnectionId;
  readonly waId: string;
  readonly conversationId: ConversationId;
  readonly customerParticipantId: ConversationParticipantId;
  readonly assistantParticipantId: ConversationParticipantId;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class WhatsAppConnectionDomainError extends Error {}

function opaque<T extends string>(value: string, prefix: string): T { if (!new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(value)) throw new WhatsAppConnectionDomainError("WhatsApp identifier is invalid."); return value as T; }
function timestamp(value: string): string { if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new WhatsAppConnectionDomainError("WhatsApp timestamp is invalid."); return value; }
function identifier(value: string, label: string): string { const normalized = value.normalize("NFKC").trim(); if (!normalized || Array.from(normalized).length > 256) throw new WhatsAppConnectionDomainError(`${label} is invalid.`); return normalized; }

export function whatsAppConnectionId(value: string): WhatsAppConnectionId { return opaque<WhatsAppConnectionId>(value, "wac"); }
export function whatsAppConversationBindingId(value: string): WhatsAppConversationBindingId { return opaque<WhatsAppConversationBindingId>(value, "wcb"); }
export function whatsAppConnectionStatus(value: string): WhatsAppConnectionStatus { if (value !== "active" && value !== "inactive") throw new WhatsAppConnectionDomainError("WhatsApp Connection status is invalid."); return value; }

export function reconstructWhatsAppConnection(value: WhatsAppConnection): WhatsAppConnection {
  if (!Number.isSafeInteger(value.workspaceId) || value.workspaceId < 1 || !Number.isSafeInteger(value.companyId) || value.companyId < 1) throw new WhatsAppConnectionDomainError("WhatsApp Connection ownership is invalid.");
  return Object.freeze({ ...value, id: whatsAppConnectionId(value.id), phoneNumberId: identifier(value.phoneNumberId, "Phone Number ID"), whatsappBusinessAccountId: identifier(value.whatsappBusinessAccountId, "WhatsApp Business Account ID"), status: whatsAppConnectionStatus(value.status), createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt) });
}

export function reconstructWhatsAppConversationBinding(value: WhatsAppConversationBinding): WhatsAppConversationBinding {
  return Object.freeze({ ...value, id: whatsAppConversationBindingId(value.id), whatsAppConnectionId: whatsAppConnectionId(value.whatsAppConnectionId), waId: identifier(value.waId, "WhatsApp sender ID"), createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt) });
}
