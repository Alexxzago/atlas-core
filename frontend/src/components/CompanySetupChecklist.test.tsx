// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import type { ActivationProjection, PilotReadiness } from "../types/api";
import { atlasApi } from "../api/atlasApi";
import { CompanySetupChecklist } from "./CompanySetupChecklist";

vi.mock("../api/atlasApi", () => ({ atlasApi: { getPilotReadiness: vi.fn(), getActivation: vi.fn() } }));

const workspace = { id: "workspace", name: "Workspace", role: "owner", capabilities: ["company:read", "company:manage"] as ("company:read" | "company:manage")[] };
const companyA = { id: 1, name: "Company A", website: null, phone: "", email: "", status: "ready" as const, createdAt: "2026-01-01T00:00:00.000Z" };
const companyB = { ...companyA, id: 2, name: "Company B" };
const ids = ["company", "knowledge", "assistant", "web_chat", "verification", "pilot_ready", "human_ops"] as const;
const actions = ["complete_company", "publish_knowledge", "configure_assistant", "activate_web_chat", "start_verification", "resolve_pilot_readiness", "review_human_operations"] as const;

function activation(nextAction: ActivationProjection["nextAction"] = "configure_assistant"): ActivationProjection { const current = actions.indexOf(nextAction); return { stages: ids.map((id, index) => ({ id, status: index < current ? "complete" : "incomplete", state: index < current ? "complete" : "incomplete", owner: index < current ? null : "customer", reasonCode: index === current && nextAction === "configure_assistant" ? "default_assistant_not_executable" : null, action: actions[index]!, actionPath: ["/companies/1", "/companies/1/knowledge", "/companies/1/assistant", "/companies/1/channels/web-chat", null, null, "/conversations"][index]! })), nextAction, evaluatedAt: "2026-01-01T00:00:00.000Z", policyVersion: "activation-projection-v1" }; }
function readiness(title: PilotReadiness["classification"] = "setup_incomplete"): PilotReadiness { return { overall: "not_ready", classification: title, checks: [], nextAction: "configure_assistant", evaluatedAt: "2026-01-01T00:00:00.000Z", policyVersion: "pilot-readiness-v1" }; }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason?: unknown) => void; const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; }); return { promise, resolve, reject }; }
function renderChecklist(company = companyA) { return render(<I18nProvider><CompanySetupChecklist csrf="csrf" workspace={workspace} companies={[companyA, companyB]} company={company} onNavigate={() => {}} onChooseCompany={() => {}} /></I18nProvider>); }

afterEach(() => { cleanup(); vi.clearAllMocks(); });

test("uses the full loading state only before the current company has a confirmed projection", async () => {
  const nextReadiness = deferred<PilotReadiness>(), nextActivation = deferred<ActivationProjection>();
  vi.mocked(atlasApi.getPilotReadiness).mockReturnValueOnce(nextReadiness.promise);
  vi.mocked(atlasApi.getActivation).mockReturnValueOnce(nextActivation.promise);
  renderChecklist();
  expect(screen.getByText("Verificando el estado de activación...")).toBeTruthy();
  nextReadiness.resolve(readiness()); nextActivation.resolve(activation());
  expect(await screen.findByRole("heading", { name: "Activá tu asistente" })).toBeTruthy();
});

test("keeps confirmed content during focus refresh, manual retry, and refresh failure", async () => {
  vi.mocked(atlasApi.getPilotReadiness).mockResolvedValueOnce(readiness());
  vi.mocked(atlasApi.getActivation).mockResolvedValueOnce(activation("resolve_pilot_readiness"));
  renderChecklist();
  await screen.findByRole("heading", { name: "Activá tu asistente" });
  const refreshReadiness = deferred<PilotReadiness>(), refreshActivation = deferred<ActivationProjection>();
  vi.mocked(atlasApi.getPilotReadiness).mockReturnValueOnce(refreshReadiness.promise);
  vi.mocked(atlasApi.getActivation).mockReturnValueOnce(refreshActivation.promise);
  fireEvent.focus(window);
  expect(screen.getByRole("heading", { name: "Activá tu asistente" })).toBeTruthy();
  expect(screen.queryByText("Verificando el estado de activación...")).toBeNull();
  expect(screen.getByText("Actualizando estado...")).toBeTruthy();
  refreshReadiness.reject(new Error("unavailable")); refreshActivation.reject(new Error("unavailable"));
  expect(await screen.findByText("No pudimos actualizar el estado. Conservamos la última verificación confirmada.")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Activá tu asistente" })).toBeTruthy();
  const retryReadiness = deferred<PilotReadiness>(), retryActivation = deferred<ActivationProjection>();
  vi.mocked(atlasApi.getPilotReadiness).mockReturnValueOnce(retryReadiness.promise);
  vi.mocked(atlasApi.getActivation).mockReturnValueOnce(retryActivation.promise);
  fireEvent.click(screen.getByRole("button", { name: "Actualizar estado del piloto" }));
  expect(screen.getByRole("heading", { name: "Activá tu asistente" })).toBeTruthy();
  retryReadiness.resolve(readiness()); retryActivation.resolve(activation("resolve_pilot_readiness"));
  await waitFor(() => expect(screen.queryByText("Actualizando estado...")).toBeNull());
});

test("hides the old company immediately and ignores its late response", async () => {
  vi.mocked(atlasApi.getPilotReadiness).mockResolvedValueOnce(readiness("setup_incomplete"));
  vi.mocked(atlasApi.getActivation).mockResolvedValueOnce(activation("configure_assistant"));
  const view = renderChecklist();
  await screen.findByRole("button", { name: "Configurar asistente" });
  const oldReadiness = deferred<PilotReadiness>(), oldActivation = deferred<ActivationProjection>(), nextReadiness = deferred<PilotReadiness>(), nextActivation = deferred<ActivationProjection>();
  vi.mocked(atlasApi.getPilotReadiness).mockReturnValueOnce(oldReadiness.promise).mockReturnValueOnce(nextReadiness.promise);
  vi.mocked(atlasApi.getActivation).mockReturnValueOnce(oldActivation.promise).mockReturnValueOnce(nextActivation.promise);
  fireEvent.focus(window);
  view.rerender(<I18nProvider><CompanySetupChecklist csrf="csrf" workspace={workspace} companies={[companyA, companyB]} company={companyB} onNavigate={() => {}} onChooseCompany={() => {}} /></I18nProvider>);
  expect(screen.getByText("Verificando el estado de activación...")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Configurar asistente" })).toBeNull();
  oldReadiness.resolve(readiness("pilot_ready")); oldActivation.resolve(activation("review_human_operations"));
  nextReadiness.resolve(readiness("configuration_ready")); nextActivation.resolve(activation("publish_knowledge"));
  expect(await screen.findByRole("button", { name: "Publicar conocimiento" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Abrir conversaciones" })).toBeNull();
});
