// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { AuthenticatedPortalProvider, useAuthenticatedPortal, type AuthenticatedPortalContextValue } from "./AuthenticatedPortalProvider";
import { resolveAuthenticatedOnboardingProgress } from "../routing/onboardingProgress";

const workspace = { id: "workspace", name: "Workspace", role: "owner", capabilities: ["company:read"] };

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

afterEach(() => { vi.unstubAllGlobals(); });

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
