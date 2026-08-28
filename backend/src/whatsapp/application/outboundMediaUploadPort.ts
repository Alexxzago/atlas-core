import type { WorkspaceContext } from "../../types/workspaceContext.js";

export interface WhatsAppOutboundMediaUploadInput { readonly mediaType: string; readonly filename: string | null; readonly content: Uint8Array; readonly signal: AbortSignal; }
export type WhatsAppOutboundMediaUploadResult = { readonly kind: "uploaded"; readonly providerMediaId: string } | { readonly kind: "retryable"; readonly safeFailureCategory: string } | { readonly kind: "failed"; readonly safeFailureCategory: string };

/** Uploads media only. Sending messages and recording delivery visibility belong to later passes. */
export interface WhatsAppOutboundMediaUploadPort { upload(context: WorkspaceContext, companyId: number, connectionId: string, input: WhatsAppOutboundMediaUploadInput): Promise<WhatsAppOutboundMediaUploadResult>; }
