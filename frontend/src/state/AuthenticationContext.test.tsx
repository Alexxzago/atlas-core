// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { AuthenticationProvider, useAuthentication } from "./AuthenticationContext";

function json(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
function Probe(): React.JSX.Element { const { state } = useAuthentication(); return <p>{state.status === "authenticated" ? state.identity.email : state.status}</p>; }

afterEach(() => { vi.unstubAllGlobals(); });

test("owns bootstrap authentication state", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({ status: "authenticated", identity: { userId: "user", email: "customer@example.test", locale: "en", status: "active", idleExpiresAt: "2026-01-01", absoluteExpiresAt: "2026-01-01" }, csrfToken: "csrf", csrfGeneration: 1 }))));
  render(<I18nProvider><AuthenticationProvider><Probe /></AuthenticationProvider></I18nProvider>);
  await waitFor(() => expect(screen.getByText("customer@example.test")).toBeTruthy());
});
