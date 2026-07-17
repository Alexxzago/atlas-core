// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n/I18nContext";
import type { AssistantProfile } from "../types/api";
import { AssistantPreviewPanel } from "./AssistantPreviewPanel";

interface DeferredResponse {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
  reject: (reason: unknown) => void;
}

const profile: AssistantProfile = {
  id: "assistant-1",
  name: "Atlas Assistant",
  description: null,
  businessRole: null,
  objective: null,
  audience: null,
  tone: "professional",
  assistantLanguage: "en",
  welcomeMessage: null,
  fallbackMessage: "Please contact a person.",
  status: "ready",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
};

function deferredResponse(): DeferredResponse {
  let resolve!: (response: Response) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Response>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof AssistantPreviewPanel>> = {}) {
  const props: React.ComponentProps<typeof AssistantPreviewPanel> = {
    csrf: "csrf-token",
    workspaceId: "workspace-1",
    companyId: 7,
    companyName: "Atlas Realty",
    profile,
    allowed: true,
    ...overrides,
  };
  const view = render(<I18nProvider><AssistantPreviewPanel {...props} /></I18nProvider>);
  return {
    ...view,
    rerenderPanel: (next: Partial<typeof props>) => view.rerender(
      <I18nProvider><AssistantPreviewPanel {...props} {...next} /></I18nProvider>,
    ),
  };
}

function submit(message = "What are your opening hours?"): void {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: message } });
  fireEvent.click(screen.getByRole("button", { name: "Preview response" }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("AssistantPreviewPanel", () => {
  it.each([
    ["Workspace", { workspaceId: "workspace-2" }],
    ["Company", { companyId: 8 }],
    ["Assistant", { profile: { ...profile, id: "assistant-2" } }],
  ])("aborts the real API request and clears pending state on %s change", async (_label, change) => {
    const pending = deferredResponse();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockReturnValueOnce(pending.promise);
    const view = renderPanel();
    submit();

    expect(screen.getByRole("status").textContent).toContain("preparing a response");
    const request = fetchMock.mock.calls[0];
    const signal = (request?.[1] as RequestInit).signal as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);

    view.rerenderPanel(change);

    expect(signal.aborted).toBe(true);
    expect(screen.queryByText(/preparing a response/i)).toBeNull();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("suppresses stale success and stale error responses after lifecycle changes", async () => {
    const staleSuccess = deferredResponse();
    const staleError = deferredResponse();
    vi.spyOn(globalThis, "fetch")
      .mockReturnValueOnce(staleSuccess.promise)
      .mockReturnValueOnce(staleError.promise);
    const view = renderPanel();

    submit("first request");
    view.rerenderPanel({ workspaceId: "workspace-2" });
    await act(async () => staleSuccess.resolve(response({ status: "answered", answer: "STALE SUCCESS" })));
    expect(screen.queryByText("STALE SUCCESS")).toBeNull();

    submit("second request");
    view.rerenderPanel({ companyId: 8 });
    await act(async () => staleError.resolve(response({ error: { code: "company_not_ready", message: "stale" } }, 409)));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("aborts on logout cleanup and when the Profile lifecycle leaves ready", () => {
    const first = deferredResponse();
    const second = deferredResponse();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const view = renderPanel();

    submit();
    const lifecycleSignal = (fetchMock.mock.calls[0]?.[1] as RequestInit).signal as AbortSignal;
    view.rerenderPanel({ profile: { ...profile, status: "disabled" } });
    expect(lifecycleSignal.aborted).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Mark the Profile ready");
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);

    view.rerenderPanel({ profile });
    submit("logout request");
    const logoutSignal = (fetchMock.mock.calls[1]?.[1] as RequestInit).signal as AbortSignal;
    view.unmount();
    expect(logoutSignal.aborted).toBe(true);
  });

  it("renders no Preview authority or controls for a Viewer", () => {
    const view = renderPanel({ allowed: false });
    expect(view.container.innerHTML).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("wires the API client, CSRF header, payload, and AbortController through the rendered form", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      response({ status: "answered", answer: "We open at nine." }),
    );
    renderPanel();
    submit("  What time do you open?  ");

    expect(screen.getByRole("button", { name: "Sending…" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("preparing a response");
    await screen.findByText("We open at nine.");

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/workspaces/workspace-1/companies/7/assistant-profiles/assistant-1/preview");
    expect(options.method).toBe("POST");
    expect(options.headers).toMatchObject({ "x-csrf-token": "csrf-token", "content-type": "application/json" });
    expect(JSON.parse(String(options.body))).toEqual({ message: "What time do you open?" });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(screen.getByText("Response").parentElement?.getAttribute("aria-live")).toBe("polite");
  });

  it("renders answered, safe fallback, and controlled error states accessibly", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(response({ status: "answered", answer: "Direct answer" }));
    const view = renderPanel();
    submit();
    await screen.findByText("Direct answer");
    expect(screen.getByText("Response")).not.toBeNull();

    view.rerenderPanel({ profile: { ...profile, id: "assistant-2" } });
    fetchMock.mockResolvedValueOnce(response({ status: "safe_fallback", answer: "Safe answer" }));
    submit();
    await screen.findByText("Safe answer");
    expect(screen.getByText("Safe fallback response").parentElement?.getAttribute("aria-live")).toBe("polite");

    view.rerenderPanel({ profile: { ...profile, id: "assistant-3" } });
    fetchMock.mockResolvedValueOnce(response({ error: { code: "knowledge_unavailable", message: "Unavailable" } }, 409));
    submit();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("does not have Knowledge available");
  });

  it("enforces rendered input validation before invoking the API", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderPanel();
    const button = screen.getByRole("button", { name: "Preview response" });
    expect(button.hasAttribute("disabled")).toBe(true);
    const textbox = screen.getByRole("textbox");
    expect(textbox.closest("label")?.textContent).toContain("Test message");
    fireEvent.change(textbox, { target: { value: "   " } });
    fireEvent.submit(button.closest("form")!);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
