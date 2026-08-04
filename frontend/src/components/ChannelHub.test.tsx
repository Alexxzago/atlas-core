// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
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
  expect(upcoming.textContent).toContain("Instagram");
  expect(upcoming.querySelector("button, a")).toBeNull();
  expect(upcoming.parentElement).not.toBe(screen.getByRole("button", { name: "Set up WhatsApp" }).closest("article"));
});
