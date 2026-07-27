// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AssistantProfile, WebChatConnection } from "../types/api";
import { WebChatConnectionsPanel } from "./WebChatConnectionsPanel";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const profile: AssistantProfile = { id: "asp_0123456789abcdef0123456789abcdef", name: "Website Assistant", description: null, businessRole: null, objective: null, audience: null, tone: "friendly", assistantLanguage: "en", welcomeMessage: null, fallbackMessage: "Fallback", status: "ready", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null };
const connection: WebChatConnection = { id: "wcc_0123456789abcdef0123456789abcdef", publicId: "wcp_0123456789abcdef0123456789abcdef", assistantProfileId: profile.id, status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

function renderPanel(overrides: Partial<React.ComponentProps<typeof WebChatConnectionsPanel>> = {}) {
  return render(<WebChatConnectionsPanel csrf="csrf" workspaceId="wsp" companyId={1} companyStatus="ready" profiles={[profile]} capabilities={["company:read", "company:manage"]} {...overrides}/>);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("WebChatConnectionsPanel", () => {
  it("shows the empty state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json([])));
    renderPanel();
    expect(await screen.findByText("No Web Chat Connections yet")).toBeTruthy();
  });

  it("renders connections and their dynamic public URLs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json([connection])));
    renderPanel();
    expect(await screen.findByText(connection.publicId)).toBeTruthy();
    expect(screen.getAllByText("Website Assistant")).toHaveLength(2);
    expect(screen.getByText(`${window.location.origin}/chat/${connection.publicId}`)).toBeTruthy();
  });

  it("changes selection without creating a connection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json([])); vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    await screen.findByText("No Web Chat Connections yet"); fireEvent.change(screen.getByRole("combobox"), { target: { value: profile.id } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates a connection exactly once after an explicit click and refreshes the list", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json([])).mockResolvedValueOnce(json(connection, 201)).mockResolvedValueOnce(json([connection])); vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    await screen.findByText("No Web Chat Connections yet"); fireEvent.change(screen.getByRole("combobox"), { target: { value: profile.id } }); fireEvent.click(screen.getByRole("button", { name: "Crear conexión" }));
    await screen.findByText(connection.publicId);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/workspaces/wsp/companies/1/web-chat-connections");
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({ assistantProfileId: profile.id });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/workspaces/wsp/companies/1/web-chat-connections");
  });

  it("prevents duplicate creation while a request is pending and disables an empty selection", async () => {
    let resolve!: (response: Response) => void; const pending = new Promise<Response>((done) => { resolve = done; }); const fetchMock = vi.fn().mockResolvedValueOnce(json([])).mockReturnValueOnce(pending).mockResolvedValueOnce(json([connection])); vi.stubGlobal("fetch", fetchMock);
    renderPanel(); await screen.findByText("No Web Chat Connections yet"); const create = screen.getByRole("button", { name: "Crear conexión" }) as HTMLButtonElement; expect(create.disabled).toBe(true); fireEvent.change(screen.getByRole("combobox"), { target: { value: profile.id } }); fireEvent.click(create); fireEvent.click(create); expect(fetchMock).toHaveBeenCalledTimes(2); resolve(json(connection, 201)); await screen.findByText(connection.publicId);
  });

  it("wires copy, open, and lifecycle actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined); Object.assign(navigator, { clipboard: { writeText } }); const open = vi.spyOn(window, "open").mockReturnValue(null); const fetchMock = vi.fn().mockResolvedValueOnce(json([connection])).mockResolvedValueOnce(json({ ...connection, status: "inactive" })); vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    await screen.findByText(connection.publicId); fireEvent.click(screen.getByRole("button", { name: "Copy URL" })); await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/chat/${connection.publicId}`)); fireEvent.click(screen.getByRole("button", { name: "Open Chat" })); expect(open).toHaveBeenCalledWith(`${window.location.origin}/chat/${connection.publicId}`, "_blank", "noopener,noreferrer"); fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await screen.findByRole("button", { name: "Activate" });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/workspaces/wsp/companies/1/web-chat-connections/${connection.id}`);
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({ status: "inactive" });
  });

  it("renders backend errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "Assistant Profile is not executable." }, 409)));
    const fetchMock = vi.fn().mockResolvedValueOnce(json([])).mockResolvedValueOnce(json({ error: "Assistant Profile is not executable." }, 409)); vi.stubGlobal("fetch", fetchMock);
    renderPanel(); await screen.findByText("No Web Chat Connections yet"); fireEvent.change(screen.getByRole("combobox"), { target: { value: profile.id } }); fireEvent.click(screen.getByRole("button", { name: "Crear conexión" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Assistant Profile is not executable.");
  });

  it("blocks creation for a Company that is not ready", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json([])); vi.stubGlobal("fetch", fetchMock);
    renderPanel({ companyStatus: "processing" }); await screen.findByText("No Web Chat Connections yet"); fireEvent.change(screen.getByRole("combobox"), { target: { value: profile.id } });
    expect((screen.getByRole("button", { name: "Crear conexión" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("La empresa todavía no está lista. Incorporá y publicá conocimiento antes de crear una conexión de chat.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
