// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { RouterProvider } from "../routing/RouterProvider";
import { AuthenticatedCompanyPortal } from "./AuthenticatedCompanyPortal";
import { AuthenticatedCompanySelector } from "./AuthenticatedCompanySelector";
import { CompanySetupChecklist } from "./CompanySetupChecklist";

const workspace = { id: "workspace", name: "Workspace", role: "owner", capabilities: ["company:read", "company:manage"] };
const companyA = { id: 1, name: "Company A", website: "", phone: "", email: "", status: "ready" as const, createdAt: "2026-01-01T00:00:00.000Z" };
const companyB = { id: 2, name: "Company B", website: "", phone: "", email: "", status: "ready" as const, createdAt: "2026-01-01T00:00:00.000Z" };
const workspaceB = { id: "workspace-b", name: "Workspace B", role: "owner", capabilities: ["company:read", "company:manage"] };
const profile = (id: string, name: string) => ({ id, name, description: null, businessRole: "Sales", objective: "Help", audience: null, tone: "professional", assistantLanguage: "en", welcomeMessage: "Hello", fallbackMessage: "Sorry", status: "ready", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null });

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function deferred<T>(): { readonly promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((next) => { resolve = next; }), resolve };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("does not render Company A assistant content while Company B validates", async () => {
  window.history.replaceState({}, "", "/companies/1/assistant");
  const companyBRead = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/workspaces") && !url.includes("/selected")) return Promise.resolve(json([workspace]));
    if (url.endsWith("/workspaces/selected")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/select")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/companies")) return Promise.resolve(json([companyA, companyB]));
    if (url.endsWith("/workspaces/workspace/companies/1")) return Promise.resolve(json(companyA));
    if (url.endsWith("/workspaces/workspace/companies/2")) return companyBRead.promise;
    if (url.endsWith("/companies/1/assistant-profiles")) return Promise.resolve(json([profile("profile-a", "Assistant A")]));
    if (url.endsWith("/companies/2/assistant-profiles")) return Promise.resolve(json([profile("profile-b", "Assistant B")]));
    return Promise.resolve(new Response("", { status: 404 }));
  }));

  render(<I18nProvider><RouterProvider><AuthenticatedCompanyPortal csrf="csrf" email="operator@example.test" onPassword={() => {}} onLogout={() => {}} /></RouterProvider></I18nProvider>);
  await screen.findByText("Assistant A");

  act(() => {
    window.history.pushState({}, "", "/companies/2/assistant");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(screen.getByText("Loading content…")).toBeTruthy();
  expect(screen.queryByText("Assistant A")).toBeNull();

  companyBRead.resolve(json(companyB));
  await waitFor(() => expect(screen.getByText("Assistant B")).toBeTruthy());
  expect(screen.queryByText("Assistant A")).toBeNull();
});

test("dashboard distinguishes selection state after company and workspace transitions", async () => {
  window.history.replaceState({}, "", "/dashboard");
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/workspaces") && !url.includes("/selected")) return Promise.resolve(json([workspace, workspaceB]));
    if (url.endsWith("/workspaces/selected")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/select")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace-b/select")) return Promise.resolve(json(workspaceB));
    if (url.endsWith("/workspaces/workspace/companies")) return Promise.resolve(json([companyA]));
    if (url.endsWith("/workspaces/workspace-b/companies")) return Promise.resolve(json([companyB]));
    if (url.endsWith("/workspaces/workspace/companies/1")) return Promise.resolve(json(companyA));
    if (url.endsWith("/companies/1/assistant-profiles")) return Promise.resolve(json([]));
    return Promise.resolve(new Response("", { status: 404 }));
  }));

  render(<I18nProvider><RouterProvider><AuthenticatedCompanyPortal csrf="csrf" email="operator@example.test" onPassword={() => {}} onLogout={() => {}} /></RouterProvider></I18nProvider>);
  await screen.findByText("Select a company");
  expect(screen.getByText("Select an existing company to view its operational context.")).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Current company"), { target: { value: "1" } });
  await screen.findByRole("heading", { level: 1, name: "Company overview" });
  fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  await screen.findByText("Connect WhatsApp");

  fireEvent.change(screen.getByLabelText("Current Workspace"), { target: { value: "workspace-b" } });
  await screen.findByRole("heading", { level: 1, name: "Companies" });
  fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  await screen.findByText("Select a company");
  expect(screen.queryByText("Company A")).toBeNull();
});

test("company list exposes a direct management action for every company", () => {
  const selected = vi.fn();
  render(<I18nProvider><AuthenticatedCompanySelector companies={[companyA, companyB]} selectedCompanyId={null} workspaceSelected loading={false} error={false} creating={false} onCreate={async () => false} onCompanySelected={selected} onRetry={() => {}} /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Manage company: Company B" }));
  expect(selected).toHaveBeenCalledWith(companyB.id);
});

test("company summary checklist maps public blockers and links to configuration", async () => {
  window.localStorage.setItem("atlas.locale", "es");
  window.history.replaceState({}, "", "/companies/1");
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/assistant/readiness")) return Promise.resolve(json({ status: "blocked", blockers: ["default_assistant_missing", "published_knowledge_missing"], knowledgeVersionId: null, assistantProfileId: null }));
    if (url.endsWith("/web-chat-connections") || url.endsWith("/whatsapp-connections")) return Promise.resolve(json([]));
    return Promise.resolve(new Response("", { status: 404 }));
  }));
  render(<I18nProvider><RouterProvider><CompanySetupChecklist workspaceId="workspace" companyId={1} profiles={[]} /></RouterProvider></I18nProvider>);
  await screen.findByText("Falta seleccionar el asistente predeterminado.");
  expect(screen.getByText("Falta publicar el conocimiento de la empresa.")).toBeTruthy();
  expect(screen.queryByText("default_assistant_missing")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Perfil del asistente/ }));
  expect(window.location.pathname).toBe("/companies/1/assistant");
});
