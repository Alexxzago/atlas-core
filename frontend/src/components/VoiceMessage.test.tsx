// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { VoiceMessageReadModel } from "../types/api";
import { VoiceMessage } from "./VoiceMessage";

const model=(overrides:Partial<VoiceMessageReadModel>={}):VoiceMessageReadModel=>({messageId:"message",direction:"inbound",modality:"audio",transcript:null,transcriptLanguageTag:null,transcriptionState:"pending",deferredState:null,fallbackAvailable:false,playbackAvailable:false,...overrides});
const response=(value:unknown,status=200):Response=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});
const view=(revision=0,messageId="message")=><VoiceMessage workspaceId="workspace" companyId={1} conversationId="conversation" messageId={messageId} revision={revision}/>;
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

test.each([
  [model(),"Processing audio"],
  [model({transcriptionState:"completed",transcript:"Canonical transcript",transcriptLanguageTag:"es"}),"Transcript ready"],
  [model({transcriptionState:"unsupported"}),"Audio unsupported"],
  [model({transcriptionState:"suppressed"}),"Voice processing suppressed"],
  [model({transcriptionState:"failed"}),"Voice delivery failed"],
  [model({direction:"outbound",modality:"voice",transcriptionState:null,deferredState:"processing"}),"Preparing voice reply"],
  [model({direction:"outbound",modality:"voice",transcriptionState:null,deferredState:"fallback",fallbackAvailable:true}),"Sent as text"],
  [model({direction:"outbound",modality:"voice",transcriptionState:null,deferredState:"accepted"}),"Sent"],
  [model({direction:"outbound",modality:"voice",transcriptionState:null,deferredState:"delivered"}),"Delivered"],
  [model({direction:"outbound",modality:"voice",transcriptionState:null,deferredState:"read"}),"Read"],
  [model({direction:"outbound",modality:"voice",transcriptionState:null,deferredState:"uncertain"}),"Delivery uncertain"],
  [model({direction:"outbound",modality:"voice",transcriptionState:null,deferredState:"failed"}),"Voice delivery failed"],
  [model({direction:"outbound",modality:"voice",transcriptionState:null,deferredState:"suppressed"}),"Voice processing suppressed"],
])("renders only the safe Voice state",async(value,label)=>{vi.stubGlobal("fetch",vi.fn(()=>Promise.resolve(response(value))));render(view());expect(await screen.findByText(label)).toBeTruthy();expect(screen.queryByText("[audio]")).toBeNull();expect(document.body.textContent).not.toContain("providerMediaId");expect(document.body.textContent).not.toContain("lease");});

test("renders canonical transcript and private playback only when available",async()=>{vi.stubGlobal("fetch",vi.fn(()=>Promise.resolve(response(model({transcriptionState:"completed",transcript:"Canonical transcript",transcriptLanguageTag:"es",playbackAvailable:true})))));render(view());expect(await screen.findByText("Canonical transcript")).toBeTruthy();const audio=screen.getByLabelText("Play audio message") as HTMLAudioElement;expect(audio.preload).toBe("none");expect(audio.src).toContain("/messages/message/voice/playback");});

test("keeps a scoped 404 non-disclosing",async()=>{vi.stubGlobal("fetch",vi.fn(()=>Promise.resolve(response({error:"Voice message was not found."},404))));render(view());expect(await screen.findByText("Voice unavailable")).toBeTruthy();expect(document.body.textContent).not.toContain("not found");});

test("aborts and ignores an obsolete Voice read",async()=>{let resolveOld!:(value:Response)=>void;const fetch=vi.fn((input:string|URL|Request)=>String(input).includes("messages/old/")?new Promise<Response>(resolve=>{resolveOld=resolve;}):Promise.resolve(response(model({messageId:"new",transcriptionState:"completed",transcript:"Current"}))));vi.stubGlobal("fetch",fetch);const rendered=render(view(0,"old"));rendered.rerender(view(0,"new"));expect(await screen.findByText("Current")).toBeTruthy();resolveOld(response(model({messageId:"old",transcriptionState:"completed",transcript:"Stale"})));await waitFor(()=>expect(screen.queryByText("Stale")).toBeNull());});
