// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { buildCompanyWorkspaceViewModel } from "./dashboardPresentation";
import { DashboardPage } from "./DashboardPage";

const workspace = { id: "workspace", name: "Workspace", role: "owner", capabilities: [] };
const company = { id: 1, name: "Company One", website: "", phone: "", email: "", status: "ready" as const, createdAt: "2026-01-01T00:00:00.000Z" };
afterEach(() => { cleanup(); window.localStorage.clear(); });

test("renders Today with one primary next action and compact evidence", () => {
  const navigate: string[] = [];
  const model = buildCompanyWorkspaceViewModel({ workspace, companies: [company], company, snapshot: { readiness: { assistantIdentifier: "default", workspaceId: 1, companyId: 1, status: "ready", blockers: [], knowledgeVersionId: "knowledge", assistantProfileId: "assistant", evaluatedAt: "2026-01-01T00:00:00.000Z", policyVersion: "1", configurationDigest: "digest" }, webChatConnections: 0, whatsAppConnections: 0, operationalWebChatConnections: 0, operationalWhatsAppConnections: 0 } });
  const { container } = render(<I18nProvider><DashboardPage model={model} onNavigate={(path) => navigate.push(path)}/></I18nProvider>);
  expect(screen.getByRole("heading", { level: 1, name: "Today" })).toBeTruthy();
  expect(screen.getByText("Atlas for Company One")).toBeTruthy();
  expect(container.querySelector(".dashboard-grid")).toBeNull();
  expect(container.querySelectorAll(".button--primary")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Choose a place to work" }));
  expect(navigate).toEqual(["/companies/1/channels"]);
});

test("localizes the first-company experience in Spanish", () => {
  window.localStorage.setItem("atlas.locale", "es");
  render(<I18nProvider><DashboardPage model={buildCompanyWorkspaceViewModel({ workspace, companies: [], company: null })} onNavigate={() => {}} onChooseCompany={() => {}}/></I18nProvider>);
  expect(screen.getByRole("heading", { name: "Enseñale a Atlas para quién trabaja" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Crear mi primera empresa" })).toBeTruthy();
});

test("uses assistant configuration copy for the first readiness blocker", () => {
  window.localStorage.setItem("atlas.locale", "es");
  const model = buildCompanyWorkspaceViewModel({ workspace, companies: [company], company, snapshot: { readiness: { assistantIdentifier: "default", workspaceId: 1, companyId: 1, status: "blocked", blockers: ["default_assistant_missing"], knowledgeVersionId: null, assistantProfileId: null, evaluatedAt: "2026-01-01T00:00:00.000Z", policyVersion: "1", configurationDigest: "digest" }, webChatConnections: 0, whatsAppConnections: 0, operationalWebChatConnections: 0, operationalWhatsAppConnections: 0 } });
  render(<I18nProvider><DashboardPage model={model} onNavigate={() => {}}/></I18nProvider>);
  expect(screen.getByText("Empecemos a configurar tu asistente.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Configurar asistente" })).toBeTruthy();
  expect(screen.queryByText("Preparar un Atlas")).toBeNull();
});
