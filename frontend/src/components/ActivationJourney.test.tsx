// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ActivationJourney } from "./ActivationJourney";
import type { ActivationAction, ActivationProjection } from "../types/api";

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
