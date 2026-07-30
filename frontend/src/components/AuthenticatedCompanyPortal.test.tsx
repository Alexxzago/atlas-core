// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { RouterProvider } from "../routing/RouterProvider";
import { AuthenticatedCompanyPortal } from "./AuthenticatedCompanyPortal";

const workspace = { id: "workspace", name: "Workspace", role: "owner", capabilities: ["company:read", "company:manage"] };
const companyA = { id: 1, name: "Company A", website: "", phone: "", email: "", status: "ready", createdAt: "2026-01-01T00:00:00.000Z" };
const companyB = { id: 2, name: "Company B", website: "", phone: "", email: "", status: "ready", createdAt: "2026-01-01T00:00:00.000Z" };
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
