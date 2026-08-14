// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { AuthenticationProvider, useAuthentication } from "./AuthenticationContext";
import { atlasApi } from "../api/atlasApi";

function json(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
class TestBroadcastChannel {
  public static instances: TestBroadcastChannel[] = [];
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public readonly messages: unknown[] = [];
  public constructor(_name: string) { TestBroadcastChannel.instances.push(this); }
  public postMessage(message: unknown): void { this.messages.push(message); }
  public close(): void {}
}

function Probe(): React.JSX.Element { const { state, logout } = useAuthentication(); return <><p>{state.status === "authenticated" ? `${state.identity.email}:${state.csrfToken}:${state.csrfGeneration}` : state.status}</p><button onClick={() => void logout()}>Logout</button></>; }

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); TestBroadcastChannel.instances = []; });

test("owns bootstrap authentication state", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({ status: "authenticated", identity: { userId: "user", email: "customer@example.test", locale: "en", status: "active", idleExpiresAt: "2026-01-01", absoluteExpiresAt: "2026-01-01" }, csrfToken: "csrf", csrfGeneration: 1 }))));
  render(<I18nProvider><AuthenticationProvider><Probe /></AuthenticationProvider></I18nProvider>);
  await waitFor(() => expect(screen.getByText("customer@example.test:csrf:1")).toBeTruthy());
});

test("renews a visible session once every thirty minutes",async()=>{vi.useFakeTimers();const response=(csrfToken:string,csrfGeneration:number)=>json({status:"authenticated",identity:{userId:"user",email:"customer@example.test",locale:"en",status:"active",idleExpiresAt:"2026-01-01",absoluteExpiresAt:"2026-01-01"},csrfToken,csrfGeneration});const fetch=vi.fn().mockResolvedValueOnce(response("csrf-a",1)).mockResolvedValueOnce(response("csrf-b",2));vi.stubGlobal("fetch",fetch);render(<I18nProvider><AuthenticationProvider><Probe /></AuthenticationProvider></I18nProvider>);await vi.advanceTimersByTimeAsync(0);expect(fetch).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(30*60*1000);expect(fetch).toHaveBeenCalledTimes(2);});

test("a generic tenant 404 with an expired session invalidates authentication",async()=>{const authenticated=json({status:"authenticated",identity:{userId:"user",email:"customer@example.test",locale:"en",status:"active",idleExpiresAt:"2026-01-01",absoluteExpiresAt:"2026-01-01"},csrfToken:"csrf",csrfGeneration:1});vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(authenticated).mockResolvedValueOnce(new Response(JSON.stringify({error:"Resource not found."}),{status:404,headers:{"content-type":"application/json"}})).mockResolvedValueOnce(new Response(JSON.stringify({status:"unauthenticated"}),{status:401,headers:{"content-type":"application/json"}})));render(<I18nProvider><AuthenticationProvider><Probe /></AuthenticationProvider></I18nProvider>);await screen.findByText("customer@example.test:csrf:1");await expect(atlasApi.listWorkspaceCompanies("wsp_one")).rejects.toMatchObject({status:404});await screen.findByText("unauthenticated");});

test("retries logout once with the CSRF token bootstrapped from the shared replacement session", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(json({ status: "authenticated", identity: { userId: "user", email: "customer@example.test", locale: "en", status: "active", idleExpiresAt: "2026-01-01", absoluteExpiresAt: "2026-01-01" }, csrfToken: "csrf-a", csrfGeneration: 3 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Authentication failed." }), { status: 401, headers: { "content-type": "application/json" } }))
    .mockResolvedValueOnce(json({ status: "authenticated", identity: { userId: "user", email: "customer@example.test", locale: "en", status: "active", idleExpiresAt: "2026-01-01", absoluteExpiresAt: "2026-01-01" }, csrfToken: "csrf-b", csrfGeneration: 2 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 })));
  vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
  render(<I18nProvider><AuthenticationProvider><Probe /></AuthenticationProvider></I18nProvider>);
  await screen.findByText("customer@example.test:csrf-a:3");
  fireEvent.click(screen.getByRole("button", { name: "Logout" }));
  await waitFor(() => expect(screen.getByText("unauthenticated")).toBeTruthy());
  const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
  expect(calls).toHaveLength(4);
  expect(calls[1]?.[0]).toBe("/api/identity/logout");
  expect((calls[1]?.[1] as RequestInit).credentials).toBe("same-origin");
  expect((calls[1]?.[1] as RequestInit).headers).toMatchObject({ "x-csrf-token": "csrf-a" });
  expect((calls[3]?.[1] as RequestInit).headers).toMatchObject({ "x-csrf-token": "csrf-b" });
  expect(TestBroadcastChannel.instances[0]?.messages).toContainEqual({ type: "logout" });
});

test("invalidates locally when the single logout recovery bootstrap fails", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(json({ status: "authenticated", identity: { userId: "user", email: "customer@example.test", locale: "en", status: "active", idleExpiresAt: "2026-01-01", absoluteExpiresAt: "2026-01-01" }, csrfToken: "csrf-a", csrfGeneration: 3 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Authentication failed." }), { status: 401, headers: { "content-type": "application/json" } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: "unauthenticated" }), { status: 401, headers: { "content-type": "application/json" } })));
  render(<I18nProvider><AuthenticationProvider><Probe /></AuthenticationProvider></I18nProvider>);
  await screen.findByText("customer@example.test:csrf-a:3");
  fireEvent.click(screen.getByRole("button", { name: "Logout" }));
  await waitFor(() => expect(screen.getByText("unauthenticated")).toBeTruthy());
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("session replacement accepts a lower CSRF generation after rebootstrap and ignores delayed old rotations", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(json({ status: "authenticated", identity: { userId: "user-a", email: "first@example.test", locale: "en", status: "active", idleExpiresAt: "2026-01-01", absoluteExpiresAt: "2026-01-01" }, csrfToken: "csrf-a", csrfGeneration: 3 }))
    .mockResolvedValueOnce(json({ status: "authenticated", identity: { userId: "user-b", email: "second@example.test", locale: "en", status: "active", idleExpiresAt: "2026-01-01", absoluteExpiresAt: "2026-01-01" }, csrfToken: "csrf-b", csrfGeneration: 2 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 })));
  vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
  render(<I18nProvider><AuthenticationProvider><Probe /></AuthenticationProvider></I18nProvider>);
  await screen.findByText("first@example.test:csrf-a:3");
  const instance = TestBroadcastChannel.instances[0]!;
  instance.onmessage?.({ data: { type: "session-replaced", sessionIncarnation: "session-b" } } as MessageEvent);
  instance.onmessage?.({ data: { type: "csrf-rotated", csrfToken: "old", csrfGeneration: 4, sessionIncarnation: null } } as MessageEvent);
  await screen.findByText("second@example.test:csrf-b:2");
  fireEvent.click(screen.getByRole("button", { name: "Logout" }));
  await waitFor(() => expect(screen.getByText("unauthenticated")).toBeTruthy());
  expect((fetch as ReturnType<typeof vi.fn>).mock.calls[2]?.[1]).toMatchObject({ headers: { "x-csrf-token": "csrf-b" } });
});
