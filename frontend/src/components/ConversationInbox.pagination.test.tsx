// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { ConversationInbox } from "./ConversationInbox";

const first={conversationId:"first",channel:"whatsapp" as const,state:"open" as const,controlState:"automated" as const,controlledByCurrentActor:false,attentionReason:null,takenAt:null,releasedAt:null,lastOperatorActivityAt:null,resolvedAt:null,controlVersion:1,updatedAt:"2026-01-02T00:00:00Z",participant:"First customer",preview:"First",deliveryCategory:"received" as const,lastActivityAt:"2026-01-02T00:00:00Z",delivery:null,unreadCount:2};
const second={...first,conversationId:"second",participant:"Second customer",preview:"Second",lastActivityAt:"2026-01-01T00:00:00Z",unreadCount:0};
const json=(value:unknown,status=200):Response=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});

afterEach(()=>{cleanup();vi.unstubAllGlobals();});

test("appends cursor pages and marks the selected conversation read without a reload",async()=>{
  const calls:string[]=[];
  const fetch=vi.fn((input:string|URL|Request)=>{const url=String(input);calls.push(url);if(url.includes("/feed"))return Promise.resolve(json({events:[],nextCursor:"tail",hasMore:false,resyncRequired:false}));if(url.endsWith("/conversations"))return Promise.resolve(json({items:[first],nextCursor:"page-two"}));if(url.includes("cursor=page-two"))return Promise.resolve(json({items:[second],nextCursor:null}));if(url.endsWith("/read"))return Promise.resolve(new Response(null,{status:204}));if(url.endsWith("/first"))return Promise.resolve(json({...first,messages:[]}));return Promise.resolve(json({}));});
  vi.stubGlobal("fetch",fetch);
  render(<I18nProvider><ConversationInbox csrf="csrf" workspaceId="workspace" companyId={1} capabilities={["company:read"]}/></I18nProvider>);
  fireEvent.click(await screen.findByText("First customer"));
  await waitFor(()=>expect(calls.some((url)=>url.endsWith("/first/read"))).toBe(true));
  expect(screen.queryByText("2")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Load more"}));
  expect(await screen.findByText("Second customer")).toBeTruthy();
  expect(screen.getAllByText("First customer").length).toBeGreaterThan(0);
  expect(calls.some((url)=>url.includes("cursor=page-two"))).toBe(true);
  expect(screen.queryByRole("button",{name:"Load more"})).toBeNull();
});
