// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AuthenticatedPortalProvider, useAuthenticatedPortal, type AuthenticatedPortalContextValue } from "./AuthenticatedPortalProvider";
import { resolveAuthenticatedOnboardingProgress } from "../routing/onboardingProgress";
import { I18nProvider } from "../i18n/I18nContext";
import { AuthenticationProvider, useAuthentication } from "./AuthenticationContext";

const workspace = { id: "workspace", name: "Workspace", role: "owner", capabilities: ["company:read"] };

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("restores the sole workspace and exposes the tenant selectors", async () => {
  const portal: { current: AuthenticatedPortalContextValue | null } = { current: null };
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/workspaces") && !url.includes("/selected")) return Promise.resolve(json([workspace]));
    if (url.endsWith("/workspaces/selected")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/select")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/companies")) return Promise.resolve(json([]));
    return Promise.resolve(new Response("", { status: 404 }));
  }));

  function Consumer(): null { portal.current = useAuthenticatedPortal(); return null; }
  render(<AuthenticatedPortalProvider csrf="csrf"><Consumer /></AuthenticatedPortalProvider>);

  await waitFor(() => expect(portal.current?.selectedWorkspace).toEqual(workspace));
  expect(portal.current?.workspaces).toEqual([workspace]);
  expect(portal.current?.needsWorkspace).toBe(false);
  expect(portal.current?.needsWorkspaceSelection).toBe(false);
  expect(portal.current?.needsCompany).toBe(true);
  expect(portal.current?.hasSelectedCompany).toBe(false);
});

test("keeps a sole workspace in loading while automatic restoration is pending", async () => {
  const portal: { current: AuthenticatedPortalContextValue | null } = { current: null };
  let resolveSelectedWorkspace!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/workspaces") && !url.includes("/selected")) return Promise.resolve(json([workspace]));
    if (url.endsWith("/workspaces/selected")) return new Promise<Response>((resolve) => { resolveSelectedWorkspace = resolve; });
    if (url.endsWith("/workspaces/workspace/select")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/companies")) return Promise.resolve(json([]));
    return Promise.resolve(new Response("", { status: 404 }));
  }));
  function Consumer(): null { portal.current = useAuthenticatedPortal(); return null; }
  render(<AuthenticatedPortalProvider csrf="csrf"><Consumer /></AuthenticatedPortalProvider>);
  await waitFor(() => expect(portal.current?.state.workspaces).toEqual([workspace]));
  const state = portal.current!.state;
  expect(state.initialWorkspaceResolved).toBe(false);
  expect(resolveAuthenticatedOnboardingProgress({ workspacesLoading: state.workspacesLoading, workspaceError: state.workspaceError, initialWorkspaceResolved: state.initialWorkspaceResolved, pendingWorkspaceId: state.pendingWorkspaceId, selectedWorkspaceId: state.selectedWorkspace?.id ?? null, workspaceCount: state.workspaces.length, companiesLoading: state.companiesLoading, companyError: state.companyError, companies: state.companies })).toBe("loading");
  resolveSelectedWorkspace(json(workspace));
  await waitFor(() => expect(portal.current?.state.initialWorkspaceResolved).toBe(true));
  expect(portal.current?.selectedWorkspace).toEqual(workspace);
});

test("reports workspace selection when no persisted workspace can be restored", async () => {
  const portal: { current: AuthenticatedPortalContextValue | null } = { current: null };
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/workspaces") && !url.includes("/selected")) return Promise.resolve(json([workspace, { ...workspace, id: "other" }]));
    if (url.endsWith("/workspaces/selected")) return Promise.resolve(new Response("", { status: 404 }));
    return Promise.resolve(new Response("", { status: 404 }));
  }));

  function Consumer(): null { portal.current = useAuthenticatedPortal(); return null; }
  render(<AuthenticatedPortalProvider csrf="csrf"><Consumer /></AuthenticatedPortalProvider>);

  await waitFor(() => expect(portal.current?.needsWorkspaceSelection).toBe(true));
  expect(portal.current?.selectedWorkspace).toBeNull();
  expect(portal.current?.needsCompany).toBe(false);
});

