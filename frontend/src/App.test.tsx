// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import App from "./App";
import { I18nProvider } from "./i18n/I18nContext";
import { RouterProvider } from "./routing/RouterProvider";
import { AuthenticationProvider } from "./state/AuthenticationContext";
import { ThemeProvider } from "./design-system/theme";

const identity = { userId: "user", email: "customer@example.test", locale: "en", status: "active", idleExpiresAt: "2026-01-01", absoluteExpiresAt: "2026-01-01" };
const workspace = { id: "workspace", name: "Workspace", role: "owner", capabilities: ["company:read", "company:manage"] };
const readyCompany = { id: 1, name: "Company", website: null, phone: "", email: "", status: "ready", createdAt: "2026-01-01", updatedAt: "2026-01-01" };

function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
function renderApp(): void { render(<ThemeProvider><I18nProvider><RouterProvider><AuthenticationProvider><App /></AuthenticationProvider></RouterProvider></I18nProvider></ThemeProvider>); }
function authenticatedFetch(workspaces: unknown[], companies: unknown[]): void {
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/session/bootstrap")) return Promise.resolve(json({ status: "authenticated", identity, csrfToken: "csrf", csrfGeneration: 1 }));
    if (url.endsWith("/workspaces") && !url.includes("selected")) return Promise.resolve(json(workspaces));
    if (url.endsWith("/workspaces/selected") || url.endsWith("/workspaces/workspace/select")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/companies")) return Promise.resolve(json(companies));
    if (url.endsWith("/assistant-readiness")) return Promise.resolve(json({ status: "blocked", blockers: [] }));
    return Promise.resolve(json({}, 404));
  }));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

test("sends an unauthenticated root visitor to sign in with account recovery actions", async () => {
  window.history.replaceState({}, "", "/");
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({}, 401))));
  renderApp();
  await screen.findByRole("heading", { name: "Welcome back" });
  expect(window.location.pathname).toBe("/sign-in");
  expect(screen.getByRole("link", { name: "Create account" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Forgot your password?" })).toBeTruthy();
});

test("keeps registration public for an unauthenticated visitor", async () => {
  window.history.replaceState({}, "", "/register");
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({}, 401))));
  renderApp();
  await screen.findByRole("heading", { name: "Meet Atlas" });
  expect(window.location.pathname).toBe("/register");
});

test("routes an authenticated returning user from root to the dashboard", async () => {
  window.history.replaceState({}, "", "/");
  authenticatedFetch([workspace], [readyCompany]);
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/dashboard"));
});

test("shows a branded startup state until session bootstrap resolves", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((next) => { resolve = next; })));
  renderApp();
  expect(screen.getByRole("status", { name: "Preparing your workspace…" })).toBeTruthy();
  expect(screen.getByText("ATLAS")).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
  resolve(json({}, 401));
  await screen.findByRole("heading", { name: "Welcome back" });
});

