// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { AssistantProfileForm } from "./AssistantProfileForm";

const persisted = { id:"assistant-1",name:"Atlas Assistant",description:null,businessRole:null,objective:null,audience:null,tone:"professional" as const,assistantLanguage:"en" as const,welcomeMessage:null,fallbackMessage:"Contact support.",status:"draft" as const,createdAt:"2026-01-01T00:00:00.000Z",updatedAt:"2026-01-01T00:00:00.000Z",archivedAt:null };
afterEach(() => cleanup());
const renderForm = (props: Partial<React.ComponentProps<typeof AssistantProfileForm>> = {}) => render(<I18nProvider><AssistantProfileForm mode="create" submitting={false} onSubmit={vi.fn().mockResolvedValue(persisted)} onCancel={vi.fn()} {...props}/></I18nProvider>);

test("renders all logical setup steps and derives completed state from persisted configuration", () => {
  const view = renderForm({ mode:"edit", profile:persisted });
  expect(screen.getByRole("button", { name:"Identidad" })).toBeTruthy();
  expect(screen.getByRole("button", { name:"Cómo responde" })).toBeTruthy();
  expect(screen.getByRole("button", { name:"Rol y objetivo" })).toBeTruthy();
  expect(screen.getByRole("button", { name:"Mensajes y ayuda" }).getAttribute("aria-current")).toBe("step");
  expect(view.container.querySelectorAll(".assistant-stepper__step.is-completed")).toHaveLength(3);
  expect(window.localStorage.getItem("assistant-setup-progress")).toBeNull();
});

test("save persists and stays, while save and continue persists then advances", async () => {
  const save = vi.fn().mockResolvedValue(persisted);
  renderForm({ onSubmit:save });
  fireEvent.change(screen.getByLabelText("Assistant name"), { target:{ value:"Customer care" } });
  fireEvent.change(screen.getByLabelText("Language"), { target:{ value:"en" } });
  fireEvent.click(screen.getByRole("button", { name:"Guardar" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("heading", { name:"Identidad" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name:"Guardar y continuar" }));
  await screen.findByRole("heading", { name:"Cómo responde" });
  expect(save).toHaveBeenCalledTimes(2);
});

test("validation and failed saves do not advance, and optional fields do not block later steps", async () => {
  const failed = vi.fn().mockResolvedValue(null);
  renderForm({ onSubmit:failed });
  fireEvent.click(screen.getByRole("button", { name:"Guardar y continuar" }));
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.getByRole("heading", { name:"Identidad" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Assistant name"), { target:{ value:"Customer care" } });
  fireEvent.change(screen.getByLabelText("Language"), { target:{ value:"en" } });
  fireEvent.click(screen.getByRole("button", { name:"Guardar y continuar" }));
  await waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("heading", { name:"Identidad" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name:"Cómo responde" }));
  fireEvent.click(screen.getByRole("button", { name:"Guardar y continuar" }));
  await waitFor(() => expect(failed).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("heading", { name:"Cómo responde" })).toBeTruthy();
});
