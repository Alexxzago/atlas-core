// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { ThemeProvider } from "../design-system/theme";
import { RouterProvider } from "../routing/RouterProvider";
import { AuthenticatedCompanyPortal } from "./AuthenticatedCompanyPortal";
import { AuthenticatedCompanySelector } from "./AuthenticatedCompanySelector";
import { CompanySetupChecklist } from "./CompanySetupChecklist";
import { companyRoutePresentation } from "../routing/companyRoutePresentation";
import { WorkspaceMembershipPortal } from "./WorkspaceMembershipPortal";

const workspace = { id: "workspace", name: "Workspace", role: "owner", capabilities: ["company:read", "company:manage"] as ("company:read" | "company:manage")[] };
const companyA = { id: 1, name: "Company A", website: "", phone: "", email: "", status: "ready" as const, createdAt: "2026-01-01T00:00:00.000Z" };
const companyB = { ...companyA, id: 2, name: "Company B" };
const profile = (id: string, name: string) => ({ id, name, description: null, businessRole: "Sales", objective: "Help", audience: null, tone: "professional", assistantLanguage: "en", welcomeMessage: "Hello", fallbackMessage: "Sorry", status: "ready", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null });
const json = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } { let resolve!: (value: T) => void; return { promise: new Promise<T>((next) => { resolve = next; }), resolve }; }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

test("automatically enters the only accessible company after workspace restoration", async () => {
  window.history.replaceState({}, "", "/dashboard");
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/workspaces") && !url.includes("/selected")) return Promise.resolve(json([workspace]));
    if (url.endsWith("/workspaces/selected") || url.endsWith("/workspaces/workspace/select")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/companies")) return Promise.resolve(json([companyA]));
    if (url.endsWith("/workspaces/workspace/companies/1")) return Promise.resolve(json(companyA));
    if (url.endsWith("/companies/1/assistant-profiles")) return Promise.resolve(json([profile("a", "Assistant A")]));
    if (url.endsWith("/assistant/readiness")) return Promise.resolve(json({ assistantIdentifier:"default",workspaceId:1,companyId:1,status:"ready",blockers:[],knowledgeVersionId:"knowledge",assistantProfileId:"a",evaluatedAt:"2026-01-01T00:00:00.000Z",policyVersion:"1",configurationDigest:"digest" }));
    if (url.endsWith("/web-chat-connections") || url.endsWith("/whatsapp-connections")) return Promise.resolve(json([]));
    return Promise.resolve(new Response("", { status: 404 }));
  }));
  render(<ThemeProvider><I18nProvider><RouterProvider><AuthenticatedCompanyPortal csrf="csrf" email="operator@example.test" onPassword={() => {}} onLogout={() => {}}/></RouterProvider></I18nProvider></ThemeProvider>);
  await screen.findByText("Atlas for Company A");
  expect(window.location.pathname).toBe("/companies/1");
  expect(screen.queryByText("Create my first company")).toBeNull();
});

test("multiple accessible companies require an explicit selection", async () => {
  window.history.replaceState({}, "", "/dashboard");
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/workspaces") && !url.includes("/selected")) return Promise.resolve(json([workspace]));
    if (url.endsWith("/workspaces/selected") || url.endsWith("/workspaces/workspace/select")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/companies")) return Promise.resolve(json([companyA, companyB]));
    if (url.endsWith("/workspaces/workspace/companies/1")) return Promise.resolve(json(companyA));
    if (url.endsWith("/companies/1/assistant-profiles")) return Promise.resolve(json([]));
    if (url.endsWith("/assistant/readiness")) return Promise.resolve(json({ assistantIdentifier:"default",workspaceId:1,companyId:1,status:"blocked",blockers:["default_assistant_missing"],knowledgeVersionId:null,assistantProfileId:null,evaluatedAt:"2026-01-01T00:00:00.000Z",policyVersion:"1",configurationDigest:"digest" }));
    if (url.endsWith("/web-chat-connections") || url.endsWith("/whatsapp-connections")) return Promise.resolve(json([]));
    return Promise.resolve(new Response("", { status: 404 }));
  }));
  render(<ThemeProvider><I18nProvider><RouterProvider><AuthenticatedCompanyPortal csrf="csrf" email="operator@example.test" onPassword={() => {}} onLogout={() => {}}/></RouterProvider></I18nProvider></ThemeProvider>);
  await screen.findAllByRole("button", { name: "Current company: Choose company" });
  expect(window.location.pathname).toBe("/dashboard");
  expect(screen.queryByText("Atlas for Company A")).toBeNull();
  expect(screen.queryByText("Create my first company")).toBeNull();
});

test("keeps a valid direct company route pending until that company is selected", () => {
  expect(companyRoutePresentation("workspace", 1, null, false, { key: "workspace:1", status: "ready" })).toBe("loading");
  expect(companyRoutePresentation("workspace", 1, 1, false, { key: "workspace:1", status: "ready" })).toBe("ready");
});

