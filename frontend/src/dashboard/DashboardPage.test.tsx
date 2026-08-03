// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { AppShell } from "../components/AppShell";
import { I18nProvider } from "../i18n/I18nContext";
import { ThemeProvider } from "../design-system/theme";
import { buildDashboardViewModel } from "./dashboardPresentation";
import { DashboardPage } from "./DashboardPage";

const workspace = { id: "workspace", name: "Workspace", role: "owner", capabilities: [] };
const company = { id: 1, name: "Company One", website: "", phone: "", email: "", status: "ready" as const, createdAt: "2026-01-01T00:00:00.000Z" };

afterEach(() => { cleanup(); window.localStorage.clear(); });

test("renders a localized operational dashboard with one page heading and widget headings", () => {
  const navigate: string[] = [];
  render(<I18nProvider><DashboardPage model={buildDashboardViewModel(workspace, [company], company)} onNavigate={(destination) => navigate.push(destination)} /></I18nProvider>);
  expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 2, name: "Company overview" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 2, name: "Connection status" })).toBeTruthy();
  expect(screen.getByText("No recent activity has been recorded yet.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(navigate).toEqual(["/companies/1/channels/whatsapp"]);
});

test("uses translated new-customer guidance and localized skeleton announcements", () => {
  window.localStorage.setItem("atlas.locale", "es");
  const model = buildDashboardViewModel(workspace, [], null);
  render(<I18nProvider><DashboardPage model={model} onNavigate={() => {}} /> </I18nProvider>);
  expect(screen.getByRole("heading", { level: 1, name: "Panel" })).toBeTruthy();
  expect(screen.getByText("Crear una empresa")).toBeTruthy();
  cleanup();
  render(<I18nProvider><DashboardPage model={model} state="loading" onNavigate={() => {}} /></I18nProvider>);
  expect(screen.getAllByText("Cargando el panel…").length).toBeGreaterThan(0);
});

test("composes inside the existing application shell", () => {
  render(<ThemeProvider><I18nProvider><AppShell route={{ name: "dashboard" }} workspace={workspace} workspaces={[workspace]} companies={[company]} selectedCompany={company} email="operator@example.test" onNavigate={() => {}} onSelectWorkspace={() => {}} onSelectCompany={() => {}} onPassword={() => {}} onLogout={() => {}}><DashboardPage model={buildDashboardViewModel(workspace, [company], company)} onNavigate={() => {}} /></AppShell></I18nProvider></ThemeProvider>);
  expect(screen.getByRole("main").querySelector(".dashboard-grid")).toBeTruthy();
  expect(screen.getByLabelText("Current Workspace")).toBeTruthy();
  expect(screen.getByLabelText("Current company")).toBeTruthy();
});
