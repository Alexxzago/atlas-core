import { expect, test, type Page, type Route } from "@playwright/test";

type Scenario = { capabilities?: string[]; delayedCompanyOne?: boolean; executionStatus?: 429 | 503 | "network"; pendingPreview?: boolean };
const allCapabilities = ["company:read", "company:manage", "assistant:capability:manage", "assistant:preview", "chat:use"];
const rawInternal = /live_data\.read|scheduling\.create_booking|provider-secret|trace-id|schema-version/i;

function company(id: number) { return { id, name: id === 1 ? "Northwind Homes" : "Contoso Realty", website: null, lifecycle: "operational", createdAt: "2026-01-01T00:00:00.000Z" }; }
function profile(companyId: number) { return { id: companyId === 1 ? "assistant-one" : "assistant-two", name: companyId === 1 ? "Northwind Guide" : "Contoso Guide", description: "Helpful support", businessRole: "Customer support", objective: "Answer customers", audience: "Buyers", tone: "friendly", assistantLanguage: "en", welcomeMessage: "Hello", fallbackMessage: "A person can help.", status: "ready", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null }; }
function readiness(companyId: number) { return { assistantIdentifier: "default", workspaceId: 1, companyId, status: "ready", blockers: [], knowledgeVersionId: "knowledge-1", assistantProfileId: profile(companyId).id, evaluatedAt: "2026-01-01T00:00:00.000Z", policyVersion: "assistant-readiness-v1", configurationDigest: "safe" }; }
const operational = { assistant: { status: "ready", evaluatedAt: "2026-01-01T00:00:00.000Z", blockers: [] }, whatsApp: [], voice: { status: "unavailable" } };
const catalog = { capabilities: [{ id: "live_data.read", assigned: true, availability: "available", consequence: "read_only", safeReason: null, safeNextAction: null, toolCount: 1 }, { id: "scheduling.create_booking", assigned: false, availability: "available", consequence: "consequential", safeReason: null, safeNextAction: null, toolCount: 1 }] };
const tools = { tools: [{ id: "live_data.read", enabled: true, availability: "available", capabilityId: "live_data.read", safeReason: null, safeNextAction: null }, { id: "scheduling.create_booking", enabled: false, availability: "available", capabilityId: "scheduling.create_booking", safeReason: null, safeNextAction: null }] };

async function fulfill(route: Route, body: unknown, status = 200) { await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }); }
async function installApi(page: Page, scenario: Scenario = {}) {
  const calls: string[] = [];
  await page.addInitScript(() => { localStorage.setItem("atlas.locale", "en"); localStorage.setItem("atlas-theme", "light"); });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace(/^\/api/, ""), method = request.method();
    calls.push(`${method} ${path}`);
    if (path !== "/identity/session/bootstrap" && method !== "GET" && request.headers()["x-csrf-token"] !== "e2e-csrf") throw new Error(`Missing CSRF on ${method} ${path}`);
    if (path === "/identity/session/bootstrap") return fulfill(route, { status: "authenticated", identity: { userId: "user-1", email: "operator@example.test", locale: "en", status: "active", isPlatformAdmin: false, idleExpiresAt: "2026-12-01T00:00:00.000Z", absoluteExpiresAt: "2026-12-02T00:00:00.000Z" }, csrfToken: "e2e-csrf", csrfGeneration: 1 });
    if (path === "/workspaces" || path === "/workspaces/selected" || path === "/workspaces/workspace-1/select") return fulfill(route, path === "/workspaces" ? [{ id: "workspace-1", name: "E2E Workspace", role: "owner", capabilities: scenario.capabilities ?? allCapabilities }] : { id: "workspace-1", name: "E2E Workspace", role: "owner", capabilities: scenario.capabilities ?? allCapabilities });
    if (path === "/workspaces/workspace-1/companies") return fulfill(route, { data: [company(1), company(2)] });
    const companyMatch = /^\/workspaces\/workspace-1\/companies\/(\d+)(.*)$/.exec(path);
    if (!companyMatch) return fulfill(route, { error: { code: "not_found", message: "Not found" } }, 404);
    const companyId = Number(companyMatch[1]), suffix = companyMatch[2], current = profile(companyId);
    if (scenario.delayedCompanyOne && companyId === 1 && suffix === "/assistant-profiles") { await new Promise(resolve => setTimeout(resolve, 750)); }
    if (suffix === "") return fulfill(route, { data: company(companyId) });
    if (suffix === "/assistant-profiles") return fulfill(route, [current]);
    if (suffix === `/assistant-profiles/${current.id}`) return fulfill(route, current);
    if (suffix === "/assistant/default") return fulfill(route, { companyId, assistantProfileId: current.id, version: 1, assignedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", assignedByActorId: null, source: "operator" });
    if (suffix.endsWith("/capabilities/catalog")) return fulfill(route, catalog);
    if (suffix.endsWith("/tools/catalog")) return fulfill(route, tools);
    if (suffix.endsWith("/capabilities") && method === "PUT") return fulfill(route, { capabilities: ["live_data.read"] });
    if (suffix === "/assistant/readiness") return fulfill(route, readiness(companyId));
    if (suffix === "/assistant/readiness/refresh") return fulfill(route, readiness(companyId));
    if (suffix === "/operational-status") return fulfill(route, operational);
    if (suffix.endsWith("/preview") || suffix === "/assistant/executions") {
      if (scenario.executionStatus === "network") return route.abort("failed");
      if (scenario.executionStatus) return fulfill(route, { error: { code: "temporarily_unavailable", message: "provider-secret trace-id" } }, scenario.executionStatus);
      if (scenario.pendingPreview && suffix.endsWith("/preview")) return new Promise(() => undefined);
      return fulfill(route, { status: suffix.endsWith("/preview") ? "answered" : "safe_fallback", answer: suffix.endsWith("/preview") ? "A safe preview answer." : "A safe fallback answer." });
    }
    return fulfill(route, { error: { code: "not_found", message: "Not found" } }, 404);
  });
  return calls;
}
async function open(page: Page, path = "/companies/1/assistant") { await page.goto(path); await expect(page.getByRole("link", { name: "General" })).toBeVisible(); }
async function section(page: Page, name: string) { const mobile = await page.evaluate(() => window.innerWidth < 768); if (mobile) { await page.getByRole("button", { name: "Open navigation" }).click(); await page.locator("#mobile-navigation").getByRole("link", { name: "Configure assistant" }).click(); } const link = page.locator(".assistant-section-navigation").getByRole("link", { name }); await link.click(); await expect(link).toHaveAttribute("aria-current", "page"); }
function assertNoLeak(page: Page) { return expect(page.locator("body")).not.toContainText(rawInternal); }