test("keeps the company chooser closed while selecting the sole company", async () => {
  window.history.replaceState({}, "", "/companies");
  const companyRead = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/workspaces") && !url.includes("/selected")) return Promise.resolve(json([workspace]));
    if (url.endsWith("/workspaces/selected") || url.endsWith("/workspaces/workspace/select")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/companies")) return Promise.resolve(json([companyA]));
    if (url.endsWith("/workspaces/workspace/companies/1")) return companyRead.promise;
    if (url.endsWith("/companies/1/assistant-profiles")) return Promise.resolve(json([profile("a", "Assistant A")]));
    if (url.endsWith("/assistant/readiness")) return Promise.resolve(json({ assistantIdentifier:"default",workspaceId:1,companyId:1,status:"blocked",blockers:["default_assistant_missing"],knowledgeVersionId:null,assistantProfileId:null,evaluatedAt:"2026-01-01T00:00:00.000Z",policyVersion:"1",configurationDigest:"digest" }));
    if (url.endsWith("/web-chat-connections") || url.endsWith("/whatsapp-connections")) return Promise.resolve(json([]));
    return Promise.resolve(new Response("", { status: 404 }));
  }));
  render(<ThemeProvider><I18nProvider><RouterProvider><AuthenticatedCompanyPortal csrf="csrf" email="operator@example.test" onPassword={() => {}} onLogout={() => {}}/></RouterProvider></I18nProvider></ThemeProvider>);
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/workspaces/workspace/companies/1"))).toBe(true));
  expect(screen.queryByRole("heading", { name: "Which company does Atlas work for?" })).toBeNull();
  companyRead.resolve(json(companyA));
  await screen.findByText("Atlas for Company A");
  expect(window.location.pathname).toBe("/companies/1");
});

test("company chooser prioritizes selection and keeps creation secondary", async () => {
  const selected = vi.fn(), create = vi.fn(async () => true);
  render(<I18nProvider><AuthenticatedCompanySelector open companies={[companyA, companyB]} selectedCompanyId={companyA.id} workspaceSelected loading={false} error={false} creating={false} onCreate={create} onCompanySelected={selected} onRetry={() => {}} onClose={() => {}}/></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Company B/ }));
  expect(selected).toHaveBeenCalledWith(2);
  fireEvent.click(screen.getByRole("button", { name: "Create another company" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Company C" } });
  fireEvent.click(screen.getByRole("button", { name: "Create company" }));
  await waitFor(() => expect(create).toHaveBeenCalledWith({ name: "Company C", website: null }));
});

test("company chooser keeps title, subtitle, and close control in distinct accessible regions", async()=>{
  const close=vi.fn(),longCompany={...companyA,name:"A very long company name that remains usable when the dialog becomes narrow"};
  render(<I18nProvider><AuthenticatedCompanySelector open companies={[longCompany]} selectedCompanyId={longCompany.id} workspaceSelected loading={false} error={false} creating={false} onCreate={async()=>false} onCompanySelected={()=>{}} onRetry={()=>{}} onClose={close}/></I18nProvider>);
  const title=screen.getByRole("heading",{name:"Which company does Atlas work for?"}),subtitle=screen.getByText("Choose the context you want to prepare and supervise.");expect(title.tagName).toBe("H2");expect(subtitle.tagName).toBe("P");expect(title.parentElement).toBe(subtitle.parentElement);expect(title.parentElement?.classList.contains("company-chooser__heading")).toBe(true);const closeButton=screen.getByRole("button",{name:"Close"});await waitFor(()=>expect(document.activeElement).toBe(closeButton));fireEvent.keyDown(window,{key:"Escape"});expect(close).toHaveBeenCalledTimes(1);
  cleanup();window.localStorage.setItem("atlas.locale","es");render(<I18nProvider><AuthenticatedCompanySelector open companies={[longCompany]} selectedCompanyId={longCompany.id} workspaceSelected loading={false} error={false} creating={false} onCreate={async()=>false} onCompanySelected={()=>{}} onRetry={()=>{}} onClose={()=>{}}/></I18nProvider>);expect(screen.getByRole("heading",{name:"¿Para qué empresa trabaja Atlas?"})).toBeTruthy();expect(screen.getByText("Elegí el contexto que querés preparar y supervisar.")).toBeTruthy();expect(screen.getByRole("button",{name:"Cerrar"})).toBeTruthy();
});

test("Today translates authoritative blockers into one next action", async () => {
  window.localStorage.setItem("atlas.locale", "es");
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/assistant/readiness")) return Promise.resolve(json({ status: "blocked", blockers: ["default_assistant_missing", "published_knowledge_missing"], knowledgeVersionId: null, assistantProfileId: null }));
    if (url.endsWith("/web-chat-connections") || url.endsWith("/whatsapp-connections")) return Promise.resolve(json([]));
    return Promise.resolve(new Response("", { status: 404 }));
  }));
  render(<I18nProvider><CompanySetupChecklist workspace={workspace} companies={[companyA]} company={companyA} onNavigate={() => {}} onChooseCompany={() => {}}/></I18nProvider>);
  await screen.findByText("Empecemos a configurar tu asistente.");
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Configurar asistente" })).toBeTruthy();
  expect(screen.queryByText("default_assistant_missing")).toBeNull();
});