test("simple company creation uses onboarding, reloads server state, and maps commercial quota errors", async () => {
  const portal: { current: AuthenticatedPortalContextValue | null } = { current: null };
  const company = { id: 7, name: "Created", website: null, lifecycle: "draft", version: 1, createdAt: "2026-01-01T00:00:00.000Z" };
  let onboardingResult: Response = json({ data: company }); let companies = 0;
  const fetchMock = vi.fn((input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/workspaces") && !url.includes("/selected")) return Promise.resolve(json([workspace]));
    if (url.endsWith("/workspaces/selected")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/select")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/companies/onboarding")) return Promise.resolve(onboardingResult);
    if (url.endsWith("/workspaces/workspace/companies")) { companies += 1; return Promise.resolve(json(companies > 1 ? { data: [company] } : { data: [] })); }
    return Promise.resolve(new Response("", { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  function Consumer(): null { portal.current = useAuthenticatedPortal(); return null; }
  render(<AuthenticatedPortalProvider csrf="csrf"><Consumer /></AuthenticatedPortalProvider>);
  await waitFor(() => expect(portal.current?.selectedWorkspace).toEqual(workspace));
  expect(await portal.current?.createCompany({ name: "Created", website: null, phone: "ignored", email: "ignored" })).toBe(true);
  const onboarding = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/companies/onboarding"));
  expect(JSON.parse(String(onboarding?.[1]?.body))).toEqual({ name: "Created", website: null });
  await waitFor(() => expect(portal.current?.companies).toHaveLength(1));
  onboardingResult = new Response(JSON.stringify({ error: { code: "commercial_limit_reached", message: "limit" } }), { status: 409, headers: { "content-type": "application/json" } });
  expect(await portal.current?.createCompany({ name: "Denied", website: null, phone: "", email: "" })).toBe(false);
  await waitFor(() => expect(portal.current?.state.notice?.key).toBe("companies.commercialLimitReached"));
  onboardingResult = new Response(JSON.stringify({ error: { code: "other", message: "other" } }), { status: 500, headers: { "content-type": "application/json" } });
  expect(await portal.current?.createCompany({ name: "Failure", website: null, phone: "", email: "" })).toBe(false);
  await waitFor(() => expect(portal.current?.state.notice?.key).toBe("companies.operationError"));
  onboardingResult = new Response("", { status: 404 });
  expect(await portal.current?.createCompany({ name: "Missing", website: null, phone: "", email: "" })).toBe(false);
  await waitFor(() => expect(portal.current?.selectedWorkspace).toBeNull());
});

test("company creation uses the CSRF token from a later authentication bootstrap", async () => {
  const portal: { current: AuthenticatedPortalContextValue | null } = { current: null };
  const company = { id: 7, name: "Created", website: null, lifecycle: "draft", version: 1, createdAt: "2026-01-01T00:00:00.000Z" };
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/session/bootstrap")) return Promise.resolve(json(fetchMock.mock.calls.filter(([request]) => String(request).endsWith("/session/bootstrap")).length === 1
      ? { status: "authenticated", identity: { userId: "user", email: "user@example.test", locale: "en", status: "active", idleExpiresAt: "2026-01-01", absoluteExpiresAt: "2026-01-01" }, csrfToken: "csrf-a", csrfGeneration: 1 }
      : { status: "authenticated", identity: { userId: "user", email: "user@example.test", locale: "en", status: "active", idleExpiresAt: "2026-01-01", absoluteExpiresAt: "2026-01-01" }, csrfToken: "csrf-b", csrfGeneration: 2 }));
    if (url.endsWith("/workspaces") && !url.includes("/selected")) return Promise.resolve(json([workspace]));
    if (url.endsWith("/workspaces/selected")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/select")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/companies/onboarding")) return Promise.resolve(json({ data: company }));
    if (url.endsWith("/workspaces/workspace/companies")) return Promise.resolve(json({ data: [] }));
    return Promise.resolve(new Response("", { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  function Consumer(): null { portal.current = useAuthenticatedPortal(); return null; }
  function Bridge(): React.JSX.Element | null { const { state, bootstrap } = useAuthentication(); if (state.status !== "authenticated") return null; return <><p>{state.csrfToken}</p><button onClick={() => void bootstrap()}>Rotate session</button><AuthenticatedPortalProvider csrf={state.csrfToken}><Consumer /></AuthenticatedPortalProvider></>; }
  render(<I18nProvider><AuthenticationProvider><Bridge /></AuthenticationProvider></I18nProvider>);
  await waitFor(() => expect(portal.current?.selectedWorkspace).toEqual(workspace));
  fireEvent.click(screen.getByRole("button", { name: "Rotate session" }));
  await screen.findByText("csrf-b");
  expect(await portal.current?.createCompany({ name: "Created", website: null, phone: "", email: "" })).toBe(true);
  const onboarding = fetchMock.mock.calls.find(([request]) => String(request).endsWith("/companies/onboarding"));
  expect((onboarding?.[1] as RequestInit).headers).toMatchObject({ "x-csrf-token": "csrf-b" });
});
