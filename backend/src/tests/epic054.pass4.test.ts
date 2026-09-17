import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../config/migrations.js";
import { projectActivation } from "../activation/domain/activation.js";
import { ActivationService } from "../activation/services/activationService.js";
import { responseBody } from "../controllers/activationController.js";
import type { ActivationVerificationAttempt, ActivationVerificationAttemptRepositoryPort } from "../activation/application/ports.js";

const context={workspaceId:1,workspaceKey:"test"};
class Attempts implements ActivationVerificationAttemptRepositoryPort {
  public values:ActivationVerificationAttempt[]=[];
  public create(_context:typeof context,value:ActivationVerificationAttempt){this.values.push(value);return value;}
  public findLatest(_context:typeof context,companyId:number,connectionId:string){return this.values.filter(value=>value.companyId===companyId&&value.webChatConnectionId===connectionId).at(-1)??null;}
  public hasSucceeded(_context:typeof context,companyId:number,connectionId:string){return this.values.some(value=>value.companyId===companyId&&value.webChatConnectionId===connectionId&&value.status==="succeeded");}
  public findClaimableByTokenDigest(digest:string){return this.values.find(value=>value.tokenDigest===digest&&value.status==="pending"&&value.claimedAt===null)??null;}
  public claim(id:string,webChatSessionId:string,conversationId:string,at:string){const index=this.values.findIndex(value=>value.id===id&&value.status==="pending"&&value.claimedAt===null);if(index<0)return null;const value={...this.values[index]!,claimedAt:at,webChatSessionId,conversationId};this.values[index]=value;return value;}
  public succeedForTurn(webChatSessionId:string,conversationId:string,inboundMessageId:string,executionRecordId:string,outcomeRef:"answered"|"safe_fallback",at:string){const index=this.values.findIndex(value=>value.status==="pending"&&value.webChatSessionId===webChatSessionId&&value.conversationId===conversationId);if(index<0)return null;const value={...this.values[index]!,status:"succeeded" as const,inboundMessageId,executionRecordId,outcomeRef,completedAt:at};this.values[index]=value;return value;}
  public failForSession(webChatSessionId:string,conversationId:string,at:string){const index=this.values.findIndex(value=>value.status==="pending"&&value.webChatSessionId===webChatSessionId&&value.conversationId===conversationId);if(index<0)return null;const value={...this.values[index]!,status:"failed" as const,completedAt:at,failureCode:"runtime_failure" as const};this.values[index]=value;return value;}
  public expire(id:string,at:string){const index=this.values.findIndex(value=>value.id===id&&value.status==="pending");if(index<0)return null;const value={...this.values[index]!,status:"expired" as const,completedAt:at};this.values[index]=value;return value;}
}

test("EPIC054 PASS4 projects the fixed activation order and exactly one deterministic action",()=>{
  const incomplete={state:"incomplete" as const,owner:"customer" as const,reasonCode:"default_assistant_not_executable" as const},complete={state:"complete" as const,owner:null,reasonCode:null};
  const projection=projectActivation({company:complete,knowledge:complete,assistant:incomplete,web_chat:incomplete,verification:incomplete,pilot_ready:incomplete,human_ops:complete},"2026-01-01T00:00:00.000Z");
  assert.deepEqual(projection.stages.map(stage=>stage.id),["company","knowledge","assistant","web_chat","verification","pilot_ready","human_ops"]);
  assert.equal(projection.nextAction,"configure_assistant");
  assert.deepEqual(projection.stages[2],{id:"assistant",status:"incomplete",state:"incomplete",owner:"customer",reasonCode:"default_assistant_not_executable",action:"configure_assistant"});
  assert.equal(projectActivation({company:complete,knowledge:complete,assistant:complete,web_chat:complete,verification:complete,pilot_ready:complete,human_ops:complete},"2026-01-01T00:00:00.000Z").nextAction,"review_human_operations");
  assert.deepEqual(responseBody(projection,7).stages[2],{id:"assistant",status:"incomplete",state:"incomplete",owner:"customer",reasonCode:"default_assistant_not_executable",action:"configure_assistant",actionPath:"/companies/7/assistant"});
});

