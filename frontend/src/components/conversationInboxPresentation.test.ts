import test from "node:test";
import assert from "node:assert/strict";
import { buildConversationInboxViewModel, mapConversationState } from "./conversationInboxPresentation.ts";
import type { ConversationInboxItem } from "../types/api.ts";
function item(overrides:Partial<ConversationInboxItem>={}):ConversationInboxItem{return {conversationId:"internal-id",channel:"web_chat",state:"open",controlState:"automated",attentionReason:null,takenAt:null,releasedAt:null,lastOperatorActivityAt:null,resolvedAt:null,controlVersion:1,updatedAt:"2026-01-01T00:00:00Z",participant:null,preview:"Hello",deliveryCategory:"received",lastActivityAt:"2026-01-01T00:00:00Z",delivery:null,...overrides}}
test("builds safe list identity without promoting internal IDs",()=>{const [view]=buildConversationInboxViewModel([item()]);assert.equal(view?.identity,null);assert.equal(view?.id,"internal-id")});
test("maps authoritative inbox control and empty states",()=>{assert.equal(mapConversationState(item({preview:null})),"empty");assert.equal(mapConversationState(item({controlState:"human_required"})),"attention");assert.equal(mapConversationState(item({controlState:"human_controlled"})),"human");assert.equal(mapConversationState(item()),"automated")});
test("orders conversations by real last activity",()=>{const views=buildConversationInboxViewModel([item({conversationId:"old"}),item({conversationId:"new",lastActivityAt:"2026-02-01T00:00:00Z"})]);assert.deepEqual(views.map(view=>view.id),["new","old"])});
