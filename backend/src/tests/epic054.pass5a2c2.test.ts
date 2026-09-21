import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createAsyncActivationVerificationPersistence } from "../activation/infrastructure/asyncActivationFactory.js";
import { createCompany } from "../company/domain/company.js";
import { createAsyncWorkspaceCompanyPersistence } from "../company/infrastructure/asyncCompanyFactory.js";
import { runFreshAsyncMigrations } from "../config/asyncMigrations.js";
import { LocalSqlDatabase, type SqlDatabase } from "../config/sqlDatabase.js";
import { createAsyncConversationRuntimePersistence } from "../conversation/infrastructure/asyncConversationFactory.js";
import { createAsyncWebChatPersistence } from "../webChat/infrastructure/asyncWebChatFactory.js";

const at="2026-09-17T14:00:00.000Z",context={workspaceId:1,workspaceKey:"default"},companyId=5423,profileId="asp_00000000000000000000000000005423",conversationId="cnv_00000000000000000000000000005423",visitorId="cpt_00000000000000000000000000005423",responderId="cpt_00000000000000000000000000005424",messageId=`cmsg_${"0".repeat(28)}5423`,connectionId="wcc_00000000000000000000000000005423",publicId="wcp_00000000000000000000000000005423",sessionId="wcs_00000000000000000000000000005423";

test("EPIC054 PASS5A2C2 runs conversation, intelligence, public web-chat, and activation persistence through the event loop",async()=>{
  const underlying=new LocalSqlDatabase(new DatabaseSync(":memory:")),events:string[]=[];
  const database:SqlDatabase={execute:(sql,args)=>underlying.execute(sql,args),executeScript:script=>underlying.executeScript(script),query:async(sql,args)=>{await new Promise<void>(resolve=>setImmediate(resolve));events.push("query");return underlying.query(sql,args);},transaction:operation=>underlying.transaction(()=>operation(database)),close:()=>underlying.close()};
  try {
    await runFreshAsyncMigrations(database);
    const company=createCompany({id:companyId,workspaceId:1,identity:{name:"Pass5A2C2",slug:"pass5a2c2",website:"https://pass5a2c2.test"},createdAt:at});
    await createAsyncWorkspaceCompanyPersistence(database).companies.createWithEvents(context,company,[{id:"evt-pass5a2c2",type:"CompanyCreated",aggregateVersion:1,sequence:1,occurredAt:at,actorId:null,payload:{companyId}}]);
    await database.execute("INSERT INTO assistant_profiles(id,company_id,name,normalized_name,description,business_role,objective,audience,tone,assistant_language,welcome_message,fallback_message,status,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[profileId,companyId,"Atlas","atlas",null,null,null,null,"friendly","en",null,"Human help.","ready",at,at,null]);
    const runtime=createAsyncConversationRuntimePersistence(database),webChat=createAsyncWebChatPersistence(database),activation=createAsyncActivationVerificationPersistence(database).verificationSettlements;
    events.length=0;const turn=new Promise<void>(resolve=>setImmediate(()=>{events.push("event-loop");resolve();}));
    const conversation=await runtime.conversations.createConversation(context,{id:conversationId as never,companyId,channel:"web_chat",state:"open",createdAt:at,updatedAt:at,closedAt:null});
    await turn;assert.equal(events[0],"event-loop");assert.ok(conversation);
    await runtime.conversations.createParticipant(context,companyId,{id:visitorId as never,conversationId:conversationId as never,type:"anonymous_visitor",reference:null,createdAt:at});
    await runtime.conversations.createParticipant(context,companyId,{id:responderId as never,conversationId:conversationId as never,type:"assistant",reference:profileId,createdAt:at});
    await runtime.conversations.createMessage(context,companyId,{id:messageId as never,conversationId:conversationId as never,senderParticipantId:visitorId as never,direction:"inbound",content:"Hello",idempotencyKey:"pass5a2c2",executionRecordId:null,createdAt:at});
    const state={conversationId:conversationId as never,version:0,activeIntent:null,facts:[],pending:[],referenceGroups:[],toolMemory:[],createdAt:at,updatedAt:at};
    assert.equal((await runtime.intelligence.compareAndSet(context,companyId,conversationId as never,null,{state,appliedMessageId:messageId as never,sourceKind:"user",at}))?.version,1);
    assert.equal((await runtime.intelligence.find(context,companyId,conversationId as never))?.version,1);
    const connection=await webChat.connections.create(context,{id:connectionId as never,publicId:publicId as never,workspaceId:1,companyId,assistantProfileId:profileId as never,status:"active",createdAt:at,updatedAt:at});assert.equal(connection?.id,connectionId);
    const digest="a".repeat(64);await webChat.sessions.create({id:sessionId as never,webChatConnectionId:connectionId as never,conversationId:conversationId as never,visitorParticipantId:visitorId as never,responderParticipantId:responderId as never,tokenDigest:digest,state:"active",createdAt:at,updatedAt:at,expiresAt:"2026-09-18T14:00:00.000Z",lastSeenAt:at});
    assert.equal((await webChat.sessions.findByTokenDigest(digest))?.id,sessionId);
    await activation.create(context,{id:`ava_${"a".repeat(32)}`,workspaceId:1,companyId,webChatConnectionId:connectionId,tokenDigest:"b".repeat(64),status:"pending",createdAt:at,expiresAt:"2026-09-17T15:00:00.000Z",claimedAt:null,webChatSessionId:null,conversationId:null,inboundMessageId:null,executionRecordId:null,outcomeRef:null,completedAt:null,failureCode:null});
    assert.equal((await activation.claim(`ava_${"a".repeat(32)}`,sessionId,conversationId,at))?.status,"pending");
    assert.equal((await activation.failForSession(sessionId,conversationId,at))?.status,"failed");
  } finally { await database.close(); }
});
