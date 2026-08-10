// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { ThemeProvider } from "../design-system/theme";
import { AppShell } from "./AppShell";

const workspace = { id: "workspace", name: "North workspace", role: "owner", capabilities: [] };
const company = { id: 2, name: "Company Two", website: "", phone: "", email: "", status: "ready" as const, createdAt: "" };
const props = { route: { name: "company-overview", companyId: 2 } as const, workspace, workspaces: [workspace], companies: [company], selectedCompany: company, companiesLoading: false, companyError: false, companyCreating: false, companyTransitioning: false, email: "operator@example.test", onNavigate: vi.fn(), onSelectWorkspace: vi.fn(), onSelectCompany: vi.fn(), onCreateCompany: async () => false, onRetryCompanies: vi.fn(), onPassword: vi.fn(), onLogout: vi.fn() };
const view = (overrides = {}): React.JSX.Element => <ThemeProvider><I18nProvider><AppShell {...props} {...overrides}><h1>Content</h1></AppShell></I18nProvider></ThemeProvider>;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

test("uses responsibility navigation and omits Analytics from primary navigation", () => {
  render(view());
  expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe("#main-content");
  const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
  expect(within(navigation).getByRole("link", { name: "Today" })).toBeTruthy();
  expect(within(navigation).getByRole("link", { name: "Configure assistant" })).toBeTruthy();
  expect(within(navigation).queryByText("Analytics")).toBeNull();
});

test("opens one authoritative company chooser", () => {
  render(view());
  fireEvent.click(screen.getAllByRole("button", { name: /Company Two/ })[0]!);
  expect(screen.getByRole("dialog", { name: "Which company does Atlas work for?" })).toBeTruthy();
  expect(screen.getAllByText("Company Two").length).toBeGreaterThan(0);
});

test("keeps the mobile drawer outside the flow and restores focus on Escape", async () => {
  render(view());
  const trigger = screen.getByRole("button", { name: "Open navigation" });
  fireEvent.click(trigger);
  const drawer = screen.getByRole("complementary", { name: "Mobile navigation" });
  const close = within(drawer).getByRole("button", { name: "Close navigation" });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.queryByRole("complementary", { name: "Mobile navigation" })).toBeNull();
});

test("groups account actions, uses clear workspace copy, and restores focus on Escape", () => {
  window.localStorage.setItem("atlas.locale", "es");
  render(view());
  const trigger = screen.getAllByRole("button", { name: "Espacio y cuenta" })[0]!;
  fireEvent.click(trigger);
  expect(screen.getByText("Espacio y equipo")).toBeTruthy();
  expect(screen.queryByText("Cuidar el espacio")).toBeNull();
  expect(screen.getByText("Apariencia")).toBeTruthy();
  expect(screen.getByText("Cuenta")).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Espacio y cuenta" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test("exposes a persisted keyboard language menu in the account surface", async()=>{
  window.localStorage.setItem("atlas.locale", "en");render(view());fireEvent.click(screen.getAllByRole("button",{name:"Workspace and account"})[0]!);const language=screen.getByRole("button",{name:/English/});expect(language.getAttribute("aria-expanded")).toBe("false");fireEvent.click(language);const spanish=screen.getByRole("option",{name:"Español"});fireEvent.click(spanish);expect(window.localStorage.getItem("atlas.locale")).toBe("es");expect(screen.getByText("Apariencia")).toBeTruthy();await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole("button",{name:/Español/})));fireEvent.click(screen.getByRole("button",{name:/Español/}));fireEvent.keyDown(screen.getByRole("listbox",{name:/Idioma/}),{key:"Escape"});await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole("button",{name:/Español/})));expect(screen.queryByRole("listbox")).toBeNull();
});

test("keeps language control available from the mobile account trigger",()=>{
  window.localStorage.setItem("atlas.locale", "en");render(view());fireEvent.click(screen.getAllByRole("button",{name:"Workspace and account"})[1]!);expect(screen.getByRole("button",{name:/English/})).toBeTruthy();
});
