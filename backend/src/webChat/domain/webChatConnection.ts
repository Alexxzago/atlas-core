import type { AssistantProfileId } from "../../assistant/domain/assistantProfile.js";

export type WebChatConnectionId = string & { readonly __brand: "WebChatConnectionId" };
export type WebChatConnectionPublicId = string & { readonly __brand: "WebChatConnectionPublicId" };
export type WebChatConnectionStatus = "active" | "inactive";

export interface WebChatConnection {
  readonly id: WebChatConnectionId;
  readonly publicId: WebChatConnectionPublicId;
  readonly workspaceId: number;
  readonly companyId: number;
  readonly assistantProfileId: AssistantProfileId;
  readonly status: WebChatConnectionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class WebChatConnectionDomainError extends Error {}

function opaque<T extends string>(value: string, prefix: string): T {
  if (!new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(value)) throw new WebChatConnectionDomainError("Web Chat Connection identifier is invalid.");
  return value as T;
}

function timestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new WebChatConnectionDomainError("Web Chat Connection timestamp is invalid.");
  return value;
}

export function webChatConnectionId(value: string): WebChatConnectionId { return opaque<WebChatConnectionId>(value, "wcc"); }
export function webChatConnectionPublicId(value: string): WebChatConnectionPublicId { return opaque<WebChatConnectionPublicId>(value, "wcp"); }
export function webChatConnectionStatus(value: string): WebChatConnectionStatus {
  if (value !== "active" && value !== "inactive") throw new WebChatConnectionDomainError("Web Chat Connection status is invalid.");
  return value;
}

export function reconstructWebChatConnection(value: WebChatConnection): WebChatConnection {
  if (!Number.isSafeInteger(value.workspaceId) || value.workspaceId < 1 || !Number.isSafeInteger(value.companyId) || value.companyId < 1) throw new WebChatConnectionDomainError("Web Chat Connection ownership is invalid.");
  return Object.freeze({ ...value, id: webChatConnectionId(value.id), publicId: webChatConnectionPublicId(value.publicId), status: webChatConnectionStatus(value.status), createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt) });
}
