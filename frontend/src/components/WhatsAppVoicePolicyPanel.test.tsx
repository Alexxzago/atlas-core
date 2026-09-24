// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { WhatsAppVoicePolicyPanel } from "./WhatsAppVoicePolicyPanel";

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const policy = (overrides: Partial<{ voiceAiEnabled: boolean; audioResponseMode: "text_only" | "voice_with_text_fallback"; version: number }> = {}) => ({ voiceAiEnabled: false, audioResponseMode: "text_only" as const, version: 1, ...overrides });
const renderPanel = (props: Partial<React.ComponentProps<typeof WhatsAppVoicePolicyPanel>> = {}) => render(<I18nProvider><WhatsAppVoicePolicyPanel csrf="csrf" workspaceId="wsp" companyId={1} connectionId="wac_a" manageable {...props}/></I18nProvider>);

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("renders the durable Voice policy, preserves mode while disabled, and keeps read-only users from saving", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(policy())));
  renderPanel({ manageable: false });
  expect(await screen.findByRole("heading", { name: "Voice AI" })).toBeTruthy();
  expect((screen.getByRole("checkbox", { name: "Use Voice AI for audio messages" }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole("radio", { name: "Reply with text" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("radio", { name: "Reply with text" }) as HTMLInputElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Save preference" })).toBeNull();
  expect(document.querySelector(".whatsapp-voice-policy")).toBeTruthy();
});

it("saves only a dirty policy with the server version and bounds duplicate clicks", async () => {
  let resolve!: (response: Response) => void;
  const deferred = new Promise<Response>((done) => { resolve = done; });
  const fetchMock = vi.fn().mockResolvedValueOnce(json(policy())).mockReturnValueOnce(deferred);
  vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "op-one") });
  renderPanel(); await screen.findByRole("heading", { name: "Voice AI" });
  expect((screen.getByRole("button", { name: "Save preference" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Use Voice AI for audio messages" }));
  fireEvent.click(screen.getByRole("radio", { name: "Reply with audio and use text if it fails" }));
  fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
  fireEvent.click(screen.getByRole("button", { name: "Saving preference…" }));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ operationId: "op-one", expectedVersion: 1, voiceAiEnabled: true, audioResponseMode: "voice_with_text_fallback" });
  resolve(json(policy({ voiceAiEnabled: true, audioResponseMode: "voice_with_text_fallback", version: 2 })));
  expect((await screen.findByRole("status")).textContent).toContain("Voice AI preference was saved.");
});

it("reuses an operation id after an ambiguous failure and creates a new one after a draft change", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(json(policy())).mockResolvedValueOnce(json({ error: "temporary" }, 500)).mockResolvedValueOnce(json(policy({ voiceAiEnabled: true, version: 2 }))).mockResolvedValueOnce(json(policy({ voiceAiEnabled: true, audioResponseMode: "voice_with_text_fallback", version: 3 })));
  vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce("op-one").mockReturnValueOnce("op-two") });
  renderPanel(); await screen.findByRole("heading", { name: "Voice AI" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Use Voice AI for audio messages" })); fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
  await screen.findByRole("alert"); fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
  await screen.findByRole("status");
  expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).operationId).toBe("op-one"); expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).operationId).toBe("op-one");
  fireEvent.click(screen.getByRole("radio", { name: "Reply with audio and use text if it fails" })); fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
  await screen.findByText("Voice AI preference was saved."); expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)).operationId).toBe("op-two");
});

it("refetches a stale policy without overwriting the draft and saves against the new version", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(json(policy())).mockResolvedValueOnce(json({ error: "changed" }, 409)).mockResolvedValueOnce(json(policy({ version: 2 }))).mockResolvedValueOnce(json(policy({ voiceAiEnabled: true, version: 3 })));
  vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce("op-stale").mockReturnValueOnce("op-current") });
  renderPanel(); await screen.findByRole("heading", { name: "Voice AI" }); fireEvent.click(screen.getByRole("checkbox", { name: "Use Voice AI for audio messages" })); fireEvent.click(screen.getByRole("button", { name: "Save preference" }));
  expect((await screen.findByRole("alert")).textContent).toContain("The configuration changed"); await waitFor(() => expect(screen.getByRole("button", { name: "Save preference" })).toBeTruthy());
  expect((screen.getByRole("checkbox", { name: "Use Voice AI for audio messages" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save preference" })); await screen.findByText("Voice AI preference was saved.");
  expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ operationId: "op-stale", expectedVersion: 1 });
  expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toMatchObject({ operationId: "op-current", expectedVersion: 2 });
});

it("keeps obsolete connection reads from replacing the selected connection", async () => {
  let resolveFirst!: (response: Response) => void;
  const first = new Promise<Response>((done) => { resolveFirst = done; });
  const fetchMock = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(json(policy({ voiceAiEnabled: true, version: 4 })));
  vi.stubGlobal("fetch", fetchMock);
  const view = renderPanel(); view.rerender(<I18nProvider><WhatsAppVoicePolicyPanel csrf="csrf" workspaceId="wsp" companyId={1} connectionId="wac_b" manageable/></I18nProvider>);
  expect((await screen.findByRole("checkbox", { name: "Use Voice AI for audio messages" }) as HTMLInputElement).checked).toBe(true);
  resolveFirst(json(policy())); await waitFor(() => expect((screen.getByRole("checkbox", { name: "Use Voice AI for audio messages" }) as HTMLInputElement).checked).toBe(true));
});

it("maps validation, non-disclosing, size, and server failures to a neutral recoverable error", async () => {
  for (const status of [400, 404, 413, 500]) {
    cleanup(); vi.restoreAllMocks(); const fetchMock = vi.fn().mockResolvedValueOnce(json(policy())).mockResolvedValueOnce(json({ error: { code: status === 413 ? "knowledge_input_too_large" : "validation_failed", message: "private" } }, status)); vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("crypto", { randomUUID: vi.fn(() => `op-${status}`) });
    renderPanel(); await screen.findByRole("heading", { name: "Voice AI" }); fireEvent.click(screen.getByRole("checkbox", { name: "Use Voice AI for audio messages" })); fireEvent.click(screen.getByRole("button", { name: "Save preference" })); expect((await screen.findByRole("alert")).textContent).toContain("could not save");
  }
});
