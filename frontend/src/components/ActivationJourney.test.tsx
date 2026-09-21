// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ActivationJourney } from "./ActivationJourney";
import type { ActivationAction, ActivationProjection } from "../types/api";

vi.mock("../api/atlasApi", () => ({ atlasApi: { startActivationVerification: vi.fn(), listWebChatConnections: vi.fn() }, ApiError: class ApiError extends Error {} }));
vi.mock("../api/publicWebChatApi", () => ({ publicWebChatApi: { startActivationVerification: vi.fn() } }));

const ids=["company","knowledge","assistant","web_chat","verification","pilot_ready","human_ops"] as const;
const actions=["complete_company","publish_knowledge","configure_assistant","activate_web_chat","start_verification","resolve_pilot_readiness","review_human_operations"] as const;
const paths=["/companies/1","/companies/1/knowledge","/companies/1/assistant","/companies/1/channels/web-chat",null,null,"/conversations"] as const;
function projection(nextAction:ActivationAction="configure_assistant"):ActivationProjection { const current=actions.indexOf(nextAction);return {stages:ids.map((id,index)=>({id,status:index<current||nextAction==="review_human_operations"?"complete":"incomplete",state:index<current||nextAction==="review_human_operations"?"complete":"incomplete",owner:index<current||nextAction==="review_human_operations"?null:"customer",reasonCode:index===current&&nextAction==="configure_assistant"?"default_assistant_not_executable":null,action:actions[index]!,actionPath:paths[index]!})),nextAction,evaluatedAt:"2026-01-01T00:00:00.000Z",policyVersion:"activation-projection-v1"}; }

afterEach(()=>{cleanup();vi.restoreAllMocks();});

test("uses the server-selected action path as its only CTA and renders safe stage context",()=>{
  const navigate=vi.fn();
  render(<ActivationJourney csrf="csrf" workspaceId="workspace" companyId={1} projection={projection()} onNavigate={navigate} onRefresh={()=>{}}/>);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.getByText("El asistente predeterminado todavía no está listo para atender.")).toBeTruthy();
  expect(screen.queryByText("default_assistant_not_executable")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Configurar asistente"}));
  expect(navigate).toHaveBeenCalledWith("/companies/1/assistant");
});

test("hands completed activation to human operations and refreshes only while active",()=>{
  const navigate=vi.fn(),refresh=vi.fn();
  const {unmount}=render(<ActivationJourney csrf="csrf" workspaceId="workspace" companyId={1} projection={projection("review_human_operations")} onNavigate={navigate} onRefresh={refresh}/>);
  fireEvent.click(screen.getByRole("button",{name:"Abrir conversaciones"}));
  expect(navigate).toHaveBeenCalledWith("/conversations");
  window.dispatchEvent(new Event("focus"));
  expect(refresh).toHaveBeenCalledTimes(1);
  unmount();
  window.dispatchEvent(new Event("focus"));
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("does not navigate to an action path outside the current company",()=>{
  const navigate=vi.fn(),value=projection();
  value.stages[2]={...value.stages[2]!,actionPath:"/companies/2/assistant"};
  render(<ActivationJourney csrf="csrf" workspaceId="workspace" companyId={1} projection={value} onNavigate={navigate} onRefresh={()=>{}}/>);
  fireEvent.click(screen.getByRole("button",{name:"Configurar asistente"}));
  expect(navigate).not.toHaveBeenCalled();
});

test("keeps verification reachable when the browser blocks a popup",async()=>{
  const {atlasApi}=await import("../api/atlasApi"),{publicWebChatApi}=await import("../api/publicWebChatApi");
  vi.mocked(atlasApi.startActivationVerification).mockResolvedValue({token:"a".repeat(43),expiresAt:"2026-01-01T00:15:00.000Z"});
  vi.mocked(atlasApi.listWebChatConnections).mockResolvedValue([{id:"wcc_1",publicId:"wcp_00000000000000000000000000000000",assistantProfileId:"assistant",status:"active",createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z"}]);
  vi.mocked(publicWebChatApi.startActivationVerification).mockResolvedValue();
  vi.spyOn(window,"open").mockReturnValue(null);
  render(<ActivationJourney csrf="csrf" workspaceId="workspace" companyId={1} projection={projection("start_verification")} onNavigate={()=>{}} onRefresh={()=>{}}/>);
  fireEvent.click(screen.getByRole("button",{name:"Iniciar verificación"}));
  expect((await screen.findByRole("link",{name:"Abrir conversación de verificación"})).getAttribute("href")).toBe("/chat/wcp_00000000000000000000000000000000");
});
