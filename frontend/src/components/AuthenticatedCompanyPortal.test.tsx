// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { ThemeProvider } from "../design-system/theme";
import { RouterProvider } from "../routing/RouterProvider";
import { AuthenticatedCompanyPortal } from "./AuthenticatedCompanyPortal";
import { AuthenticatedCompanySelector } from "./AuthenticatedCompanySelector";
import { CompanySetupChecklist } from "./CompanySetupChecklist";
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

test("multiple accessible companies select a deterministic valid company and never show first-company creation", async () => {
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
  await screen.findByText("Atlas for Company A");
  expect(screen.queryByText("Create my first company")).toBeNull();
});

test("does not show stale company content during direct-route validation", async () => {
  window.history.replaceState({}, "", "/companies/1/assistant");
  const companyBRead = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/workspaces") && !url.includes("/selected")) return Promise.resolve(json([workspace]));
    if (url.endsWith("/workspaces/selected") || url.endsWith("/workspaces/workspace/select")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/companies")) return Promise.resolve(json([companyA, companyB]));
    if (url.endsWith("/companies/1")) return Promise.resolve(json(companyA));
    if (url.endsWith("/companies/2")) return companyBRead.promise;
    if (url.endsWith("/companies/1/assistant-profiles")) return Promise.resolve(json([profile("a", "Assistant A")]));
    if (url.endsWith("/companies/2/assistant-profiles")) return Promise.resolve(json([profile("b", "Assistant B")]));
    return Promise.resolve(new Response("", { status: 404 }));
  }));
  render(<ThemeProvider><I18nProvider><RouterProvider><AuthenticatedCompanyPortal csrf="csrf" email="operator@example.test" onPassword={() => {}} onLogout={() => {}}/></RouterProvider></I18nProvider></ThemeProvider>);
  await screen.findByText("Assistant A");
  act(() => { window.history.pushState({}, "", "/companies/2/assistant"); window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(screen.queryByText("Assistant A")).toBeNull();
  companyBRead.resolve(json(companyB));
  await screen.findByText("Assistant B");
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

test("Today translates authoritative blockers into one next action", async () => {
  window.localStorage.setItem("atlas.locale", "es");
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/assistant/readiness")) return Promise.resolve(json({ status: "blocked", blockers: ["default_assistant_missing", "published_knowledge_missing"], knowledgeVersionId: null, assistantProfileId: null }));
    if (url.endsWith("/web-chat-connections") || url.endsWith("/whatsapp-connections")) return Promise.resolve(json([]));
    return Promise.resolve(new Response("", { status: 404 }));
  }));
  render(<I18nProvider><CompanySetupChecklist workspace={workspace} companies={[companyA]} company={companyA} onNavigate={() => {}} onChooseCompany={() => {}}/></I18nProvider>);
  await screen.findByText("Atlas todavía necesita un rol claro.");
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Preparar a Atlas" })).toBeTruthy();
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
  const technical = screen.getByText(/Account reference: technical-user-id/);
  expect(technical.tagName).toBe("SMALL");
  expect(screen.getByRole("heading", { name: "Members" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Invitations" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Ownership and exit" })).toBeTruthy();
});
