// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { ThemeSelector } from "../components/ThemeSelector";
import { applyResolvedTheme, resolveTheme, storedTheme, THEME_STORAGE_KEY, ThemeProvider } from "./theme";

interface FakeMedia { matches: boolean; readonly listeners: Set<(event: MediaQueryListEvent) => void>; emit(): void; }

function installMedia(matches: boolean): FakeMedia {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media: FakeMedia = { matches, listeners, emit: () => { for (const listener of listeners) listener({ matches: media.matches } as MediaQueryListEvent); } };
  vi.stubGlobal("matchMedia", () => ({ matches: media.matches, media: "(prefers-color-scheme: dark)", onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener), removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener), dispatchEvent: () => false }));
  return media;
}

function renderSelector(): HTMLButtonElement { render(<ThemeProvider><I18nProvider><ThemeSelector /></I18nProvider></ThemeProvider>); return screen.getByRole("button", { name: "Change appearance" }) as HTMLButtonElement; }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); delete document.documentElement.dataset.theme; });

test("uses the operating-system preference when no explicit preference exists", async () => {
  installMedia(true);
  const trigger = renderSelector();
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  expect(storedTheme()).toBe("system");
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  expect(trigger.querySelector("circle")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.queryByText("Appearance")).toBeNull();
});

test("clicking from a system-resolved light theme stores dark and stops following the OS", async () => {
  const media = installMedia(false);
  const trigger = renderSelector();
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
  fireEvent.click(trigger);
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  media.matches = true; media.emit();
  expect(document.documentElement.dataset.theme).toBe("dark");
});

test("clicking from a system-resolved dark theme stores light", async () => {
  installMedia(true);
  const trigger = renderSelector();
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  fireEvent.click(trigger);
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
});

test("explicit light and dark preferences alternate directly", async () => {
  installMedia(false);
  window.localStorage.setItem(THEME_STORAGE_KEY, "light");
  const trigger = renderSelector();
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
  fireEvent.click(trigger);
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  fireEvent.click(trigger);
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
});

test("has a localized name and supports Enter and Space activation", async () => {
  installMedia(false);
  const trigger = renderSelector();
  expect(trigger.getAttribute("title")).toBe("Change appearance");
  fireEvent.keyDown(trigger, { key: "Enter" });
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  fireEvent.keyDown(trigger, { key: " " });
  await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
  cleanup();
  window.localStorage.setItem("atlas.locale", "es");
  render(<ThemeProvider><I18nProvider><ThemeSelector /></I18nProvider></ThemeProvider>);
  expect(screen.getByRole("button", { name: "Cambiar apariencia" })).toBeTruthy();
});

test("applies the resolved initial theme synchronously before React renders", () => {
  const meta = document.createElement("meta"); meta.name = "theme-color"; document.head.append(meta);
  applyResolvedTheme("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.style.colorScheme).toBe("dark");
  expect(meta.content).toBe("#101827");
  expect(resolveTheme("system", { matches: false } as MediaQueryList)).toBe("light");
  meta.remove();
});
