import type { SqlDatabase } from "../../config/sqlDatabase.js";
import { AsyncPublicWebChatSessionPersistence, AsyncPublicWebChatTurnPersistence, AsyncWebChatConnectionPersistence } from "./asyncWebChatPersistence.js";

export function createAsyncWebChatPersistence(database:SqlDatabase):Readonly<{connections:AsyncWebChatConnectionPersistence;sessions:AsyncPublicWebChatSessionPersistence;turns:AsyncPublicWebChatTurnPersistence}>{return Object.freeze({connections:new AsyncWebChatConnectionPersistence(database),sessions:new AsyncPublicWebChatSessionPersistence(database),turns:new AsyncPublicWebChatTurnPersistence(database)});}
