// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PublicChatPage, publicConnectionIdFromPath } from "./PublicChatPage";

const connectionPublicId = "wcp_0123456789abcdef0123456789abcdef";
function response(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("PublicChatPage", () => {
  it("extracts only a valid public Connection ID from the chat route", () => {
    expect(publicConnectionIdFromPath(`/chat/${connectionPublicId}`)).toBe(connectionPublicId);
    expect(publicConnectionIdFromPath("/chat/company-1")).toBeNull();
    expect(publicConnectionIdFromPath(`/chat/${connectionPublicId}?companyId=1`)).toBeNull();
  });

  it("starts a same-origin session, hydrates empty history with one greeting, then sends safely", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ state: "active" })).mockResolvedValueOnce(response({ messages: [] })).mockResolvedValueOnce(response({ message: "Respuesta segura" }));
    const view = render(<PublicChatPage connectionPublicId={connectionPublicId} />);
    await screen.findByText("Chat listo");
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "  <b>Hola</b>  " } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await screen.findByText("Respuesta segura");
    expect(screen.getByText("<b>Hola</b>")).not.toBeNull();
    expect(view.container.querySelector("b")).toBeNull();
    expect(fetchMock.mock.calls[0]).toMatchObject([`/api/public/web-chat/${connectionPublicId}/session`, { method: "POST", credentials: "same-origin" }]);
    expect(fetchMock.mock.calls[1]).toMatchObject([`/api/public/web-chat/${connectionPublicId}/messages`, { method: "GET", credentials: "same-origin" }]);
    expect(fetchMock.mock.calls[2]).toMatchObject([`/api/public/web-chat/${connectionPublicId}/messages`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" } }]);
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({ message: "<b>Hola</b>" });
  });

  it("renders persisted history without duplicating the greeting and appends new messages", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ state: "active" })).mockResolvedValueOnce(response({ messages: [{ direction: "inbound", content: "Pregunta", createdAt: "2026-01-01T00:00:00.000Z" }, { direction: "outbound", content: "Respuesta", createdAt: "2026-01-01T00:00:01.000Z" }] })).mockResolvedValueOnce(response({ message: "Siguiente respuesta" }));
    render(<PublicChatPage connectionPublicId={connectionPublicId} />); await screen.findByText("Respuesta"); expect(screen.queryByText("Hola, soy Atlas. ¿En qué puedo ayudarte?")).toBeNull(); fireEvent.change(screen.getByRole("textbox"), { target: { value: "Otra pregunta" } }); fireEvent.click(screen.getByRole("button", { name: "Enviar" })); expect(await screen.findByText("Siguiente respuesta")).toBeTruthy();
  });

  it("blocks blank and oversized messages without requests, supports keyboard sending, and reports public errors", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ state: "active" })).mockResolvedValueOnce(response({ messages: [] })).mockResolvedValueOnce(response({ error: "busy" }, 409));
    render(<PublicChatPage connectionPublicId={connectionPublicId} />);
    await screen.findByText("Chat listo");
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "   " } }); fireEvent.submit(textarea.closest("form")!);
    fireEvent.change(textarea, { target: { value: "x".repeat(4_001) } }); fireEvent.submit(textarea.closest("form")!);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.change(textarea, { target: { value: "Consulta" } }); fireEvent.keyDown(textarea, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Enviando..." }).hasAttribute("disabled")).toBe(true);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("Esperá unos segundos");
  });

  it("shows unavailability on session failure and closes through DELETE", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ error: "unavailable" }, 404));
    const unavailable = render(<PublicChatPage connectionPublicId={connectionPublicId} />);
    await screen.findByText("Este chat no está disponible en este momento.");
    unavailable.unmount(); vi.restoreAllMocks();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ state: "active" })).mockResolvedValueOnce(response({ messages: [] })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    render(<PublicChatPage connectionPublicId={connectionPublicId} />);
    await screen.findByText("Chat listo"); fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await screen.findByText("La conversación fue cerrada.");
    expect(fetchMock.mock.calls[2]).toMatchObject([`/api/public/web-chat/${connectionPublicId}/session`, { method: "DELETE", credentials: "same-origin" }]);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("keeps a started session usable when history retrieval fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ state: "active" })).mockResolvedValueOnce(response({ error: "unavailable" }, 503));
    render(<PublicChatPage connectionPublicId={connectionPublicId} />); expect(await screen.findByText("Chat listo")).toBeTruthy(); expect(screen.getByRole("alert").textContent).toContain("restaurar"); expect(screen.queryByText("Hola, soy Atlas. ¿En qué puedo ayudarte?")).toBeNull();
  });
});
