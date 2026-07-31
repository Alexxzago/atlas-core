// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { WebsiteKnowledgeStep } from "./WebsiteKnowledgeStep";

function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
function response(): object { return { source: { id: "source", companyId: 1, kind: "public_url", name: "Website: atlas.test", locator: "https://atlas.test", status: "active", version: 1, createdAt: "now", updatedAt: "now", archivedAt: null, latestRevision: null, includedRevisionId: null }, revision: { id: "revision", sourceId: "source", revisionNumber: 1, status: "ready", mediaType: "text/html", normalizedText: null, extractedKnowledge: null, failureCode: null, createdAt: "now", completedAt: "now" } }; }
function renderStep(): void { render(<I18nProvider><WebsiteKnowledgeStep csrf="csrf" workspaceId="wsp_1" companyId={1} onContinue={() => {}} /></I18nProvider>); }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("rejects an invalid website URL before calling the API", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); renderStep();
  fireEvent.change(screen.getByLabelText("Website"), { target: { value: "not a url" } });
  fireEvent.click(screen.getByRole("button", { name: "Analyze Website" }));
  expect(screen.getByRole("alert").textContent).toBe("Enter a valid website address.");
  expect(fetch).not.toHaveBeenCalled();
});

test("submits a valid URL, exposes processing accessibly, and shows real completion metadata", async () => {
  let resolve!: (result: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>((next) => { resolve = next; })); vi.stubGlobal("fetch", fetch); renderStep();
  fireEvent.change(screen.getByLabelText("Website"), { target: { value: "https://atlas.test/about" } });
  fireEvent.click(screen.getByRole("button", { name: "Analyze Website" }));
  expect(screen.getByRole("status", { name: "Analyzing website" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Analyzing website" }) as HTMLButtonElement).disabled).toBe(true);
  expect(fetch).toHaveBeenCalledWith("/api/workspaces/wsp_1/companies/1/knowledge/sources/url", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Website: atlas.test", url: "https://atlas.test/about" }) }));
  resolve(json(response(), 201));
  await screen.findByRole("heading", { name: "Website imported successfully" });
  expect(screen.getByText("Website: atlas.test")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Website imported successfully" }));
});

test("maps duplicate and unreachable website responses safely", async () => {
  const fetch = vi.fn(() => Promise.resolve(json({ error: { code: "knowledge_source_name_conflict", message: "internal" } }, 409))); vi.stubGlobal("fetch", fetch); renderStep();
  fireEvent.change(screen.getByLabelText("Website"), { target: { value: "https://atlas.test" } }); fireEvent.click(screen.getByRole("button", { name: "Analyze Website" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("This website has already been imported."));
  fetch.mockImplementationOnce(() => Promise.resolve(json({ error: { code: "knowledge_extraction_unavailable", message: "internal" } }, 503)));
  fireEvent.click(screen.getByRole("button", { name: "Analyze Website" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("We could not reach that website."));
});
