import type { SqlDatabase } from "../../config/sqlDatabase.js";
import { AsyncCompanyKnowledgeRepository, AsyncKnowledgeRetrievalRepository } from "./asyncKnowledgePersistence.js";

export function createAsyncKnowledgePersistence(database: SqlDatabase): Readonly<{ knowledge:AsyncCompanyKnowledgeRepository; retrieval:AsyncKnowledgeRetrievalRepository }> { return Object.freeze({ knowledge:new AsyncCompanyKnowledgeRepository(database), retrieval:new AsyncKnowledgeRetrievalRepository(database) }); }
