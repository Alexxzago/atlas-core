// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { AssistantProfileForm } from "./AssistantProfileForm";

afterEach(() => cleanup());

test("groups required fields and preserves optional values across accessible disclosures", () => {
  render(<I18nProvider><AssistantProfileForm mode="create" submitting={false} onSubmit={vi.fn()} onCancel={vi.fn()}/></I18nProvider>);
  expect(screen.getByRole("heading", { name: "Your assistant" })).toBeTruthy();
  const purpose = screen.getByRole("button", { name: /Role and goal/ });
  expect(purpose.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(purpose);
  fireEvent.change(screen.getByLabelText("Goal"), { target: { value: "Help customers" } });
  fireEvent.click(purpose);
  fireEvent.click(purpose);
  expect((screen.getByLabelText("Goal") as HTMLTextAreaElement).value).toBe("Help customers");
});

test("keeps validation and the create payload semantics unchanged", () => {
  const submit = vi.fn();
  render(<I18nProvider><AssistantProfileForm mode="create" submitting={false} onSubmit={submit} onCancel={vi.fn()}/></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
  expect(screen.getByRole("alert").textContent).toContain("name");
  fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "Customer care" } });
  fireEvent.change(screen.getByLabelText("Language"), { target: { value: "en" } });
  fireEvent.click(screen.getByRole("button", { name: /Messages and help/ }));
  fireEvent.change(screen.getByLabelText("Welcome message"), { target: { value: "Hello" } });
  fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
  expect(submit).toHaveBeenCalledWith({ name:"Customer care", assistantLanguage:"en", tone:"professional", description:null, businessRole:null, objective:null, audience:null, welcomeMessage:"Hello" });
});
