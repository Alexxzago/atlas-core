// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { GuidedRegistration } from "./GuidedRegistration";

function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
function renderRegistration(proof?: string): void { render(<I18nProvider>{proof === undefined ? <GuidedRegistration /> : <GuidedRegistration verificationProof={proof} />}</I18nProvider>); }
function continueFlow(): void { fireEvent.click(screen.getByRole("button", { name: "Continue" })); }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("guides a customer through one registration task at a time and submits the frozen contract", async () => {
  const fetch = vi.fn(() => Promise.resolve(json({ status: "verification_requested" }, 202)));
  vi.stubGlobal("fetch", fetch);
  renderRegistration();
  expect(screen.getByRole("heading", { name: "Meet Atlas" })).toBeTruthy();
  continueFlow();
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "What should we call you?" }));
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Ada Lovelace" } }); continueFlow();
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.test" } }); continueFlow();
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a secure password" } }); continueFlow();
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a secure password" } }); continueFlow();
  await screen.findByRole("heading", { name: "Check your email" });
  expect(fetch).toHaveBeenCalledWith("/api/identity/register", expect.objectContaining({ method: "POST", credentials: "same-origin", body: JSON.stringify({ fullName: "Ada Lovelace", email: "ada@example.test", password: "a secure password", confirmation: "a secure password", locale: "en" }) }));
  expect(screen.getByRole("status").textContent).toContain("ada@example.test");
});

test("resends the verification email using the frozen enumeration-safe contract", async () => {
  const fetch = vi.fn(() => Promise.resolve(json({ status: "verification_requested" }, 202)));
  vi.stubGlobal("fetch", fetch);
  renderRegistration();
  continueFlow(); fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Ada" } }); continueFlow();
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.test" } }); continueFlow();
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a secure password" } }); continueFlow();
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a secure password" } }); continueFlow();
  await screen.findByRole("heading", { name: "Check your email" });
  fireEvent.click(screen.getByRole("button", { name: "Resend link" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/identity/resend-verification", expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "ada@example.test", locale: "en" }) })));
});

test("keeps confirmation visible with an accessible validation error when passwords differ", () => {
  renderRegistration();
  continueFlow(); fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Ada" } }); continueFlow();
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.test" } }); continueFlow();
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a secure password" } }); continueFlow();
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "another password" } }); continueFlow();
  expect(screen.getByRole("alert").textContent).toBe("Passwords must match.");
  expect(screen.getByRole("heading", { name: "Confirm your password" })).toBeTruthy();
});

test("maps registration failures without exposing backend errors and exposes loading state", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((next) => { resolve = next; })));
  renderRegistration();
  continueFlow(); fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Ada" } }); continueFlow();
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.test" } }); continueFlow();
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a secure password" } }); continueFlow();
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a secure password" } }); continueFlow();
  expect((screen.getByRole("button", { name: "Continuing" }) as HTMLButtonElement).disabled).toBe(true);
  resolve(json({ error: "internal detail" }, 503));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toBe("We cannot continue right now. Try again.");
});

test("verifies an email proof and provides an accessible completion screen", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({ status: "verified", nextStep: "login" }))));
  renderRegistration("proof value");
  expect(screen.getByRole("status", { name: "Continuing" })).toBeTruthy();
  await screen.findByRole("heading", { name: "Your email is verified" });
  expect(screen.getByRole("status").textContent).toContain("continue configuring your assistant");
});

test("shows the safe invalid verification outcome", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({ status: "invalid_or_expired" }, 400))));
  renderRegistration("expired");
  await waitFor(() => expect(screen.getByRole("heading", { name: "This link is no longer valid" })).toBeTruthy());
});
