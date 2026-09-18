import type { SqlDatabase } from "../../config/sqlDatabase.js";
import { AsyncCompanyKnowledgeRepository } from "./asyncKnowledgePersistence.js";

export function createAsyncKnowledgePersistence(database: SqlDatabase): Readonly<{ knowledge:AsyncCompanyKnowledgeRepository }> { return Object.freeze({ knowledge:new AsyncCompanyKnowledgeRepository(database) }); }
