import type { SqlDatabase } from "../../config/sqlDatabase.js";
import { AsyncActivationVerificationSettlementPersistence } from "./asyncActivationVerificationPersistence.js";

export function createAsyncActivationVerificationPersistence(database:SqlDatabase):Readonly<{verificationSettlements:AsyncActivationVerificationSettlementPersistence}>{return Object.freeze({verificationSettlements:new AsyncActivationVerificationSettlementPersistence(database)});}
