// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { RouterProvider } from "../routing/RouterProvider";
import { AuthenticationProvider } from "../state/AuthenticationContext";
import { ThemeProvider } from "../design-system/theme";
import { GuidedForgotPassword } from "./GuidedForgotPassword";
import { GuidedResetPassword } from "./GuidedResetPassword";
import { GuidedSetupFoundation } from "./GuidedSetupFoundation";

function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
function renderForgot(onSignIn = vi.fn()): ReturnType<typeof render> { return render(<I18nProvider><GuidedForgotPassword onSignIn={onSignIn}/></I18nProvider>); }
function renderReset(proof = "reset-proof", onSignIn = vi.fn()): ReturnType<typeof render> { return render(<I18nProvider><GuidedResetPassword proof={proof} onSignIn={onSignIn}/></I18nProvider>); }
function renderGuided(): void { render(<ThemeProvider><I18nProvider><RouterProvider><AuthenticationProvider><GuidedSetupFoundation /></AuthenticationProvider></RouterProvider></I18nProvider></ThemeProvider>); }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); window.history.replaceState({}, "", "/"); });

test("renders the forgot-password email form and sends the exact enumeration-safe contract", async () => {
  const fetch = vi.fn(() => Promise.resolve(json({ status: "password_reset_requested" }, 202)));
  vi.stubGlobal("fetch", fetch); renderForgot();
  const email = screen.getByLabelText("Email") as HTMLInputElement;
  expect(email.id).toBe("password-reset-email"); expect(email.name).toBe("email"); expect(email.autocomplete).toBe("email");
  fireEvent.change(email, { target: { value: " person@example.test " } }); fireEvent.click(screen.getByRole("button", { name: "Send link" }));
  await screen.findByRole("heading", { name: "Check your email" });
  expect(fetch).toHaveBeenCalledWith("/api/identity/password-reset/request", expect.objectContaining({ method: "POST", credentials: "same-origin", body: JSON.stringify({ email: "person@example.test", locale: "en" }) }));
  expect(screen.getByRole("status").textContent).toBe("If an account is associated, we will send you a password reset link.");
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Check your email" }));
});

test("shows a loading state and a safe unavailable error for password-reset requests", async () => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((next) => { resolve = next; }))); renderForgot();
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.test" } }); fireEvent.click(screen.getByRole("button", { name: "Send link" }));
  expect((screen.getByRole("button", { name: "Sending" }) as HTMLButtonElement).disabled).toBe(true);
  resolve(json({}, 503)); await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toBe("We could not request the link right now. Try again.");
});

test("supports Spanish recovery content and the sign-in return action", () => {
  window.localStorage.setItem("atlas.locale", "es"); const onSignIn = vi.fn(); renderForgot(onSignIn);
  expect(screen.getByRole("heading", { name: "Restablecer contraseña" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Ir a iniciar sesión" })); expect(onSignIn).toHaveBeenCalledOnce();
});

test("renders reset fields, removes the proof from browser history, and validates mismatches", () => {
  window.history.replaceState({}, "", "/reset-password?proof=secret-proof"); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); renderReset("secret-proof");
  const password = screen.getByLabelText("New password") as HTMLInputElement, confirmation = screen.getByLabelText("Confirm new password") as HTMLInputElement;
  expect(window.location.search).toBe(""); expect(password.autocomplete).toBe("new-password"); expect(confirmation.autocomplete).toBe("new-password");
  fireEvent.change(password, { target: { value: "a secure replacement password" } }); fireEvent.change(confirmation, { target: { value: "different replacement password" } }); fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  expect(screen.getByRole("alert").textContent).toBe("Passwords must match."); expect(fetch).not.toHaveBeenCalled();
});

test("maps missing, invalid, and expired reset proofs to the safe invalid state", async () => {
  renderReset(""); await screen.findByRole("heading", { name: "This link is invalid or expired" }); cleanup();
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({}, 400)))); renderReset("expired-proof");
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a secure replacement password" } }); fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "a secure replacement password" } }); fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await screen.findByRole("heading", { name: "This link is invalid or expired" });
});

test("submits the frozen reset contract and provides a sign-in success action", async () => {
  const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))), onSignIn = vi.fn(); vi.stubGlobal("fetch", fetch); renderReset("proof-value", onSignIn);
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a secure replacement password" } }); fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "a secure replacement password" } }); fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  await screen.findByRole("heading", { name: "Password reset" });
  expect(fetch).toHaveBeenCalledWith("/api/identity/password-reset/complete", expect.objectContaining({ method: "POST", credentials: "same-origin", body: JSON.stringify({ proof: "proof-value", password: "a secure replacement password", confirmation: "a secure replacement password" }) }));
  fireEvent.click(screen.getByRole("button", { name: "Go to sign in" })); expect(onSignIn).toHaveBeenCalledOnce();
});

test("renders recovery forms after direct navigation and refresh through the guided route", async () => {
  window.history.replaceState({}, "", "/forgot-password"); vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({}, 401)))); renderGuided();
  await screen.findByLabelText("Email"); cleanup();
  window.history.replaceState({}, "", "/reset-password?proof=refresh-proof"); renderGuided();
  await screen.findByLabelText("New password"); await waitFor(() => expect(window.location.search).toBe(""));
});
