// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { ConversationInbox } from "./ConversationInbox";

const item={conversationId:"conversation-secret",channel:"web_chat" as const,state:"open" as const,controlState:"automated" as const,attentionReason:null,takenAt:null,releasedAt:null,lastOperatorActivityAt:null,resolvedAt:null,controlVersion:1,updatedAt:"2026-01-01T00:00:00Z",participant:null,preview:null,deliveryCategory:null,lastActivityAt:"2026-01-01T00:00:00Z",delivery:null};
const json=(value:unknown):Response=>new Response(JSON.stringify(value),{status:200,headers:{"content-type":"application/json"}});
const view=(companyId=1):React.JSX.Element=><I18nProvider><ConversationInbox csrf="csrf" workspaceId="workspace" companyId={companyId} capabilities={["company:read","conversation:manage"]}/></I18nProvider>;
afterEach(()=>{cleanup();vi.unstubAllGlobals()});

test("Strict Mode executes one active list request and never remains loading after success",async()=>{const fetch=vi.fn(()=>Promise.resolve(json([item])));vi.stubGlobal("fetch",fetch);render(<StrictMode>{view()}</StrictMode>);expect(await screen.findByText("Unnamed conversation")).toBeTruthy();expect(screen.queryByText("Loading conversations…")).toBeNull();expect(fetch).toHaveBeenCalledTimes(1)});
test("resolved empty and failed requests reach distinct bounded states and Retry starts a request",async()=>{const fetch=vi.fn().mockResolvedValueOnce(new Response("",{status:503})).mockResolvedValueOnce(json([]));vi.stubGlobal("fetch",fetch);render(view());expect(await screen.findByText("We could not load conversations. Try again.")).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"Try again"}));expect(await screen.findByText("No conversations yet")).toBeTruthy();expect(fetch).toHaveBeenCalledTimes(2)});
test("a company change aborts obsolete work and renders the current company result",async()=>{let resolveOld!:(response:Response)=>void;const old=new Promise<Response>(resolve=>{resolveOld=resolve});const fetch=vi.fn((input:string|URL|Request)=>String(input).includes("companies/1/")?old:Promise.resolve(json([{...item,conversationId:"new",participant:"Current fixture",preview:"Hello"}])));vi.stubGlobal("fetch",fetch);const rendered=render(view(1));rendered.rerender(view(2));expect(await screen.findByText("Current fixture")).toBeTruthy();resolveOld(json([{...item,participant:"Obsolete fixture"}]));await waitFor(()=>expect(screen.queryByText("Obsolete fixture")).toBeNull());expect(screen.queryByText("Loading conversations…")).toBeNull()});
