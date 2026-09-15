import { afterEach, expect, test, vi } from "vitest";
import { ApiError, atlasApi } from "./atlasApi";

const response={overall:"not_ready",classification:"setup_incomplete",checks:[{id:"default_assistant",required:true,status:"incomplete",owner:"customer",reasonCode:"default_assistant_not_executable",actionPath:"/companies/1/assistant"}],nextAction:"configure_assistant",evaluatedAt:"2026-01-01T00:00:00.000Z",policyVersion:"pilot-readiness-v1"};

afterEach(()=>vi.unstubAllGlobals());

test("decodes a pilot readiness response from its authoritative endpoint",async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(response),{headers:{"content-type":"application/json"}}));
  vi.stubGlobal("fetch",fetch);
  await expect(atlasApi.getPilotReadiness("workspace",1)).resolves.toEqual(response);
  expect(fetch).toHaveBeenCalledWith("/api/workspaces/workspace/companies/1/pilot-readiness",expect.any(Object));
});

test("rejects malformed pilot readiness responses safely",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({...response,checks:[{...response.checks[0],actionPath:42}]}),{headers:{"content-type":"application/json"}})));
  await expect(atlasApi.getPilotReadiness("workspace",1)).rejects.toBeInstanceOf(ApiError);
});
