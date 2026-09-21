// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nContext";
import { RouterProvider } from "../routing/RouterProvider";
import { ThemeProvider } from "../design-system/theme";
import type { CustomerBillingOffer, CustomerBillingSummary, WorkspaceSummary } from "../types/api";
import { AuthenticatedCompanyPortal } from "./AuthenticatedCompanyPortal";
import { BillingPage } from "./BillingPage";

const capabilities = { canOpenBillingPortal: true, canCancel: true, canReactivate: false, canStartNewCheckout: true, canSwitchProvider: false } as const;
const workspace = (manage = true): WorkspaceSummary => ({ id: "workspace", name: "Workspace", role: manage ? "owner" : "member", capabilities: manage ? ["workspace:manage"] : ["workspace:read"] });
const companies = [{ id: 1, name: "Company A", website: null, phone: "", email: "", status: "ready" as const, createdAt: "2026-01-01T00:00:00.000Z" }, { id: 2, name: "Company B", website: null, phone: "", email: "", status: "ready" as const, createdAt: "2026-01-01T00:00:00.000Z" }];
const summary = (state: CustomerBillingSummary["subscription"]["state"] = "active", plan: CustomerBillingSummary["subscription"]["plan"] = { key: "atlas", name: "Atlas", interval: "month", currency: "USD", amountMinor: 1200 }): CustomerBillingSummary => ({ rolloutMode: "managed", subscription: { state, plan }, entitlement: null, capabilities });
const offer = (provider: CustomerBillingOffer["provider"], currency: string, checkoutAvailable = true): CustomerBillingOffer => ({ offerId: `${provider}-opaque-offer`, provider, key: "atlas", version: 1, name: "Atlas", description: "For growing teams", inclusions: [], interval: "month", currency, amountMinor: currency === "USD" ? 1200 : 2500, checkoutAvailable });
function json(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
function renderBilling(value: CustomerBillingSummary, offers: CustomerBillingOffer[], manage = true): void {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/billing/summary")) return Promise.resolve(json(value));
    if (url.endsWith("/billing/offers")) return Promise.resolve(json({ offers }));
    if (url.endsWith("/billing/management-actions")) return Promise.resolve(json({ actions: ["portal", "cancel"], capabilities: value.capabilities }));
    if (url.includes("/billing/payer-identity-options")) return Promise.resolve(json({ options: [] }));
    return Promise.resolve(new Response("", { status: 404 }));
  });
  render(<I18nProvider><BillingPage csrf="csrf" workspace={workspace(manage)} search="" pathname="/billing" /></I18nProvider>);
}
function portalFetch(input: string | URL | Request): Promise<Response> {
  const url = String(input);
  if (url.endsWith("/workspaces") && !url.includes("/selected")) return Promise.resolve(json([workspace()]));
  if (url.endsWith("/workspaces/selected") || url.endsWith("/workspaces/workspace/select")) return Promise.resolve(json(workspace()));
  if (url.endsWith("/workspaces/workspace/companies")) return Promise.resolve(json(companies));
  if (url.endsWith("/billing/summary")) return Promise.resolve(json(summary()));
  if (url.endsWith("/billing/offers")) return Promise.resolve(json({ offers: [offer("stripe", "USD")] }));
  if (url.endsWith("/billing/management-actions")) return Promise.resolve(json({ actions: ["portal", "cancel"], capabilities }));
  if (url.includes("/billing/payer-identity-options")) return Promise.resolve(json({ options: [] }));
  return Promise.resolve(new Response("", { status: 404 }));
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, "", "/"); });

test("opens Billing from the real AppShell account menu and renders the authenticated billing route", async () => {
  window.history.replaceState({}, "", "/dashboard");
  vi.spyOn(globalThis, "fetch").mockImplementation(portalFetch);
  render(<ThemeProvider><I18nProvider><RouterProvider><AuthenticatedCompanyPortal csrf="csrf" email="owner@example.test" onPassword={() => {}} onLogout={() => {}} /></RouterProvider></I18nProvider></ThemeProvider>);
  fireEvent.click((await screen.findAllByRole("button", { name: "Workspace and account" }))[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Billing" }));
  expect(await screen.findByRole("heading", { name: "Billing" })).toBeTruthy();
  expect(window.location.pathname).toBe("/billing");
});

test("presents empty, trial, active, canceled, and pending canonical states without inferring a plan", async () => {
  const cases: Array<[CustomerBillingSummary["subscription"]["state"], CustomerBillingSummary["subscription"]["plan"], string]> = [
    ["unmanaged", null, "No managed subscription"], ["trial", { key: "trial", name: "Trial plan", interval: "month", currency: "USD", amountMinor: 0 }, "Trial"], ["active", { key: "active", name: "Active plan", interval: "year", currency: "USD", amountMinor: 12000 }, "Active"], ["canceling_at_period_end", { key: "canceling", name: "Canceling plan", interval: "month", currency: "USD", amountMinor: 1200 }, "Cancels at period end"], ["grace", { key: "grace", name: "Grace plan", interval: "month", currency: "USD", amountMinor: 1200 }, "Grace period"], ["paused", { key: "paused", name: "Paused plan", interval: "month", currency: "USD", amountMinor: 1200 }, "Paused"], ["payment_required", { key: "payment", name: "Payment plan", interval: "month", currency: "USD", amountMinor: 1200 }, "Payment required"], ["canceled", null, "Cancelled"], ["reconciliation_required", null, "Status is being verified"],
  ];
  for (const [state, plan, label] of cases) {
    renderBilling(summary(state, plan), []);
    expect(await screen.findByText(label)).toBeTruthy();
    expect(screen.getByRole("heading", { name: plan?.name ?? "No active plan", level: 2 })).toBeTruthy();
    cleanup();
    vi.restoreAllMocks();
  }
});

test("keeps historical terms, provider-specific availability, and currency groups customer-safe", async () => {
  renderBilling(summary("active", { key: "legacy", name: "Legacy plan", interval: "month", currency: "USD", amountMinor: 900 }), [offer("stripe", "USD"), offer("mercadopago", "ARS", false)]);
  await screen.findByRole("heading", { name: "Legacy plan", level: 2 });
  expect(screen.getByText("USD")).toBeTruthy();
  expect(screen.getByText("ARS")).toBeTruthy();
  expect(screen.getAllByText(/\$9\.00/)).toHaveLength(1);
  expect((screen.getAllByRole("button", { name: "Choose plan" })[1] as HTMLButtonElement).disabled).toBe(true);
  expect(document.body.textContent).not.toMatch(/stripe|mercadopago|opaque-offer|price_|secret/i);
});

test("renders Stripe-only, Mercado Pago-only, dual, and read-only manager states from canonical offers", async () => {
  renderBilling(summary(), [offer("stripe", "USD")]);
  expect(await screen.findByText("USD")).toBeTruthy();
  expect(screen.queryByText("ARS")).toBeNull();
  cleanup(); vi.restoreAllMocks();
  renderBilling(summary(), [offer("mercadopago", "ARS")]);
  expect(await screen.findByText("ARS")).toBeTruthy();
  expect(screen.queryByText("USD")).toBeNull();
  cleanup(); vi.restoreAllMocks();
  renderBilling(summary(), [offer("stripe", "USD"), offer("mercadopago", "ARS")], false);
  await screen.findByText("Your access can view billing but cannot manage it.");
  expect(screen.getAllByRole("button", { name: "Choose plan" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
});
