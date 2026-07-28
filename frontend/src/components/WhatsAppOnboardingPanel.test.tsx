// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../i18n/I18nContext";
import type { AssistantProfile, WhatsAppConnectionOperationalStatus } from "../types/api";
import { WhatsAppOnboardingPanel } from "./WhatsAppOnboardingPanel";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const profile: AssistantProfile = { id: "asp_0123456789abcdef0123456789abcdef", name: "Sales Assistant", description: null, businessRole: null, objective: null, audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: null, fallbackMessage: "Fallback", status: "ready", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null };
const status = (validationState: WhatsAppConnectionOperationalStatus["validationState"]): WhatsAppConnectionOperationalStatus => ({ connection: { id: "wac_0123456789abcdef0123456789abcdef", assistantProfileId: profile.id, phoneNumberId: "123", whatsappBusinessAccountId: "456", status: "inactive", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, credentialsConfigured: true, validationState, validatedAt: validationState === "not_validated" ? null : "2026-01-01T00:00:00.000Z", validationFailureCode: null, healthState: validationState === "valid" ? "healthy" : "inactive", lastProviderActivityAt: null, lastWebhookActivityAt: null, healthFailureCode: null, updatedAt: "2026-01-01T00:00:00.000Z" });

function renderPanel() { return render(<I18nProvider><WhatsAppOnboardingPanel csrf="csrf" workspaceId="wsp" companyId={1} companyStatus="ready" profiles={[profile]} capabilities={["company:read", "company:manage"]}/></I18nProvider>); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("WhatsAppOnboardingPanel", () => {
  it("keeps activation disabled until the connection validation is valid", async () => {
    const initial = status("not_validated");
    const fetchMock = vi.fn().mockResolvedValueOnce(json([initial.connection])).mockResolvedValueOnce(json(initial)).mockResolvedValueOnce(json(status("valid")));
    vi.stubGlobal("fetch", fetchMock); renderPanel();
    await screen.findByRole("option", { name: "123" }); fireEvent.change(screen.getByRole("combobox", { name: "WhatsApp connection" }), { target: { value: initial.connection.id } });
    const activate = await screen.findByRole("button", { name: "Activate WhatsApp" }) as HTMLButtonElement;
    expect(activate.disabled).toBe(true); fireEvent.click(screen.getByRole("button", { name: "Validate credentials" }));
    await waitFor(() => expect(activate.disabled).toBe(false));
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`/api/workspaces/wsp/companies/1/whatsapp-connections/${initial.connection.id}/validation`);
  });
});
