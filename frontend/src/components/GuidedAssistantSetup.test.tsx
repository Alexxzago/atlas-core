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
function stubSignIn(loginStatus = 200): void { vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => { const url = String(input); if (url.endsWith("/session/bootstrap")) return Promise.resolve(json({}, 401)); if (url.endsWith("/identity/login")) return Promise.resolve(json(loginStatus === 200 ? { status: "authenticated", csrfToken: "csrf", csrfGeneration: 1 } : {}, loginStatus)); if (url.endsWith("/identity/me")) return Promise.resolve(json(identity)); if (url.endsWith("/workspaces") && !url.includes("selected")) return Promise.resolve(json([])); return Promise.resolve(json({}, 404)); })); }
async function openSignIn(): Promise<void> { window.history.replaceState({}, "", "/sign-in"); renderGuided(); await screen.findByRole("heading", { name: "Continue with Atlas" }); }
function loginBody(): { email: string; password: string } { const call = vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith("/identity/login")); if (!call) throw new Error("Expected a sign-in request."); return JSON.parse(String((call[1] as RequestInit).body)) as { email: string; password: string }; }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("guided sign in sends keyboard-entered values through the shared authentication session", async () => {
  stubSignIn(); await openSignIn();
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: identity.email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a secure password" } });
  const emailField = screen.getByLabelText("Email"), passwordField = screen.getByLabelText("Password");
  expect(emailField.getAttribute("id")).toBe("guided-sign-in-email"); expect(emailField.getAttribute("name")).toBe("email"); expect(emailField.getAttribute("autocomplete")).toBe("email"); expect(passwordField.getAttribute("id")).toBe("guided-sign-in-password"); expect(passwordField.getAttribute("name")).toBe("password"); expect(passwordField.getAttribute("autocomplete")).toBe("current-password");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/identity/me"))).toBe(true));
  expect(loginBody()).toEqual({ email: identity.email, password: "a secure password" });
});

test("guided sign in preserves pasted passwords exactly", async () => {
  const password = " leading and trailing !?\u00f1a \u00e1\u00e9\u00ed\u00f3\u00fa ";
  stubSignIn(); await openSignIn();
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: " person@example.test " } });
  const field = screen.getByLabelText("Password");
  fireEvent.paste(field, { clipboardData: { getData: () => password } }); fireEvent.change(field, { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/identity/login"))).toBe(true));
  expect(loginBody()).toEqual({ email: "person@example.test", password });
});

test("guided sign in uses the visible password-manager autofill value", async () => {
  const password = " autofilled \u00a1contrase\u00f1a! ";
  stubSignIn(); await openSignIn();
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: identity.email } });
  const field = screen.getByLabelText("Password") as HTMLInputElement;
  field.value = password;
  fireEvent.submit(field.closest("form")!);
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).endsWith("/identity/login"))).toBe(true));
  expect(loginBody()).toEqual({ email: identity.email, password });
});

test("guided sign in keeps invalid-credential mapping", async () => {
  stubSignIn(401); await openSignIn();
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: identity.email } }); fireEvent.change(screen.getByLabelText("Password"), { target: { value: "incorrect password" } }); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Check your email and password."));
});

test("does not present a backend outage as invalid credentials", async () => {
  stubSignIn(503); await openSignIn();
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

test("shows a retryable error instead of workspace setup when workspace loading fails", async () => {
  window.history.replaceState({}, "", "/onboarding/workspace");
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/session/bootstrap")) return Promise.resolve(json({ status: "authenticated", identity, csrfToken: "csrf", csrfGeneration: 1 }));
    if (url.endsWith("/workspaces") && !url.includes("selected")) return Promise.resolve(json({}, 503));
    return Promise.resolve(json({}, 404));
  }));
  renderGuided();
  expect((await screen.findByRole("alert")).textContent).toBe("We cannot continue right now. Try again.");
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(window.location.pathname).toBe("/onboarding/workspace");
});

test("redirects unauthenticated onboarding access through the shared guard", async () => {
  window.history.replaceState({}, "", "/onboarding/company");
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({}, 401))));
  renderGuided();
  await waitFor(() => expect(window.location.pathname).toBe("/sign-in"));
  expect(screen.getByRole("heading", { name: "Continue with Atlas" })).toBeTruthy();
});
