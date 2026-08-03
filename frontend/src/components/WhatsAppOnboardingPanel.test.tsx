// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../i18n/I18nContext";
import type { AssistantProfile, WhatsAppConnectionOperationalStatus } from "../types/api";
import { WhatsAppOnboardingPanel } from "./WhatsAppOnboardingPanel";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const profile: AssistantProfile = { id: "asp_0123456789abcdef0123456789abcdef", name: "Sales Assistant", description: null, businessRole: null, objective: null, audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: null, fallbackMessage: "Fallback", status: "ready", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null };
const status = (validationState: WhatsAppConnectionOperationalStatus["validationState"]): WhatsAppConnectionOperationalStatus => ({ connection: { id: "wac_0123456789abcdef0123456789abcdef", assistantProfileId: profile.id, phoneNumberId: "123", whatsappBusinessAccountId: "456", status: "inactive", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, credentialsConfigured: true, validationState, validatedAt: validationState === "not_validated" ? null : "2026-01-01T00:00:00.000Z", validationFailureCode: null, healthState: validationState === "valid" ? "healthy" : "inactive", lastProviderActivityAt: null, lastWebhookActivityAt: null, healthFailureCode: null, updatedAt: "2026-01-01T00:00:00.000Z" });
const readiness = (state: "ready" | "blocked") => ({ assistantIdentifier: "default" as const, workspaceId: 1, companyId: 1, status: state, blockers: state === "ready" ? [] : ["whatsapp_validation_missing"], knowledgeVersionId: "kver", assistantProfileId: profile.id, evaluatedAt: "2026-01-01T00:00:00.000Z", policyVersion: "assistant-readiness-v1", configurationDigest: "digest" });

function renderPanel() { return render(<I18nProvider><WhatsAppOnboardingPanel csrf="csrf" workspaceId="wsp" companyId={1} companyStatus="ready" profiles={[profile]} capabilities={["company:read", "company:manage"]}/></I18nProvider>); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("WhatsAppOnboardingPanel", () => {
  it("keeps activation disabled until the connection validation is valid", async () => {
    const initial = status("not_validated");
    const fetchMock = vi.fn().mockResolvedValueOnce(json([initial.connection])).mockResolvedValueOnce(json(readiness("blocked"))).mockResolvedValueOnce(json(initial)).mockResolvedValueOnce(json(status("valid"))).mockResolvedValueOnce(json(readiness("ready")));
    vi.stubGlobal("fetch", fetchMock); renderPanel();
    await screen.findByRole("option", { name: "123" }); fireEvent.change(screen.getByRole("combobox", { name: "WhatsApp connection" }), { target: { value: initial.connection.id } });
    const activate = await screen.findByRole("button", { name: "Activate WhatsApp" }) as HTMLButtonElement;
    expect(activate.disabled).toBe(true); fireEvent.click(screen.getByRole("button", { name: "Validate credentials" }));
    await waitFor(() => expect(activate.disabled).toBe(false));
    expect(fetchMock.mock.calls[3]?.[0]).toBe(`/api/workspaces/wsp/companies/1/whatsapp-connections/${initial.connection.id}/validation`);
  });

  it("enables activation immediately after validation even when the generic readiness response is blocked", async () => {
    const initial = status("not_validated");
    const fetchMock = vi.fn().mockResolvedValueOnce(json([initial.connection])).mockResolvedValueOnce(json(readiness("blocked"))).mockResolvedValueOnce(json(initial)).mockResolvedValueOnce(json(status("valid"))).mockResolvedValueOnce(json(readiness("blocked")));
    vi.stubGlobal("fetch", fetchMock); renderPanel();
    await screen.findByRole("option", { name: "123" }); fireEvent.change(screen.getByRole("combobox", { name: "WhatsApp connection" }), { target: { value: initial.connection.id } });
    fireEvent.click(await screen.findByRole("button", { name: "Validate credentials" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Activate WhatsApp" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("shows a validation error and keeps activation disabled when the provider returns an invalid outcome", async () => {
    const initial = status("not_validated"), invalid = { ...status("invalid"), validationFailureCode: "provider_unavailable", healthState: "degraded" as const };
    const fetchMock = vi.fn().mockResolvedValueOnce(json([initial.connection])).mockResolvedValueOnce(json(readiness("blocked"))).mockResolvedValueOnce(json(initial)).mockResolvedValueOnce(json(invalid)).mockResolvedValueOnce(json(readiness("blocked")));
    vi.stubGlobal("fetch", fetchMock); renderPanel();
    await screen.findByRole("option", { name: "123" }); fireEvent.change(screen.getByRole("combobox", { name: "WhatsApp connection" }), { target: { value: initial.connection.id } });
    fireEvent.click(await screen.findByRole("button", { name: "Validate credentials" }));
    expect((await screen.findByRole("alert")).textContent).toContain("temporarily unavailable"); expect((screen.getByRole("button", { name: "Activate WhatsApp" }) as HTMLButtonElement).disabled).toBe(true); expect(screen.queryByText("Credentials validated.")).toBeNull();
  });
});
