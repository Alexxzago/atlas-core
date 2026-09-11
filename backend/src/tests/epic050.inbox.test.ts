import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../config/database.js";
import { conversationId, conversationMessageId, conversationParticipantId, reconstructConversation, reconstructConversationMessage, reconstructConversationParticipant } from "../conversation/domain/conversation.js";
import { ConversationService } from "../conversation/services/conversationService.js";
import { CompanyRepository } from "../repositories/companyRepository.js";
import { ConversationRepository } from "../repositories/conversationRepository.js";
import { WorkspaceRepository } from "../repositories/workspaceRepository.js";
import { createWorkspaceContext } from "../types/workspaceContext.js";

const at="2026-09-11T12:00:00.000Z";

test("EPIC050 pages filtered inboxes and keeps actor read positions isolated",()=>{
  const database=createDatabase(":memory:"),workspaces=new WorkspaceRepository(database),context=createWorkspaceContext(workspaces.resolveDefault()),company=new CompanyRepository(database).create(context,{name:"Inbox",website:"https://inbox.test"}),repository=new ConversationRepository(database),service=new ConversationService(repository,{now:()=>at});
  try {
    for(const [suffix,channel,createdAt] of [["a","whatsapp","2026-09-11T11:00:00.000Z"],["b","web_chat","2026-09-11T10:00:00.000Z"]] as const){const id=conversationId(`cnv_${suffix.repeat(32)}`),participant=conversationParticipantId(`cpt_${suffix.repeat(32)}`),message=conversationMessageId(`cmsg_${suffix.repeat(32)}`);repository.createConversation(context,reconstructConversation({id,companyId:company.id,channel,state:"open",createdAt,updatedAt:createdAt,closedAt:null}));repository.createParticipant(context,company.id,reconstructConversationParticipant({id:participant,conversationId:id,type:"customer",reference:null,createdAt}));repository.createMessage(context,company.id,reconstructConversationMessage({id:message,conversationId:id,senderParticipantId:participant,direction:"inbound",content:suffix,idempotencyKey:null,executionRecordId:null,createdAt}));}
    const first=service.listInbox(context,company.id,"actor-a" as never,{limit:"1"});assert.equal(first.items.length,1);assert.equal(first.items[0]!.channel,"whatsapp");assert.ok(first.nextCursor);
    const next=service.listInbox(context,company.id,"actor-a" as never,{limit:"1",cursor:first.nextCursor!});assert.equal(next.items[0]!.channel,"web_chat");
    assert.equal(service.listInbox(context,company.id,"actor-a" as never,{unreadOnly:"true"}).items.length,2);service.markRead(context,company.id,first.items[0]!.conversationId,"actor-a" as never);assert.equal(service.listInbox(context,company.id,"actor-a" as never,{unreadOnly:"true"}).items.length,1);assert.equal(service.listInbox(context,company.id,"actor-b" as never,{unreadOnly:"true"}).items.length,2);
  } finally { database.close(); }
});