test("shows a safe bootstrap failure state and retries without exposing transport details", async () => {
  let attempts = 0;
  vi.stubGlobal("fetch", vi.fn(() => { attempts += 1; return attempts === 1 ? Promise.reject(new TypeError("ECONNREFUSED /api/session/bootstrap")) : Promise.resolve(json({}, 401)); }));
  renderApp();
  await screen.findByRole("heading", { name: "We couldn't connect to Atlas." });
  expect(screen.queryByText(/ECONNREFUSED/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("heading", { name: "Welcome back" });
  expect(attempts).toBe(2);
});

test("routes an authenticated user without a workspace to workspace setup", async () => {
  window.history.replaceState({}, "", "/");
  authenticatedFetch([], []);
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/onboarding/workspace"));
});

test("renders workspace setup instead of a blank self-redirect when no workspace exists", async () => {
  window.history.replaceState({}, "", "/onboarding/workspace");
  authenticatedFetch([], []);
  renderApp();
  await screen.findByRole("heading", { name: "Great! Your account is ready." });
  expect(window.location.pathname).toBe("/onboarding/workspace");
});

test("routes an authenticated user with an empty workspace to company setup", async () => {
  window.history.replaceState({}, "", "/");
  authenticatedFetch([workspace], []);
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/onboarding/company"));
});

test("redirects an authenticated registration visit to its existing portal", async () => {
  window.history.replaceState({}, "", "/register");
  authenticatedFetch([workspace], [readyCompany]);
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/dashboard"));
});

test("restores a valid session on refresh", async () => {
  window.history.replaceState({}, "", "/");
  authenticatedFetch([workspace], [readyCompany]);
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/dashboard"));
  expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/session/bootstrap"))).toBe(true);
});

test("waits for workspace loading before resolving a direct onboarding refresh", async () => {
  let resolveWorkspaces!: (response: Response) => void;
  window.history.replaceState({}, "", "/onboarding/workspace");
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/session/bootstrap")) return Promise.resolve(json({ status: "authenticated", identity, csrfToken: "csrf", csrfGeneration: 1 }));
    if (url.endsWith("/workspaces") && !url.includes("selected")) return new Promise<Response>((resolve) => { resolveWorkspaces = resolve; });
    if (url.endsWith("/workspaces/selected") || url.endsWith("/workspaces/workspace/select")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/companies")) return Promise.resolve(json([readyCompany]));
    return Promise.resolve(json({}, 404));
  }));
  renderApp();
  await screen.findByRole("status", { name: "Preparing your workspace…" });
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/workspaces"))).toBe(true));
  expect(window.location.pathname).toBe("/onboarding/workspace");
  resolveWorkspaces(json([workspace]));
  await waitFor(() => expect(window.location.pathname).toBe("/dashboard"));
});

test("redirects a direct onboarding refresh with an existing workspace and company to the dashboard", async () => {
  window.history.replaceState({}, "", "/onboarding/workspace");
  authenticatedFetch([workspace], [readyCompany]);
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/dashboard"));
  await screen.findByRole("heading", { name: "Choose the company Atlas works for" });
});

test("routes the production Company Core list envelope to the dashboard", async () => {
  const coreCompany = { id: 1, name: "Company", slug: "company", description: null, website: null, branding: { publicName: null, logoAssetReference: null, colorTokens: {} }, configuration: null, lifecycle: "operational", version: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01", lifecycleChangedAt: "2026-01-01", suspendedAt: null, archivedAt: null };
  window.history.replaceState({}, "", "/onboarding/workspace");
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/session/bootstrap")) return Promise.resolve(json({ status: "authenticated", identity, csrfToken: "csrf", csrfGeneration: 1 }));
    if (url.endsWith("/workspaces") && !url.includes("selected")) return Promise.resolve(json([workspace]));
    if (url.endsWith("/workspaces/selected") || url.endsWith("/workspaces/workspace/select")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/companies")) return Promise.resolve(json({ data: [coreCompany] }));
    return Promise.resolve(json({}, 404));
  }));
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/dashboard"));
});

test("routes an empty production Company Core list envelope to company setup", async () => {
  window.history.replaceState({}, "", "/onboarding/workspace");
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/session/bootstrap")) return Promise.resolve(json({ status: "authenticated", identity, csrfToken: "csrf", csrfGeneration: 1 }));
    if (url.endsWith("/workspaces") && !url.includes("selected")) return Promise.resolve(json([workspace]));
    if (url.endsWith("/workspaces/selected") || url.endsWith("/workspaces/workspace/select")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/companies")) return Promise.resolve(json({ data: [] }));
    return Promise.resolve(json({}, 404));
  }));
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/onboarding/company"));
});

test("treats an expired session as unauthenticated", async () => {
  window.history.replaceState({}, "", "/");
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({}, 401))));
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/sign-in"));
});

test("routes a single processing company to activation pending", async () => {
  window.history.replaceState({}, "", "/");
  authenticatedFetch([workspace], [{ ...readyCompany, status: "processing" }]);
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/activation-pending"));
  await screen.findByRole("heading", { name: "Knowledge imported successfully" });
});

test("redirects a direct protected route without a session to sign in", async () => {
  window.history.replaceState({}, "", "/dashboard");
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({}, 401))));
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/sign-in"));
  await screen.findByRole("heading", { name: "Welcome back" });
});
