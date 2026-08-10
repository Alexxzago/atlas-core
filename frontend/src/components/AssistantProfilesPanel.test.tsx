// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { atlasApi } from "../api/atlasApi";
import { AssistantProfilesPanel } from "./AssistantProfilesPanel";

const draftProfile = { id: "assistant-1", name: "Atlas Assistant", description: null, businessRole: "Sales", objective: "Help customers", audience: null, tone: "professional" as const, assistantLanguage: "en" as const, welcomeMessage: "Hello", fallbackMessage: "Please contact a person.", status: "draft" as const, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null };

test("guides a first-time user to configure an assistant without profile terminology", () => {
  const openCreate = vi.fn();
  render(<I18nProvider><AssistantProfilesPanel csrf="csrf" workspaceId={null} workspaceRole={null} capabilities={[]} companyId={null} companyName={null} companySelected profiles={[]} selectedProfile={null} transientArchivedProfile={null} loading={false} error={false} formMode="closed" submitting={false} transitionTarget={null} onSelectProfile={() => {}} onOpenCreate={openCreate} onOpenEdit={() => {}} onCloseForm={() => {}} onSubmitForm={() => {}} onTransition={() => {}} onRetry={() => {}}/></I18nProvider>);
  expect(screen.getByText("Assistant configuration")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Configure how your assistant will work" })).toBeTruthy();
  expect(screen.getByText("Role and goal")).toBeTruthy();
  expect(screen.getByText("How it should respond")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Configure assistant" }));
  expect(openCreate).toHaveBeenCalledTimes(1);
});

test("uses the concise back action while configuring an assistant", () => {
  render(<I18nProvider><AssistantProfilesPanel csrf="csrf" workspaceId={null} workspaceRole={null} capabilities={[]} companyId={null} companyName={null} companySelected profiles={[]} selectedProfile={null} transientArchivedProfile={null} loading={false} error={false} formMode="create" submitting={false} transitionTarget={null} onSelectProfile={() => {}} onOpenCreate={() => {}} onOpenEdit={() => {}} onCloseForm={() => {}} onSubmitForm={() => {}} onTransition={() => {}} onRetry={() => {}}/></I18nProvider>);
  expect(screen.getByRole("link", { name: "Back" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Configure your assistant" })).toBeTruthy();
});

test("presents a draft as pending review and keeps the ready transition as the primary action", () => {
  const onTransition = vi.fn();
  vi.spyOn(atlasApi, "getDefaultAssistant").mockResolvedValue({ companyId: 1, assistantProfileId: "other-assistant", version: 1, assignedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", assignedByActorId: null, source: null });
  render(<I18nProvider><AssistantProfilesPanel csrf="csrf" workspaceId="workspace-1" workspaceRole={null} capabilities={[]} companyId={1} companyName={null} companySelected profiles={[draftProfile]} selectedProfile={draftProfile} transientArchivedProfile={null} loading={false} error={false} formMode="closed" submitting={false} transitionTarget={null} onSelectProfile={() => {}} onOpenCreate={() => {}} onOpenEdit={() => {}} onCloseForm={() => {}} onSubmitForm={() => {}} onTransition={onTransition} onRetry={() => {}}/></I18nProvider>);
  expect(screen.getByText("Pending review")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Review and finish" }));
  expect(screen.getByRole("heading", { name: "Review your assistant configuration" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Set as default" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm and make ready" }));
  expect(onTransition).toHaveBeenCalledWith(draftProfile, "ready");
});
