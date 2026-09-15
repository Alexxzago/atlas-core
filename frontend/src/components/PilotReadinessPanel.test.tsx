// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import type { PilotReadiness } from "../types/api";
import { CompanySetupChecklist } from "./CompanySetupChecklist";
import { PilotReadinessPanel, safePilotReadinessPath } from "./PilotReadinessPanel";

const workspace={id:"workspace",name:"Workspace",role:"owner",capabilities:["company:read","company:manage"] as ("company:read"|"company:manage")[]};
const company={id:1,name:"Company A",website:null,phone:"",email:"",status:"ready" as const,createdAt:"2026-01-01T00:00:00.000Z"};
const readiness:PilotReadiness={overall:"not_ready",classification:"setup_incomplete",checks:[{id:"default_assistant",required:true,status:"incomplete",owner:"customer",reasonCode:"default_assistant_not_executable",actionPath:"/companies/1/assistant"},{id:"published_knowledge",required:true,status:"incomplete",owner:"customer",reasonCode:"published_knowledge_missing",actionPath:"/companies/1/knowledge"},{id:"scheduling",required:false,status:"incomplete",owner:"customer",reasonCode:"scheduling_not_configured",actionPath:"/companies/1/channels"}],nextAction:"configure_assistant",evaluatedAt:"2026-01-01T00:00:00.000Z",policyVersion:"pilot-readiness-v1"};
const json=(value:unknown):Response=>new Response(JSON.stringify(value),{status:200,headers:{"content-type":"application/json"}});

afterEach(()=>{cleanup();vi.unstubAllGlobals();});

test("renders the authoritative readiness projection with one primary action and optional improvements",()=>{
  const navigate=vi.fn();
  render(<I18nProvider><PilotReadinessPanel companyId={1} readiness={readiness} onNavigate={navigate}/></I18nProvider>);
  expect(screen.getByText("Faltan pasos de configuración")).toBeTruthy();
  expect(screen.getByRole("heading",{name:"Configuración necesaria"})).toBeTruthy();
  expect(screen.getByRole("heading",{name:"Mejorá tu piloto"})).toBeTruthy();
   expect(screen.getAllByRole("button",{name:"Configurar asistente"})).toHaveLength(1);
  expect(screen.getAllByRole("button",{name:"Publicar conocimiento"})).toHaveLength(1);
   fireEvent.click(screen.getByRole("button",{name:"Configurar asistente"}));
  expect(navigate).toHaveBeenCalledWith("/companies/1/assistant");
});

test("does not render actions for an untrusted readiness path",()=>{
  const unsafe: PilotReadiness={...readiness,checks:[{...readiness.checks[0]!,actionPath:"https://unsafe.example"}],nextAction:"configure_assistant"};
  render(<I18nProvider><PilotReadinessPanel companyId={1} readiness={unsafe} onNavigate={()=>{}}/></I18nProvider>);
  expect(screen.queryByRole("button",{name:"Configurar asistente"})).toBeNull();
  expect(safePilotReadinessPath("/companies/2/assistant",1)).toBeNull();
  expect(safePilotReadinessPath("/companies/1/assistant",1)).toBe("/companies/1/assistant");
});

test("shows an unavailable state and retries the single readiness request",async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(new Response("",{status:503})).mockResolvedValueOnce(json(readiness));
  vi.stubGlobal("fetch",fetch);
  render(<I18nProvider><CompanySetupChecklist workspace={workspace} companies={[company]} company={company} onNavigate={()=>{}} onChooseCompany={()=>{}}/></I18nProvider>);
  expect((await screen.findByRole("alert")).textContent).toContain("Estado temporalmente no disponible");
  fireEvent.click(screen.getByRole("button",{name:"Reintentar"}));
  expect(await screen.findByText("Faltan pasos de configuración")).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(2);
});
