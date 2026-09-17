import { afterEach, expect, test, vi } from "vitest";
import { ApiError, atlasApi } from "./atlasApi";

const ids=["company","knowledge","assistant","web_chat","verification","pilot_ready","human_ops"] as const;
const actions=["complete_company","publish_knowledge","configure_assistant","activate_web_chat","start_verification","resolve_pilot_readiness","review_human_operations"] as const;
const paths=["/companies/1","/companies/1/knowledge","/companies/1/assistant","/companies/1/channels/web-chat",null,null,"/conversations"] as const;
const activation={stages:ids.map((id,index)=>({id,status:index===0?"incomplete":"complete",state:index===0?"incomplete":"complete",owner:index===0?"customer":null,reasonCode:index===0?"company_missing":null,action:actions[index],actionPath:paths[index]})),nextAction:"complete_company",evaluatedAt:"2026-01-01T00:00:00.000Z",policyVersion:"activation-projection-v1"};

afterEach(()=>vi.unstubAllGlobals());

test("decodes the authoritative activation projection and verification attempt",async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(activation))).mockResolvedValueOnce(new Response(JSON.stringify({token:"a".repeat(43),expiresAt:"2026-01-01T00:15:00.000Z"})));
  vi.stubGlobal("fetch",fetch);
  await expect(atlasApi.getActivation("workspace",1)).resolves.toEqual(activation);
  await expect(atlasApi.startActivationVerification("csrf","workspace",1)).resolves.toEqual({token:"a".repeat(43),expiresAt:"2026-01-01T00:15:00.000Z"});
  expect(fetch.mock.calls[1]?.[0]).toBe("/api/workspaces/workspace/companies/1/activation/verification-attempts");
});

test("rejects malformed activation projections",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({...activation,stages:activation.stages.slice(1)}))));
  await expect(atlasApi.getActivation("workspace",1)).rejects.toBeInstanceOf(ApiError);
});

test("rejects activation stages whose status does not match their authoritative state",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({...activation,stages:activation.stages.map((stage,index)=>index===0?{...stage,status:"complete"}:stage)}))));
  await expect(atlasApi.getActivation("workspace",1)).rejects.toBeInstanceOf(ApiError);
});