test("base route resolves, navigates all six sections, deep links, history, and safe fallback", async ({ page }) => {
  await installApi(page); await open(page);
  await expect(page).toHaveURL(/\/assistant\/assistant-one\/general$/);
  for (const [name, suffix] of [["General", "general"], ["Behavior", "behavior"], ["Capabilities", "capabilities"], ["Tools", "tools"], ["Status", "status"], ["Test assistant", "test"]] as const) {
    await page.getByRole("link", { name }).click(); await expect(page).toHaveURL(new RegExp(`/${suffix}$`)); await expect(page.getByRole("link", { name })).toHaveAttribute("aria-current", "page");
  }
  await page.goto("/companies/1/assistant/assistant-one/tools"); await expect(page).toHaveURL(/\/companies\/1\/assistant\/assistant-one\/tools$/); await open(page);
  await page.goto("/companies/1/assistant/assistant-one/unsupported"); await expect(page).toHaveURL(/\/companies\/1\/assistant\/assistant-one\/general$/);
  await page.getByRole("link", { name: "Status" }).click(); await page.goBack(); await expect(page.getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page"); await page.goForward(); await expect(page.getByRole("link", { name: "Status" })).toHaveAttribute("aria-current", "page");
});

test("permissions preserve read access and gate mutations and test modes", async ({ page }) => {
  await installApi(page, { capabilities: ["company:read", "assistant:preview"] }); await open(page); await section(page, "Capabilities");
  await expect(page.getByText("You can view this configuration, but you do not have permission to change it.")).toBeVisible(); for (const checkbox of await page.getByRole("checkbox").all()) await expect(checkbox).toBeDisabled(); await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await page.getByRole("link", { name: "Status" }).click(); await expect(page.getByText("You can view this status, but your current access cannot check it again.")).toBeVisible(); await expect(page.getByRole("button", { name: "Check again" })).toHaveCount(0);
  await page.getByRole("link", { name: "Test assistant" }).click(); await expect(page.getByRole("tab", { name: "Preview" })).toBeEnabled(); await expect(page.getByRole("tab", { name: "With active functions" })).toBeDisabled();
});

test("safe labels, authoritative status, neutral voice, and no diagnostics are rendered", async ({ page }) => {
  await installApi(page); await open(page); await section(page, "Capabilities"); await expect(page.getByText("Current data")).toBeVisible(); await assertNoLeak(page);
  await page.getByRole("link", { name: "Tools" }).click(); await expect(page.getByText("Create bookings")).toBeVisible(); await assertNoLeak(page);
  await page.getByRole("link", { name: "Status" }).click(); await expect(page.getByRole("status").filter({ hasText: "Ready" })).toBeVisible(); await expect(page.getByText("Voice service is currently unavailable. This does not prevent the assistant from serving customers through available channels.")).toBeVisible(); await assertNoLeak(page);
});

test("preview and active execution use separate endpoints and expose safe outcomes", async ({ page }) => {
  const calls = await installApi(page); await open(page); await section(page, "Test assistant");
  await page.getByRole("textbox", { name: "Test message" }).fill("Preview question"); await page.getByRole("button", { name: "Send test" }).click(); await expect(page.getByText("A safe preview answer.")).toBeVisible();
  expect(calls.some(call => call.includes("POST /workspaces/workspace-1/companies/1/assistant-profiles/assistant-one/preview"))).toBeTruthy(); expect(calls.some(call => call.endsWith("POST /workspaces/workspace-1/companies/1/assistant/executions"))).toBeFalsy();
  await page.getByRole("tab", { name: "With active functions" }).click(); await page.getByRole("textbox", { name: "Test message" }).fill("Active question"); await page.getByRole("button", { name: "Send test" }).click(); await expect(page.getByText("A safe fallback answer.")).toBeVisible();
  expect(calls.some(call => call.endsWith("POST /workspaces/workspace-1/companies/1/assistant/executions"))).toBeTruthy();
});

test("pending and transient execution failures remain safe", async ({ page }) => {
  await installApi(page, { pendingPreview: true }); await open(page); await section(page, "Test assistant"); await page.getByRole("textbox", { name: "Test message" }).fill("Question"); await page.getByRole("button", { name: "Send test" }).click(); await expect(page.getByRole("button", { name: /Sending/ })).toBeDisabled(); await expect(page.getByRole("textbox", { name: "Test message" })).toBeDisabled();
});

for (const status of [429, 503, "network"] as const) test(`execution ${status} feedback remains safe`, async ({ page }) => {
  await installApi(page, { executionStatus: status }); await open(page); await section(page, "Test assistant"); await page.getByRole("textbox", { name: "Test message" }).fill("Question"); await page.getByRole("button", { name: "Send test" }).click(); await expect(page.getByRole("alert")).toBeVisible(); await assertNoLeak(page);
});

test("company switching clears the previous subtree and ignores delayed obsolete data", async ({ page }) => {
  await installApi(page, { delayedCompanyOne: true }); await open(page); await page.getByRole("button", { name: "Current company: Northwind Homes" }).click(); await page.getByRole("button", { name: /Contoso Realty/ }).click(); await expect(page.getByRole("button", { name: "Current company: Contoso Realty" })).toBeVisible(); await page.waitForTimeout(900); await expect(page.getByText("Northwind Guide")).toHaveCount(0);
});

for (const viewport of [[360, 800], [390, 844], [768, 1024], [1440, 900]] as const) test(`responsive assistant controls remain usable at ${viewport[0]}x${viewport[1]}`, async ({ page }) => {
  await page.setViewportSize({ width: viewport[0], height: viewport[1] }); await installApi(page); await open(page); await section(page, "Test assistant");
  await expect(page.getByRole("link", { name: "Test assistant" })).toHaveAttribute("aria-current", "page"); await expect(page.getByRole("textbox", { name: "Test message" })).toBeVisible(); await expect(page.getByRole("button", { name: "Send test" })).toBeVisible();
  await page.getByRole("link", { name: "Capabilities" }).click(); await expect(page.getByText("Current data")).toBeVisible(); await page.getByRole("link", { name: "Tools" }).click(); await expect(page.getByText("Create bookings")).toBeVisible(); await page.getByRole("link", { name: "Status" }).click(); await expect(page.getByText("Voice service is currently unavailable. This does not prevent the assistant from serving customers through available channels.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("accessibility smoke exposes headings, keyboard navigation, active state, labels and live regions", async ({ page }) => {
  await installApi(page); await open(page); await section(page, "Test assistant"); await expect(page.locator("h1")).toHaveCount(1); await page.getByRole("link", { name: "General" }).focus(); await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: "Behavior" })).toBeFocused(); await expect(page.getByRole("link", { name: "Test assistant" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("tab", { name: "With active functions" }).focus(); await page.keyboard.press("Enter"); await expect(page.getByRole("tab", { name: "With active functions" })).toHaveAttribute("aria-selected", "true"); await expect(page.getByRole("textbox", { name: "Test message" })).toBeVisible(); await expect(page.locator("[aria-live='polite']")).toHaveCount(0); await page.getByRole("textbox", { name: "Test message" }).fill("Question"); await page.getByRole("button", { name: "Send test" }).click(); await expect(page.locator("[aria-live='polite']")).toHaveCount(1);
});
