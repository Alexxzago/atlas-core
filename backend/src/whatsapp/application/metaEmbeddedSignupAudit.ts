import type { MetaEmbeddedSignupAuditPort } from "./metaEmbeddedSignupAttemptService.js";

export type MetaEmbeddedSignupOperationalAuditEvent =
  | Parameters<MetaEmbeddedSignupAuditPort["record"]>[0]
  | {
      readonly type:
        | "meta_signup_connection_linked"
        | "meta_signup_waba_subscription_confirmed"
        | "meta_signup_whatsapp_activated"
        | "meta_signup_ready";
      readonly workspaceId: number;
      readonly companyId: number;
      readonly at: string;
      readonly attemptId?: string;
      readonly integrationConnectionId?: string;
      readonly whatsAppConnectionId?: string;
      readonly subscriptionChanged?: boolean;
    };

export interface MetaEmbeddedSignupOperationalAuditPort {
  record(event: MetaEmbeddedSignupOperationalAuditEvent): Promise<void> | void;
}

export class StructuredMetaEmbeddedSignupAudit
  implements MetaEmbeddedSignupAuditPort, MetaEmbeddedSignupOperationalAuditPort {
  public record(event: MetaEmbeddedSignupOperationalAuditEvent): void {
    console.info(JSON.stringify({
      event: event.type,
      timestamp: event.at,
      workspaceId: event.workspaceId,
      companyId: event.companyId,
      ...("attemptId" in event && event.attemptId ? { attemptId: event.attemptId } : {}),
      ...("integrationConnectionId" in event && event.integrationConnectionId ? { integrationConnectionId: event.integrationConnectionId } : {}),
      ...("whatsAppConnectionId" in event && event.whatsAppConnectionId ? { whatsAppConnectionId: event.whatsAppConnectionId } : {}),
      ...("subscriptionChanged" in event && typeof event.subscriptionChanged === "boolean" ? { subscriptionChanged: event.subscriptionChanged } : {}),
    }));
  }
}