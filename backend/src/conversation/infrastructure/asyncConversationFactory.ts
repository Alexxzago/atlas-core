import type { SqlDatabase } from "../../config/sqlDatabase.js";
import { AssistantToolExecutionTraceRepository } from "../../repositories/assistantToolExecutionTraceRepository.js";
import { ConversationToolMemoryRepository } from "../../repositories/conversationToolMemoryRepository.js";
import { AsyncConversationIntelligencePersistence } from "../../conversationIntelligence/infrastructure/asyncConversationIntelligencePersistence.js";
import { AsyncConversationCorePersistence } from "./asyncConversationPersistence.js";

export function createAsyncConversationRuntimePersistence(database:SqlDatabase):Readonly<{conversations:AsyncConversationCorePersistence;intelligence:AsyncConversationIntelligencePersistence;toolTraces:AssistantToolExecutionTraceRepository;toolMemory:ConversationToolMemoryRepository}>{return Object.freeze({conversations:new AsyncConversationCorePersistence(database),intelligence:new AsyncConversationIntelligencePersistence(database),toolTraces:new AssistantToolExecutionTraceRepository(database),toolMemory:new ConversationToolMemoryRepository(database)});}
