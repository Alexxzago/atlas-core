import type { SqlDatabase } from "../../config/sqlDatabase.js";
import { AsyncPublicWebChatSessionPersistence, AsyncWebChatConnectionPersistence } from "./asyncWebChatPersistence.js";

export function createAsyncWebChatPublicPersistence(database:SqlDatabase):Readonly<{connections:AsyncWebChatConnectionPersistence;sessions:AsyncPublicWebChatSessionPersistence}>{return Object.freeze({connections:new AsyncWebChatConnectionPersistence(database),sessions:new AsyncPublicWebChatSessionPersistence(database)});}
