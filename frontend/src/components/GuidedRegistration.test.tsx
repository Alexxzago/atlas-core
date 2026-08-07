// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { RouterProvider } from "../routing/RouterProvider";
import { GuidedRegistration } from "./GuidedRegistration";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function renderRegistration(proof?: string): void {
  render(
    <I18nProvider>
      <RouterProvider>
        {proof === undefined ? <GuidedRegistration /> : <GuidedRegistration verificationProof={proof} />}
      </RouterProvider>
    </I18nProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("submits the compact Create Account form and matches backend policy length", async () => {
  const fetch = vi.fn(() => Promise.resolve(json({ status: "verification_requested" }, 202)));
  vi.stubGlobal("fetch", fetch);
  renderRegistration();

  expect(screen.getByRole("heading", { name: "Create account" })).toBeTruthy();

  // Fill in form fields
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Ada Lovelace" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.test" } });

  // Test password policy (must be at least 15 characters, let's use a 15+ character password)
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a sufficiently long secure password" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a sufficiently long secure password" } });

  // Submit form
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));

  await screen.findByRole("heading", { name: "Check your email" });
  expect(fetch).toHaveBeenCalledWith(
    "/api/identity/register",
    expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify({
        fullName: "Ada Lovelace",
        email: "ada@example.test",
        password: "a sufficiently long secure password",
        confirmation: "a sufficiently long secure password",
        locale: "en",
      }),
    })
  );
  expect(screen.getByRole("status").textContent).toContain("ada@example.test");
});

test("resends the verification email from the success screen", async () => {
  const fetch = vi.fn(() => Promise.resolve(json({ status: "verification_requested" }, 202)));
  vi.stubGlobal("fetch", fetch);
  renderRegistration();

  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Ada" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a sufficiently long secure password" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a sufficiently long secure password" } });

  fireEvent.click(screen.getByRole("button", { name: "Create account" }));

  await screen.findByRole("heading", { name: "Check your email" });
  fireEvent.click(screen.getByRole("button", { name: "Resend link" }));

  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      "/api/identity/resend-verification",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "ada@example.test", locale: "en" }),
      })
    )
  );
});

test("keeps form visible with validation error when passwords differ", async () => {
  renderRegistration();

  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Ada" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a sufficiently long secure password" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "another password" } });

  fireEvent.click(screen.getByRole("button", { name: "Create account" }));

  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toBe("Passwords must match.");
  expect(screen.getByRole("heading", { name: "Create account" })).toBeTruthy();
});

test("maps registration failures and exposes loading state", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((next) => { resolve = next; })));
  renderRegistration();

  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Ada" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a sufficiently long secure password" } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a sufficiently long secure password" } });

  fireEvent.click(screen.getByRole("button", { name: "Create account" }));

  expect((screen.getByRole("button", { name: "Continuing" }) as HTMLButtonElement).disabled).toBe(true);
  resolve(json({ error: "internal detail" }, 503));

  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toBe("We cannot continue right now. Try again.");
});

test("verifies an email proof and shows Sign In button, not Create Password", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({ status: "verified", nextStep: "login" }))));
  renderRegistration("proof value");

  expect(screen.getByRole("status", { name: "Continuing" })).toBeTruthy();
  await screen.findByRole("heading", { name: "Your email is verified" });

  expect(screen.getByRole("status").textContent).toContain("continue configuring your assistant");
  expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Create password" })).toBeNull();
});

test("shows the safe invalid verification outcome", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json({ status: "invalid_or_expired" }, 400))));
  renderRegistration("expired");
  await waitFor(() => expect(screen.getByRole("heading", { name: "This link is no longer valid" })).toBeTruthy());
});