test("EPIC054 PASS4 derives stage metadata and verification from durable facts",async()=>{
  const attempts=new Attempts(),clock={now:()=>"2026-01-01T00:00:00.000Z"},connection={id:"wcc_1",publicId:"wc_public",status:"active" as const};
  const pilot={overall:"not_ready" as const,checks:[
    {id:"company",status:"complete" as const,owner:null,reasonCode:null},
    {id:"published_knowledge",status:"incomplete" as const,owner:"customer" as const,reasonCode:"published_knowledge_missing" as const},
    {id:"default_assistant",status:"blocked" as const,owner:"platform" as const,reasonCode:"default_assistant_not_executable" as const},
    {id:"web_chat",status:"complete" as const,owner:null,reasonCode:null},
  ]};
  const service=new ActivationService({findById:()=>({})} as never,{listByCompany:()=>[connection],findActiveById:()=>connection} as never,{get:async()=>pilot} as never,attempts,clock);
  const before=await service.projection(context,1);
  assert.deepEqual(before.stages.map(stage=>({id:stage.id,state:stage.state,reasonCode:stage.reasonCode})),[
    {id:"company",state:"complete",reasonCode:null},{id:"knowledge",state:"incomplete",reasonCode:"published_knowledge_missing"},{id:"assistant",state:"blocked",reasonCode:"default_assistant_not_executable"},{id:"web_chat",state:"complete",reasonCode:null},{id:"verification",state:"incomplete",reasonCode:"verification_required"},{id:"pilot_ready",state:"incomplete",reasonCode:"pilot_not_ready"},{id:"human_ops",state:"complete",reasonCode:null},
  ]);
  assert.equal(before.nextAction,"publish_knowledge");
  const started=service.startVerification(context,1);
  assert.equal(service.claimPublicVerification(connection.publicId,started.token,{sessionId:"wcs_00000000000000000000000000000000",conversationId:"cnv_00000000000000000000000000000000"}),true);
  service.succeedForTurn({sessionId:"wcs_00000000000000000000000000000000",conversationId:"cnv_00000000000000000000000000000000"},"cmsg_00000000000000000000000000000000","aer_1","answered");
  const retry=service.startVerification(context,1);
  assert.equal(service.claimPublicVerification(connection.publicId,retry.token,{sessionId:"wcs_11111111111111111111111111111111",conversationId:"cnv_11111111111111111111111111111111"}),true);
  service.failForSession({sessionId:"wcs_11111111111111111111111111111111",conversationId:"cnv_11111111111111111111111111111111"});
  assert.equal((await service.projection(context,1)).stages.find(stage=>stage.id==="verification")?.state,"complete");
});

test("EPIC054 PASS4 binds an opaque verification token to one session and stays pending until a persisted turn succeeds",()=>{
  const attempts=new Attempts(),clock={now:()=>"2026-01-01T00:00:00.000Z"},connection={id:"wcc_1",publicId:"wc_public",status:"active" as const};
  const service=new ActivationService({findById:()=>({name:"Company"})} as never,{listByCompany:()=>[connection],findActiveById:(id:string)=>id===connection.id?connection:null} as never,{} as never,attempts,clock);
  const started=service.startVerification(context,1);
  assert.match(started.token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(attempts.values[0]?.tokenDigest===started.token,false);
  assert.equal(service.canClaimPublicVerification(connection.publicId,started.token),true);
  assert.equal(service.claimPublicVerification(connection.publicId,started.token,{sessionId:"wcs_00000000000000000000000000000000",conversationId:"cnv_00000000000000000000000000000000"}),true);
  assert.equal(attempts.values[0]?.status,"pending");
  assert.equal(attempts.values[0]?.webChatSessionId,"wcs_00000000000000000000000000000000");
  assert.equal(service.claimPublicVerification(connection.publicId,started.token,{sessionId:"wcs_11111111111111111111111111111111",conversationId:"cnv_11111111111111111111111111111111"}),false);
  service.succeedForTurn({sessionId:"wcs_00000000000000000000000000000000",conversationId:"cnv_00000000000000000000000000000000"},"cmsg_00000000000000000000000000000000","aer_1","answered");
  assert.deepEqual(attempts.values[0]&&{status:attempts.values[0].status,inbound:attempts.values[0].inboundMessageId,execution:attempts.values[0].executionRecordId,outcome:attempts.values[0].outcomeRef},{status:"succeeded",inbound:"cmsg_00000000000000000000000000000000",execution:"aer_1",outcome:"answered"});
});

test("EPIC054 PASS4 lets an ordinary public Web Chat neither claim nor settle a verification",()=>{
  const attempts=new Attempts(),clock={now:()=>"2026-01-01T00:00:00.000Z"},connection={id:"wcc_1",publicId:"wc_public",status:"active" as const};
  const service=new ActivationService({findById:()=>({name:"Company"})} as never,{listByCompany:()=>[connection],findActiveById:()=>connection} as never,{} as never,attempts,clock);
  const started=service.startVerification(context,1);
  assert.equal(service.claimPublicVerification("wc_other",started.token,{sessionId:"wcs_00000000000000000000000000000000",conversationId:"cnv_00000000000000000000000000000000"}),false);
  assert.equal(attempts.values[0]?.status,"pending");
  service.succeedForTurn({sessionId:"wcs_other",conversationId:"cnv_other"},"cmsg_other","aer_other","answered");
  assert.equal(attempts.values[0]?.status,"pending");
  assert.equal(service.claimPublicVerification(connection.publicId,started.token,{sessionId:"wcs_00000000000000000000000000000000",conversationId:"cnv_00000000000000000000000000000000"}),true);
  service.failForSession({sessionId:"wcs_00000000000000000000000000000000",conversationId:"cnv_00000000000000000000000000000000"});
  assert.equal(attempts.values[0]?.failureCode,"runtime_failure");
});

test("EPIC054 PASS4 persists the verification attempt token digest lifecycle",()=>{
  const database=new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON;");
    runMigrations(database);
    const columns=database.prepare("PRAGMA table_info(activation_verification_attempts)").all() as Array<{name:string}>;
    assert.deepEqual(columns.map(column=>column.name),["id","workspace_id","company_id","web_chat_connection_id","token_digest","status","created_at","expires_at","claimed_at","web_chat_session_id","conversation_id","inbound_message_id","execution_record_id","outcome_ref","completed_at","failure_code"]);
    assert.equal(database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='activation_verification_attempts'").get()!==undefined,true);
  } finally { database.close(); }
});
