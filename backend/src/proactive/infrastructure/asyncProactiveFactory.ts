import type { SqlDatabase } from "../../config/sqlDatabase.js";
import { AsyncProactiveActionPersistence } from "./asyncProactiveActionPersistence.js";

export function createAsyncProactivePersistence(database: SqlDatabase): Readonly<{ actions: AsyncProactiveActionPersistence }> { return Object.freeze({ actions: new AsyncProactiveActionPersistence(database) }); }
