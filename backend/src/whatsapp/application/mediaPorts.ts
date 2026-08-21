import type { WorkspaceContext } from "../../types/workspaceContext.js";
import type { WhatsAppInboundMediaDescriptor, WhatsAppInboundMediaFailure } from "../domain/whatsappInboundMedia.js";

export interface WhatsAppInboundMediaDownload { readonly mediaType: string; readonly filename: string | null; readonly content: AsyncIterable<Uint8Array>; }
export type WhatsAppInboundMediaDownloadResult = { readonly kind: "downloaded"; readonly download: WhatsAppInboundMediaDownload } | { readonly kind: "not_found" | "unauthorized" | "unavailable" | "invalid_response" | "too_large" | "timeout" | "unsafe_location" };
export class WhatsAppInboundMediaDownloadStreamError extends Error { public constructor(readonly kind: "too_large" | "timeout" | "invalid_response") { super("WhatsApp inbound media stream failed."); } }
/** Provider implementations receive only a scoped connection and opaque provider media identifier. */
export interface WhatsAppInboundMediaProviderPort { download(context: WorkspaceContext, companyId: number, connectionId: string, descriptor: WhatsAppInboundMediaDescriptor): Promise<WhatsAppInboundMediaDownloadResult>; }
export interface WhatsAppInboundMediaOutcome { readonly code: WhatsAppInboundMediaFailure; readonly retryable: boolean; }
