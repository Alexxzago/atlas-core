import type { DatabaseSync } from "node:sqlite";
import type { CredentialEnrollmentRepositoryPort, LoginThrottleRepositoryPort, PasswordCredentialRepositoryPort, SessionRepositoryPort } from "../identity/application/ports.js";
import type { PasswordCredential, Session } from "../identity/domain/authentication.js";
import type { CredentialEnrollment } from "../identity/domain/credentialEnrollment.js";

export class PasswordCredentialRepository implements PasswordCredentialRepositoryPort {
  public constructor(private readonly db: DatabaseSync) {}
  public findCurrent(authenticationIdentityId: string): PasswordCredential | null {
    const row=this.db.prepare("SELECT * FROM password_credentials WHERE authentication_identity_id = ? AND state = 'active'").get(authenticationIdentityId) as Record<string,unknown>|undefined;
    return row?{id:String(row.id),authenticationIdentityId:String(row.authentication_identity_id) as PasswordCredential["authenticationIdentityId"],state:row.state as PasswordCredential["state"],algorithm:"scrypt",algorithmVersion:"scrypt-v1",parameters:String(row.parameters),salt:String(row.salt),confirmation:String(row.confirmation),credentialVersion:Number(row.credential_version),createdAt:String(row.created_at),replacedAt:row.replaced_at as string|null,upgradedAt:row.upgraded_at as string|null}:null;
  }
  public create(value: PasswordCredential): PasswordCredential { this.insert(value); return value; }
  public replace(value: PasswordCredential, expectedVersion: number): boolean {
    const current = this.db.prepare("UPDATE password_credentials SET state='replaced', replaced_at=? WHERE authentication_identity_id=? AND state='active' AND credential_version=?").run(value.createdAt, value.authenticationIdentityId, expectedVersion);
    if (current.changes !== 1) return false;
    this.insert(value); return true;
  }
  private insert(v: PasswordCredential): void { this.db.prepare(`INSERT INTO password_credentials (id,authentication_identity_id,state,algorithm,algorithm_version,parameters,salt,confirmation,credential_version,created_at,replaced_at,upgraded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(v.id,v.authenticationIdentityId,v.state,v.algorithm,v.algorithmVersion,v.parameters,v.salt,v.confirmation,v.credentialVersion,v.createdAt,v.replacedAt,v.upgradedAt); }
}

export class CredentialEnrollmentRepository implements CredentialEnrollmentRepositoryPort {
  public constructor(private readonly db: DatabaseSync) {}
  public findCurrent(id: string): CredentialEnrollment | null { return this.map(this.db.prepare("SELECT * FROM credential_enrollments WHERE authentication_identity_id=? AND status='pending'").get(id)); }
  public findByDigest(digest: string): CredentialEnrollment | null { return this.map(this.db.prepare("SELECT * FROM credential_enrollments WHERE purpose='credential_enrollment' AND digest_version='sha256-v1' AND proof_digest=?").get(digest)); }
  public create(v: CredentialEnrollment): CredentialEnrollment { this.db.prepare(`INSERT INTO credential_enrollments (id,user_id,authentication_identity_id,purpose,digest_version,proof_digest,status,delivery_status,issued_at,expires_at,consumed_at,superseded_at,invalidated_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(v.id,v.userId,v.authenticationIdentityId,v.purpose,v.digestVersion,v.proofDigest,v.status,v.deliveryStatus,v.issuedAt,v.expiresAt,v.consumedAt,v.supersededAt,v.invalidatedAt,v.updatedAt); return v; }
  public update(v: CredentialEnrollment, expected: CredentialEnrollment["status"]): boolean { return this.db.prepare("UPDATE credential_enrollments SET status=?,delivery_status=?,consumed_at=?,superseded_at=?,invalidated_at=?,updated_at=? WHERE id=? AND status=?").run(v.status,v.deliveryStatus,v.consumedAt,v.supersededAt,v.invalidatedAt,v.updatedAt,v.id,expected).changes===1; }
  public setDeliveryStatus(id: string,status: CredentialEnrollment["deliveryStatus"],at:string):boolean{return this.db.prepare("UPDATE credential_enrollments SET delivery_status=?,updated_at=? WHERE id=? AND status='pending'").run(status,at,id).changes===1;}
  private map(row: unknown): CredentialEnrollment | null { if(!row)return null; const r=row as Record<string,unknown>; return {id:String(r.id),userId:String(r.user_id) as CredentialEnrollment["userId"],authenticationIdentityId:String(r.authentication_identity_id) as CredentialEnrollment["authenticationIdentityId"],purpose:"credential_enrollment",digestVersion:"sha256-v1",proofDigest:String(r.proof_digest),status:r.status as CredentialEnrollment["status"],deliveryStatus:r.delivery_status as CredentialEnrollment["deliveryStatus"],issuedAt:String(r.issued_at),expiresAt:String(r.expires_at),consumedAt:r.consumed_at as string|null,supersededAt:r.superseded_at as string|null,invalidatedAt:r.invalidated_at as string|null,updatedAt:String(r.updated_at)}; }
}

export class SessionRepository implements SessionRepositoryPort {
  public constructor(private readonly db: DatabaseSync) {}
  public findByDigest(d:string):Session|null{return this.map(this.db.prepare("SELECT * FROM sessions WHERE digest_version='sha256-v1' AND identifier_digest=?").get(d));}
  public create(v:Session):Session{this.insert(v);return v;}
  public replace(id:string,state:Session["state"],next:Session):boolean{const changed=this.db.prepare("UPDATE sessions SET state='replaced',replaced_at=? WHERE id=? AND state=?").run(next.issuedAt,id,state).changes;if(changed!==1)return false;this.insert(next);return true;}
  public revoke(id:string,at:string,reason:string):boolean{return this.db.prepare("UPDATE sessions SET state='revoked',revoked_at=?,revocation_reason=? WHERE id=? AND state='active'").run(at,reason,id).changes===1;}
  public revokeAll(userId:string,at:string,reason:string):number{return Number(this.db.prepare("UPDATE sessions SET state='revoked',revoked_at=?,revocation_reason=? WHERE user_id=? AND state='active'").run(at,reason,userId).changes);}
  public touch(id:string,at:string,idle:string):boolean{return this.db.prepare("UPDATE sessions SET last_seen_at=?,idle_expires_at=? WHERE id=? AND state='active'").run(at,idle,id).changes===1;}
  private insert(v:Session):void{this.db.prepare(`INSERT INTO sessions (id,user_id,authentication_identity_id,strategy,authentication_version,credential_version,digest_version,identifier_digest,csrf_digest,state,issued_at,last_seen_at,idle_expires_at,absolute_expires_at,predecessor_id,replaced_at,revoked_at,revocation_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(v.id,v.userId,v.authenticationIdentityId,v.strategy,v.authenticationVersion,v.credentialVersion,v.digestVersion,v.identifierDigest,v.csrfDigest,v.state,v.issuedAt,v.lastSeenAt,v.idleExpiresAt,v.absoluteExpiresAt,v.predecessorId,v.replacedAt,v.revokedAt,v.revocationReason);}
  private map(row:unknown):Session|null{if(!row)return null;const r=row as Record<string,unknown>;return {id:String(r.id),userId:String(r.user_id) as Session["userId"],authenticationIdentityId:String(r.authentication_identity_id) as Session["authenticationIdentityId"],strategy:"password",authenticationVersion:Number(r.authentication_version),credentialVersion:Number(r.credential_version),digestVersion:"sha256-v1",identifierDigest:String(r.identifier_digest),csrfDigest:String(r.csrf_digest),state:r.state as Session["state"],issuedAt:String(r.issued_at),lastSeenAt:String(r.last_seen_at),idleExpiresAt:String(r.idle_expires_at),absoluteExpiresAt:String(r.absolute_expires_at),predecessorId:r.predecessor_id as string|null,replacedAt:r.replaced_at as string|null,revokedAt:r.revoked_at as string|null,revocationReason:r.revocation_reason as string|null};}
}

export class LoginThrottleRepository implements LoginThrottleRepositoryPort {
  public constructor(private readonly db:DatabaseSync){}
  public recordFailure(i:string,o:string,at:string,e:string):number{this.db.prepare(`INSERT INTO login_throttles(identity_key,origin_key,failure_count,first_failure_at,last_failure_at,expires_at) VALUES(?,?,1,?,?,?) ON CONFLICT(identity_key,origin_key) DO UPDATE SET failure_count=failure_count+1,last_failure_at=excluded.last_failure_at,expires_at=excluded.expires_at`).run(i,o,at,at,e);return Number((this.db.prepare("SELECT failure_count AS count FROM login_throttles WHERE identity_key=? AND origin_key=?").get(i,o) as {count:number}).count);}
  public isBlocked(i:string,o:string,n:string,m:number):boolean{const r=this.db.prepare("SELECT failure_count AS count FROM login_throttles WHERE identity_key=? AND origin_key=? AND expires_at>?").get(i,o,n) as {count:number}|undefined;return (r?.count??0)>=m;}
  public clear(i:string,o:string):void{this.db.prepare("DELETE FROM login_throttles WHERE identity_key=? AND origin_key=?").run(i,o);}
  public cleanup(n:string):number{return Number(this.db.prepare("DELETE FROM login_throttles WHERE expires_at<=?").run(n).changes);}
}
