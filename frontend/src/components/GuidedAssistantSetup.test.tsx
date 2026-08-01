// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { RouterProvider } from "../routing/RouterProvider";
import { AuthenticationProvider } from "../state/AuthenticationContext";
import { GuidedSetupFoundation } from "./GuidedSetupFoundation";

const identity = { userId: "user", email: "customer@example.test", locale: "en", status: "active", idleExpiresAt: "2026-01-01", absoluteExpiresAt: "2026-01-01" };
const workspace = { id: "workspace", name: "Workspace", role: "owner", capabilities: ["company:read", "company:manage"] };
function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
function renderGuided(): void { render(<I18nProvider><RouterProvider><AuthenticationProvider><GuidedSetupFoundation /></AuthenticationProvider></RouterProvider></I18nProvider>); }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("guided sign in uses the shared authentication session", async () => {
  window.history.replaceState({}, "", "/sign-in");
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/session/bootstrap")) return Promise.resolve(json({}, 401));
    if (url.endsWith("/identity/login")) return Promise.resolve(json({ status: "authenticated", csrfToken: "csrf", csrfGeneration: 1 }));
    if (url.endsWith("/identity/me")) return Promise.resolve(json(identity));
    if (url.endsWith("/workspaces") && !url.includes("selected")) return Promise.resolve(json([]));
    return Promise.resolve(json({}, 404));
  }));
  renderGuided();
  await screen.findByRole("heading", { name: "Continue with Atlas" });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: identity.email } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a secure password" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/identity/me"))).toBe(true));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/identity/login", expect.objectContaining({ method: "POST", credentials: "same-origin", body: JSON.stringify({ email: identity.email, password: "a secure password" }) }));
  });

test("does not present a backend outage as invalid credentials", async () => {
  window.history.replaceState({}, "", "/sign-in");
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/session/bootstrap")) return Promise.resolve(json({}, 401));
    if (url.endsWith("/identity/login")) return Promise.resolve(json({}, 503));
    return Promise.resolve(json({}, 404));
  }));
  renderGuided();
  await screen.findByRole("heading", { name: "Continue with Atlas" });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: identity.email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a secure password" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(screen.getByRole("alert").textContent).toBe("We cannot continue right now. Try again.");
});

test("restores the selected workspace before routing to company setup", async () => {
  window.history.replaceState({}, "", "/onboarding/workspace");
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/session/bootstrap")) return Promise.resolve(json({ status: "authenticated", identity, csrfToken: "csrf", csrfGeneration: 1 }));
    if (url.endsWith("/workspaces") && !url.includes("selected")) return Promise.resolve(json([workspace]));
    if (url.endsWith("/workspaces/selected")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/select")) return Promise.resolve(json(workspace));
    if (url.endsWith("/workspaces/workspace/companies")) return Promise.resolve(json([]));
    return Promise.resolve(json({}, 404));
  }));
  renderGuided();
  await waitFor(() => expect(window.location.pathname).toBe("/onboarding/company"));
});

test("redirects unauthenticated onboarding access through the shared guard", async () => {
  window.history.replaceState({}, "", "/onboarding/company");
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({}, 401))));
  renderGuided();
  await waitFor(() => expect(window.location.pathname).toBe("/sign-in"));
  expect(screen.getByRole("heading", { name: "Continue with Atlas" })).toBeTruthy();
});
