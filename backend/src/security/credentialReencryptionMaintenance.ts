import type { SynchronousDatabase } from "../config/synchronousDatabase.js";
import type { CiphertextState } from "./versionedAesGcmCipher.js";

export interface RotationCipher { decrypt(value: string): string; encrypt(value: string): string; state(value: string): CiphertextState; }
export interface CredentialReencryptionCounts { readonly scanned: number; readonly alreadyActive: number; readonly reencrypted: number; readonly failed: number; readonly legacyV1Remaining: number; readonly previousKeyRemaining: number; readonly activeV2: number; }
type Target = { readonly table: "whatsapp_connection_credentials" | "integration_connection_secrets"; readonly column: "encrypted_access_token" | "encrypted_secret"; readonly cipher: RotationCipher; };

/** Offline-only bounded maintenance. It never calls providers or exposes credential material. */
export class CredentialReencryptionMaintenance {
  public constructor(private readonly database: SynchronousDatabase, private readonly whatsApp: RotationCipher, private readonly integration: RotationCipher) {}
  public run(batchSize = 100): CredentialReencryptionCounts {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) throw new Error("Credential re-encryption batch size is invalid.");
    let scanned=0,alreadyActive=0,reencrypted=0,failed=0;
    for (const target of [{table:"whatsapp_connection_credentials",column:"encrypted_access_token",cipher:this.whatsApp},{table:"integration_connection_secrets",column:"encrypted_secret",cipher:this.integration}] as const satisfies readonly Target[]) {
      let cursor=0;
      for (;;) {
        const rows=this.database.prepare(`SELECT rowid,${target.column} AS ciphertext FROM ${target.table} WHERE rowid>? ORDER BY rowid LIMIT ?`).all(cursor,batchSize) as Array<{rowid:number;ciphertext:string}>;
        if(!rows.length)break;
        for(const row of rows){cursor=row.rowid;scanned+=1;try{const state=target.cipher.state(row.ciphertext),plaintext=target.cipher.decrypt(row.ciphertext);if(state==="active"){alreadyActive+=1;continue;}const replacement=target.cipher.encrypt(plaintext);const result=this.database.prepare(`UPDATE ${target.table} SET ${target.column}=? WHERE rowid=? AND ${target.column}=?`).run(replacement,row.rowid,row.ciphertext);if(Number(result.changes)===1)reencrypted+=1;else failed+=1;}catch{failed+=1;}}
      }
    }
    const remaining=this.recount(batchSize);
    return Object.freeze({scanned,alreadyActive,reencrypted,failed,...remaining});
  }
  private recount(batchSize:number): Pick<CredentialReencryptionCounts,"legacyV1Remaining"|"previousKeyRemaining"|"activeV2"> {
    let legacyV1Remaining=0,previousKeyRemaining=0,activeV2=0;
    for(const target of [{table:"whatsapp_connection_credentials",column:"encrypted_access_token",cipher:this.whatsApp},{table:"integration_connection_secrets",column:"encrypted_secret",cipher:this.integration}] as const satisfies readonly Target[]) {
      let cursor=0;
      for(;;){const rows=this.database.prepare(`SELECT rowid,${target.column} AS ciphertext FROM ${target.table} WHERE rowid>? ORDER BY rowid LIMIT ?`).all(cursor,batchSize) as Array<{rowid:number;ciphertext:string}>;if(!rows.length)break;for(const row of rows){cursor=row.rowid;try{const state=target.cipher.state(row.ciphertext);if(state==="active")activeV2+=1;else if(state==="previous")previousKeyRemaining+=1;else legacyV1Remaining+=1;}catch{/* Invalid envelopes are reflected by the run failure metric, never exposed. */}}}
    }
    return Object.freeze({legacyV1Remaining,previousKeyRemaining,activeV2});
  }
}
