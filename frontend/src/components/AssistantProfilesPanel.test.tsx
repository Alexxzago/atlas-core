// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { ApiError, atlasApi } from "../api/atlasApi";
import { AssistantProfilesPanel } from "./AssistantProfilesPanel";

const draftProfile = { id: "assistant-1", name: "Atlas Assistant", description: null, businessRole: "Sales", objective: "Help customers", audience: null, tone: "professional" as const, assistantLanguage: "en" as const, welcomeMessage: "Hello", fallbackMessage: "Please contact a person.", status: "draft" as const, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("guides a first-time user to configure an assistant without profile terminology", () => {
  const openCreate = vi.fn();
  render(<I18nProvider><AssistantProfilesPanel csrf="csrf" workspaceId={null} workspaceRole={null} capabilities={["company:manage"]} companyId={null} companyName={null} companySelected profiles={[]} selectedProfile={null} transientArchivedProfile={null} loading={false} error={false} formMode="closed" submitting={false} transitionTarget={null} onSelectProfile={() => {}} onOpenCreate={openCreate} onOpenEdit={() => {}} onCloseForm={() => {}} onSubmitForm={() => {}} onTransition={() => {}} onRetry={() => {}}/></I18nProvider>);
  expect(screen.getByText("Assistant configuration")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Configure how your assistant will work" })).toBeTruthy();
  expect(screen.getByText("Role and goal")).toBeTruthy();
  expect(screen.getByText("How it should respond")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Configure assistant" }));
  expect(openCreate).toHaveBeenCalledTimes(1);
});

test("uses the concise back action while configuring an assistant", () => {
  render(<I18nProvider><AssistantProfilesPanel csrf="csrf" workspaceId={null} workspaceRole={null} capabilities={["company:manage"]} companyId={null} companyName={null} companySelected profiles={[]} selectedProfile={null} transientArchivedProfile={null} loading={false} error={false} formMode="create" submitting={false} transitionTarget={null} onSelectProfile={() => {}} onOpenCreate={() => {}} onOpenEdit={() => {}} onCloseForm={() => {}} onSubmitForm={() => {}} onTransition={() => {}} onRetry={() => {}}/></I18nProvider>);
  expect(screen.getByRole("link", { name: "Back" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Configure your assistant" })).toBeTruthy();
});

test("presents a draft as pending review and keeps the ready transition as the primary action", () => {
  const onTransition = vi.fn();
  vi.spyOn(atlasApi, "getDefaultAssistant").mockResolvedValue({ companyId: 1, assistantProfileId: "other-assistant", version: 1, assignedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", assignedByActorId: null, source: null });
  render(<I18nProvider><AssistantProfilesPanel csrf="csrf" workspaceId="workspace-1" workspaceRole={null} capabilities={["company:manage"]} companyId={1} companyName={null} companySelected profiles={[draftProfile]} selectedProfile={draftProfile} transientArchivedProfile={null} loading={false} error={false} formMode="closed" submitting={false} transitionTarget={null} onSelectProfile={() => {}} onOpenCreate={() => {}} onOpenEdit={() => {}} onCloseForm={() => {}} onSubmitForm={() => {}} onTransition={onTransition} onRetry={() => {}}/></I18nProvider>);
  expect(screen.getByText("Pending review")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review and finish" }));
  expect(screen.getByRole("heading", { name: "Review your assistant configuration" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Set as default" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm and make ready" }));
  expect(onTransition).toHaveBeenCalledWith(draftProfile, "ready");
});

test("makes General the current accessible section and keeps read-only customers out of mutation controls", () => {
  vi.spyOn(atlasApi, "getDefaultAssistant").mockResolvedValue({ companyId: 1, assistantProfileId: "assistant-1", version: 1, assignedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", assignedByActorId: null, source: null });
  const navigate = vi.fn();
  render(<I18nProvider><AssistantProfilesPanel csrf="csrf" workspaceId="workspace-1" workspaceRole={null} capabilities={["company:read"]} companyId={1} companyName={null} companySelected profiles={[draftProfile]} selectedProfile={draftProfile} transientArchivedProfile={null} loading={false} error={false} formMode="closed" submitting={false} transitionTarget={null} activeSection="general" onNavigate={navigate} onSelectProfile={() => {}} onOpenCreate={() => {}} onOpenEdit={() => {}} onCloseForm={() => {}} onSubmitForm={() => {}} onTransition={() => {}} onRetry={() => {}}/></I18nProvider>);
  expect(screen.getByRole("link", { name: "General" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "Behavior" })).toBeTruthy();
  expect(screen.getAllByText("Sales").length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Set as default" })).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Behavior" }));
  expect(navigate).toHaveBeenCalledWith("/companies/1/assistant/assistant-1/behavior");
});

test("shows behavior fields without general fields and requires archive confirmation", () => {
  const onTransition = vi.fn();
  vi.spyOn(atlasApi, "getDefaultAssistant").mockResolvedValue({ companyId: 1, assistantProfileId: "other", version: 1, assignedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", assignedByActorId: null, source: null });
  render(<I18nProvider><AssistantProfilesPanel csrf="csrf" workspaceId="workspace-1" workspaceRole={null} capabilities={["company:manage"]} companyId={1} companyName={null} companySelected profiles={[{ ...draftProfile, status: "ready" }]} selectedProfile={{ ...draftProfile, status: "ready" }} transientArchivedProfile={null} loading={false} error={false} formMode="closed" submitting={false} transitionTarget={null} activeSection="behavior" onSelectProfile={() => {}} onOpenCreate={() => {}} onOpenEdit={() => {}} onCloseForm={() => {}} onSubmitForm={() => {}} onTransition={onTransition} onRetry={() => {}}/></I18nProvider>);
  expect(screen.getByText("Response tone")).toBeTruthy();
  expect(screen.getByText("Welcome message")).toBeTruthy();
  expect(screen.queryByText("Assistant role")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  expect(onTransition).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(onTransition).toHaveBeenCalledWith(expect.objectContaining({ id: "assistant-1" }), "archived");
});

test("uses only the confirmed default assignment and disables duplicate default actions", async () => {
  let resolveDefault!: (value: { companyId:number; assistantProfileId:string; version:number; assignedAt:string; updatedAt:string; assignedByActorId:null; source:null }) => void;
  const pending = new Promise<{ companyId:number; assistantProfileId:string; version:number; assignedAt:string; updatedAt:string; assignedByActorId:null; source:null }>((resolve) => { resolveDefault = resolve; });
  vi.spyOn(atlasApi, "getDefaultAssistant").mockResolvedValueOnce({ companyId: 1, assistantProfileId: "other", version: 1, assignedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", assignedByActorId: null, source: null });
  vi.spyOn(atlasApi, "setDefaultAssistant").mockReturnValueOnce(pending);
  render(<I18nProvider><AssistantProfilesPanel csrf="csrf" workspaceId="workspace-1" workspaceRole={null} capabilities={["company:manage"]} companyId={1} companyName={null} companySelected profiles={[{ ...draftProfile, status: "ready" }]} selectedProfile={{ ...draftProfile, status: "ready" }} transientArchivedProfile={null} loading={false} error={false} formMode="closed" submitting={false} transitionTarget={null} activeSection="general" onSelectProfile={() => {}} onOpenCreate={() => {}} onOpenEdit={() => {}} onCloseForm={() => {}} onSubmitForm={() => {}} onTransition={() => {}} onRetry={() => {}}/></I18nProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Set as default" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Set as default" }));
  expect(screen.getByRole("button", { name: "Updating…" }).hasAttribute("disabled")).toBe(true);
  resolveDefault({ companyId: 1, assistantProfileId: "assistant-1", version: 2, assignedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", assignedByActorId: null, source: null });
  await screen.findByText("Default Assistant");
});

test("refetches the canonical default after a default assignment conflict", async () => {
  const assignment = { companyId: 1, assistantProfileId: "assistant-1", version: 2, assignedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", assignedByActorId: null, source: null } as const;
  const getDefault = vi.spyOn(atlasApi, "getDefaultAssistant").mockResolvedValueOnce({ ...assignment, assistantProfileId: "other", version: 1 }).mockResolvedValueOnce(assignment);
  vi.spyOn(atlasApi, "setDefaultAssistant").mockRejectedValue(new ApiError(409, "conflict"));
  render(<I18nProvider><AssistantProfilesPanel csrf="csrf" workspaceId="workspace-1" workspaceRole={null} capabilities={["company:manage"]} companyId={1} companyName={null} companySelected profiles={[{ ...draftProfile, status: "ready" }]} selectedProfile={{ ...draftProfile, status: "ready" }} transientArchivedProfile={null} loading={false} error={false} formMode="closed" submitting={false} transitionTarget={null} activeSection="general" onSelectProfile={() => {}} onOpenCreate={() => {}} onOpenEdit={() => {}} onCloseForm={() => {}} onSubmitForm={() => {}} onTransition={() => {}} onRetry={() => {}}/></I18nProvider>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Set as default" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Set as default" }));
  await screen.findByText("Default Assistant");
  expect(getDefault).toHaveBeenCalledTimes(2);
});
