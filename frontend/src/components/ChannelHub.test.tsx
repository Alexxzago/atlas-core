// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { ChannelHub } from "./ChannelHub";

afterEach(() => { document.body.replaceChildren(); });

test("separates available channels from a non-interactive upcoming channels section", () => {
  const navigate: string[] = [];
  render(<I18nProvider><ChannelHub companyId={7} onNavigate={(path) => navigate.push(path)} /></I18nProvider>);
  expect(screen.getByRole("heading", { name: "Meet customers where they are" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Set up WhatsApp" }));
  fireEvent.click(screen.getByRole("button", { name: "Manage Web Chat" }));
  expect(navigate).toEqual(["/companies/7/channels/whatsapp", "/companies/7/channels/web-chat"]);
  expect(document.querySelector('a[href="#web-chat-connections"]')).toBeNull();
  const upcoming = screen.getByRole("region", { name: "Upcoming channels" });
  expect(upcoming.textContent).toContain("We are preparing more places");
  expect(screen.getByRole("heading", { name: "Instagram" })).toBeTruthy();
  expect(upcoming.querySelector("button, a")).toBeNull();
  expect(upcoming.parentElement).not.toBe(screen.getByRole("button", { name: "Set up WhatsApp" }).closest("article"));
  expect(document.querySelectorAll(".channel-hub__grid .channel-card")).toHaveLength(6);
  expect(document.querySelectorAll(".channel-hub__grid .channel-card--future")).toHaveLength(4);
});

test("shows WhatsApp operational state and the correct next action", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ assistant: { status: "ready", evaluatedAt: null, blockers: [] }, whatsApp: [{ connectionId: "wac_active", status: "active", validationState: "valid", healthState: "healthy" }], voice: { status: "unavailable" } }), { headers: { "content-type": "application/json" } })));
  render(<I18nProvider><ChannelHub companyId={7} workspaceId="wsp" onNavigate={() => {}} /></I18nProvider>);
  expect(await screen.findByText("WhatsApp is active.")).toBeTruthy();
  expect(screen.getAllByText("Continue setup").length).toBeGreaterThan(0);
});

test("prioritizes attention over active and remains neutral until status is confirmed", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>(value => { resolve = value; })));
  render(<I18nProvider><ChannelHub companyId={7} workspaceId="wsp" onNavigate={() => {}} /></I18nProvider>);
  expect(screen.getAllByText("Atlas is checking this company's connections…").length).toBeGreaterThan(0);
  expect(screen.queryByText("WhatsApp is active.")).toBeNull();
  resolve(new Response(JSON.stringify({ assistant: { status: "ready", evaluatedAt: null, blockers: [] }, whatsApp: [{ connectionId: "wac_active", status: "active", validationState: "invalid", healthState: "degraded" }], voice: { status: "unavailable" } }), { headers: { "content-type": "application/json" } }));
  expect(await screen.findByText("Needs attention")).toBeTruthy();
  expect(screen.queryByText("WhatsApp is active.")).toBeNull();
});

test("shows an unavailable state and retry after a status failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(<I18nProvider><ChannelHub companyId={7} workspaceId="wsp" onNavigate={() => {}} /></I18nProvider>);
  expect(await screen.findByText("We couldn't connect to Atlas.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(screen.queryByText("WhatsApp is active.")).toBeNull();
});
