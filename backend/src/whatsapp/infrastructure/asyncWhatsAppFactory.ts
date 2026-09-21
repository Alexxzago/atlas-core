import type { SqlDatabase } from "../../config/sqlDatabase.js";
import { MetaEmbeddedSignupAttemptRepository } from "../../repositories/metaEmbeddedSignupAttemptRepository.js";
import { SqlMetaEmbeddedSignupCompletionFinalizer } from "../application/metaEmbeddedSignupCompletionFinalizer.js";
import { AsyncWhatsAppConnectionPersistence } from "./asyncWhatsAppConnectionPersistence.js";
import { AsyncWhatsAppConversationPersistence } from "./asyncWhatsAppConversationPersistence.js";
import { AsyncWhatsAppInboundPersistence } from "./asyncWhatsAppInboundPersistence.js";
import { AsyncWhatsAppInboundMediaPersistence } from "./asyncWhatsAppInboundMediaPersistence.js";
import { AsyncWhatsAppOutboundDeliveryPersistence, AsyncWhatsAppProviderMessagePersistence } from "./asyncWhatsAppOutboundPersistence.js";
import { AsyncWhatsAppVoicePersistence } from "./asyncWhatsAppVoicePersistence.js";

/** STEP4B async persistence boundary for durable WhatsApp runtime operations. */
export function createAsyncWhatsAppPersistence(database: SqlDatabase): Readonly<{
  connections: AsyncWhatsAppConnectionPersistence;
  conversations: AsyncWhatsAppConversationPersistence;
  inbound: AsyncWhatsAppInboundPersistence;
  inboundMedia: AsyncWhatsAppInboundMediaPersistence;
  providerMessages: AsyncWhatsAppProviderMessagePersistence;
  outboundDeliveries: AsyncWhatsAppOutboundDeliveryPersistence;
  metaEmbeddedSignupAttempts: MetaEmbeddedSignupAttemptRepository;
  metaEmbeddedSignupFinalizer: SqlMetaEmbeddedSignupCompletionFinalizer;
  voice: AsyncWhatsAppVoicePersistence;
}> {
  return Object.freeze({
    connections: new AsyncWhatsAppConnectionPersistence(database),
    conversations: new AsyncWhatsAppConversationPersistence(database),
    inbound: new AsyncWhatsAppInboundPersistence(database),
    inboundMedia: new AsyncWhatsAppInboundMediaPersistence(database),
    providerMessages: new AsyncWhatsAppProviderMessagePersistence(database),
    outboundDeliveries: new AsyncWhatsAppOutboundDeliveryPersistence(database),
    metaEmbeddedSignupAttempts: new MetaEmbeddedSignupAttemptRepository(database),
    metaEmbeddedSignupFinalizer: new SqlMetaEmbeddedSignupCompletionFinalizer(database),
    voice: new AsyncWhatsAppVoicePersistence(database),
  });
}
