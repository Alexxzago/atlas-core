// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { ThemeProvider } from "../design-system/theme";
import { AppShell } from "./AppShell";

afterEach(cleanup);

test("provides an accessible shell navigation and skip link", () => {
  const navigate = (path: string): void => { window.history.pushState({}, "", path); };
  render(<ThemeProvider><I18nProvider><AppShell route={{ name: "dashboard" }} workspace={null} workspaces={[]} companies={[]} selectedCompany={null} email="operator@example.test" onNavigate={navigate} onSelectWorkspace={() => {}} onSelectCompany={() => {}} onPassword={() => {}} onLogout={() => {}}><h1>Content</h1></AppShell></I18nProvider></ThemeProvider>);
  expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe("#main-content");
  expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Companies" }));
  expect(window.location.pathname).toBe("/companies");
});

test("keeps the closed drawer out of the keyboard flow and restores focus after Escape", async () => {
  render(<ThemeProvider><I18nProvider><AppShell route={{ name: "dashboard" }} workspace={null} workspaces={[]} companies={[]} selectedCompany={null} email="operator@example.test" onNavigate={() => {}} onSelectWorkspace={() => {}} onSelectCompany={() => {}} onPassword={() => {}} onLogout={() => {}}><h1>Content</h1></AppShell></I18nProvider></ThemeProvider>);
  const trigger = screen.getByRole("button", { name: "Open navigation" });
  expect(screen.queryByRole("complementary", { name: "Mobile navigation" })).toBeNull();
  fireEvent.click(trigger);
  const drawer = screen.getByRole("complementary", { name: "Mobile navigation" });
  const close = within(drawer).getByRole("button", { name: "Close navigation" });
  expect(document.activeElement).toBe(close);
  expect(document.body.style.overflow).toBe("hidden");
  const drawerButtons = within(drawer).getAllByRole("button");
  const last = drawerButtons[drawerButtons.length - 1]!;
  last.focus();
  fireEvent.keyDown(window, { key: "Tab" });
  expect(document.activeElement).toBe(close);
  close.focus();
  fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("complementary", { name: "Mobile navigation" })).toBeNull();
  expect(document.body.style.overflow).toBe("");
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

test("keeps the localized company switcher available in shell context", () => {
  const selected: number[] = [];
  render(<ThemeProvider><I18nProvider><AppShell route={{ name: "company-overview", companyId: 2 }} workspace={{ id: "workspace", name: "Workspace", role: "owner", capabilities: [] }} workspaces={[{ id: "workspace", name: "Workspace", role: "owner", capabilities: [] }]} companies={[{ id: 2, name: "Company Two", website: "", phone: "", email: "", status: "ready", createdAt: "" }]} selectedCompany={{ id: 2, name: "Company Two", website: "", phone: "", email: "", status: "ready", createdAt: "" }} email="operator@example.test" onNavigate={() => {}} onSelectWorkspace={() => {}} onSelectCompany={(id) => selected.push(id)} onPassword={() => {}} onLogout={() => {}}><h1>Content</h1></AppShell></I18nProvider></ThemeProvider>);
  const company = screen.getByLabelText("Current company");
  expect(company).toBeTruthy();
  fireEvent.change(company, { target: { value: "2" } });
  expect(selected).toEqual([2]);
});
