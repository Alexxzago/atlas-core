import type { SqlDatabase } from "../../config/sqlDatabase.js";
import { AsyncConversationMessageMediaAssociationOwnerResolver, AsyncMediaRepository, AsyncSafeConversationAttachmentRepository } from "./asyncMediaPersistence.js";

/** Isolated composition seam for async media persistence migration. */
export function createAsyncMediaPersistence(database:SqlDatabase):Readonly<{media:AsyncMediaRepository;owners:AsyncConversationMessageMediaAssociationOwnerResolver;attachments:AsyncSafeConversationAttachmentRepository}>{return Object.freeze({media:new AsyncMediaRepository(database),owners:new AsyncConversationMessageMediaAssociationOwnerResolver(database),attachments:new AsyncSafeConversationAttachmentRepository(database)});}