test("workspace settings presents member IDs as muted metadata, not primary identity", async () => {
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/memberships")) return Promise.resolve(json([{ id:"membership-1",userId:"technical-user-id",role:"operator",status:"active" }]));
    if (url.endsWith("/invitations")) return Promise.resolve(json([]));
    return Promise.resolve(new Response("", { status: 404 }));
  }));
  render(<I18nProvider><WorkspaceMembershipPortal csrf="csrf" workspaces={[workspace]} selectedWorkspace={workspace} pendingWorkspaceId={null} loading={false} error={false} onSelectWorkspace={() => {}} onWorkspacesChanged={() => {}} onActiveWorkspaceLeft={() => {}}/></I18nProvider>);
  expect(await screen.findByText("Team member")).toBeTruthy();
  const technical = screen.getByText(/Secondary account reference: technical-user-id/);
  expect(technical.tagName).toBe("SMALL");
  expect(screen.getByRole("heading", { name: "Team" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Invitations" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Ownership and exit" })).toBeTruthy();
});

test("workspace owner cannot edit or remove self and transfer requires an explicit recipient", async () => {
  const ownerWorkspace={...workspace,capabilities:["workspace:manage","membership:list","membership:invite","membership:manage","owner:transfer"] as unknown as typeof workspace.capabilities};
  const fetch=vi.fn((input:string|URL|Request)=>{const url=String(input);if(url.endsWith("/memberships"))return Promise.resolve(json([{id:"owner-membership",userId:"owner-user",role:"owner",status:"active"},{id:"member-2",userId:"other-user",role:"operator",status:"active"}]));if(url.endsWith("/invitations"))return Promise.resolve(json([]));if(url.endsWith("/transfer-ownership"))return Promise.resolve(new Response("",{status:204}));return Promise.resolve(new Response("",{status:404}))});
  vi.stubGlobal("fetch",fetch);
  render(<I18nProvider><WorkspaceMembershipPortal csrf="csrf" currentUserId="owner-user" currentUserEmail="owner@example.test" workspaces={[ownerWorkspace]} selectedWorkspace={ownerWorkspace} pendingWorkspaceId={null} loading={false} error={false} onSelectWorkspace={()=>{}} onWorkspacesChanged={()=>{}} onActiveWorkspaceLeft={()=>{}}/></I18nProvider>);
  const owner=await screen.findByText("owner@example.test");const ownerRow=owner.closest("li")!;expect(ownerRow.querySelector("select")).toBeNull();expect(ownerRow.textContent).not.toContain("Remove access");
  fireEvent.click(screen.getByRole("button",{name:"Transfer ownership"}));expect(screen.getByRole("button",{name:"Continue transfer"}).hasAttribute("disabled")).toBe(true);fireEvent.click(screen.getByRole("radio",{name:/Team member/}));fireEvent.click(screen.getByRole("button",{name:"Continue transfer"}));expect(screen.getByText(/Team member will become owner/)).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"Confirm"}));
  await waitFor(()=>expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/transfer-ownership"),expect.objectContaining({body:JSON.stringify({targetMembershipId:"member-2",actorRole:"administrator"})})));
});

test("ownership transfer is unavailable until another active member exists", async()=>{
  const ownerWorkspace={...workspace,capabilities:["membership:list","membership:manage","owner:transfer"] as unknown as typeof workspace.capabilities};vi.stubGlobal("fetch",vi.fn((input:string|URL|Request)=>String(input).endsWith("/memberships")?Promise.resolve(json([{id:"owner",userId:"owner-user",role:"owner",status:"active"}])):Promise.resolve(json([]))));
  render(<I18nProvider><WorkspaceMembershipPortal csrf="csrf" currentUserId="owner-user" currentUserEmail="owner@example.test" workspaces={[ownerWorkspace]} selectedWorkspace={ownerWorkspace} pendingWorkspaceId={null} loading={false} error={false} onSelectWorkspace={()=>{}} onWorkspacesChanged={()=>{}} onActiveWorkspaceLeft={()=>{}}/></I18nProvider>);await screen.findByText("owner@example.test");fireEvent.click(screen.getByRole("button",{name:"Transfer ownership"}));expect(screen.getByText("Invite and add another person to the workspace before transferring ownership.")).toBeTruthy();expect(screen.queryByRole("button",{name:"Continue transfer"})).toBeNull();
});
