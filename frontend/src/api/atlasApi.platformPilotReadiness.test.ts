import { afterEach, expect, test, vi } from "vitest";
import { atlasApi } from "./atlasApi";

afterEach(()=>vi.unstubAllGlobals());
test("decodes the safe platform pilot readiness projection",async()=>{const body={data:{aggregate:{totalCompanies:1,pilotReady:0,notReady:1,unavailable:0},companies:[{companyId:1,companyName:"Demo",state:"available",overall:"not_ready",classification:"setup_incomplete",evaluatedAt:"2026-01-01T00:00:00.000Z",issues:[{id:"published_knowledge",required:true,status:"incomplete",owner:"customer",reasonCode:"published_knowledge_missing"}]}]}};const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(body),{headers:{"content-type":"application/json"}}));vi.stubGlobal("fetch",fetch);await expect(atlasApi.platformWorkspacePilotReadiness("wsp_demo")).resolves.toEqual(body.data);expect(fetch).toHaveBeenCalledWith("/api/admin/workspaces/wsp_demo/pilot-readiness",expect.any(Object));});
