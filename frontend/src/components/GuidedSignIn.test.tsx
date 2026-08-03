// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { ThemeProvider } from "../design-system/theme";
import { I18nProvider } from "../i18n/I18nContext";
import { RouterProvider } from "../routing/RouterProvider";
import { AuthenticationProvider } from "../state/AuthenticationContext";
import { GuidedSignIn } from "./GuidedSignIn";

function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
function renderSignIn(): void { render(<ThemeProvider><I18nProvider><RouterProvider><AuthenticationProvider><GuidedSignIn /></AuthenticationProvider></RouterProvider></I18nProvider></ThemeProvider>); }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

test("associates labels, preserves autocomplete, and reveals the exact submitted password", async () => {
  const fetch = vi.fn((input: string | URL | Request) => String(input).endsWith("/session/bootstrap") ? Promise.resolve(json({}, 401)) : Promise.resolve(json({}, 401)));
  vi.stubGlobal("fetch", fetch); renderSignIn();
  const email = screen.getByLabelText("Email") as HTMLInputElement;
  const password = screen.getByLabelText("Password") as HTMLInputElement;
  expect(email.autocomplete).toBe("email"); expect(password.autocomplete).toBe("current-password");
  fireEvent.change(email, { target: { value: " person@example.test " } });
  fireEvent.change(password, { target: { value: " pass word  " } });
  const reveal = screen.getByRole("button", { name: "Show" });
  fireEvent.click(reveal); expect(password.type).toBe("text"); expect(reveal.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/identity/login", expect.objectContaining({ body: JSON.stringify({ email: "person@example.test", password: " pass word  " }) })));
});

test("provides field validation, generic errors, and a single disabled loading submission", async () => {
  let resolve!: (response: Response) => void;
  const fetch = vi.fn((input: string | URL | Request) => String(input).endsWith("/session/bootstrap") ? Promise.resolve(json({}, 401)) : new Promise<Response>((next) => { resolve = next; }));
  vi.stubGlobal("fetch", fetch); renderSignIn();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getAllByRole("alert")).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secure password" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect((screen.getByRole("button", { name: "Preparing" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Preparing" }));
  expect(fetch.mock.calls.filter(([input]) => String(input).endsWith("/identity/login"))).toHaveLength(1);
  resolve(json({}, 401));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toBe("Check your email and password.");
});

test("uses the revised localized sign-in heading", async () => {
  window.localStorage.setItem("atlas.locale", "es");
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({}, 401))));
  renderSignIn();
  expect(screen.getByRole("heading", { name: "Bienvenido de nuevo" })).toBeTruthy();
});
