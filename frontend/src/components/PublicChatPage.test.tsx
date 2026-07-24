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

  it("starts a same-origin session, sends text safely, and renders the minimal response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ state: "active" })).mockResolvedValueOnce(response({ message: "Respuesta segura" }));
    const view = render(<PublicChatPage connectionPublicId={connectionPublicId} />);
    await screen.findByText("Chat listo");
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "  <b>Hola</b>  " } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await screen.findByText("Respuesta segura");
    expect(screen.getByText("<b>Hola</b>")).not.toBeNull();
    expect(view.container.querySelector("b")).toBeNull();
    expect(fetchMock.mock.calls[0]).toMatchObject([`/api/public/web-chat/${connectionPublicId}/session`, { method: "POST", credentials: "same-origin" }]);
    expect(fetchMock.mock.calls[1]).toMatchObject([`/api/public/web-chat/${connectionPublicId}/messages`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" } }]);
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({ message: "<b>Hola</b>" });
  });

  it("blocks blank and oversized messages without requests, supports keyboard sending, and reports public errors", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ state: "active" })).mockResolvedValueOnce(response({ error: "busy" }, 409));
    render(<PublicChatPage connectionPublicId={connectionPublicId} />);
    await screen.findByText("Chat listo");
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "   " } }); fireEvent.submit(textarea.closest("form")!);
    fireEvent.change(textarea, { target: { value: "x".repeat(4_001) } }); fireEvent.submit(textarea.closest("form")!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ state: "active" })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    render(<PublicChatPage connectionPublicId={connectionPublicId} />);
    await screen.findByText("Chat listo"); fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await screen.findByText("La conversación fue cerrada.");
    expect(fetchMock.mock.calls[1]).toMatchObject([`/api/public/web-chat/${connectionPublicId}/session`, { method: "DELETE", credentials: "same-origin" }]);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
  });
});
