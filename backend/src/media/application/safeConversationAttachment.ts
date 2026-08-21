export interface SafeConversationAttachment {
  readonly kind: "image" | "document" | "audio";
  readonly status: "available";
  readonly filename?: string;
  readonly mimeType?: string;
}
