import { expect, test, type Page, type Route } from "@playwright/test";

type Scenario = { capabilities?: string[]; delayedCompanyOne?: boolean; executionStatus?: 429 | 503 | "network"; pendingPreview?: boolean; platformAdmin?: boolean };
const allCapabilities = ["company:read", "company:manage", "assistant:capability:manage", "assistant:preview", "chat:use"];
const rawInternal = /live_data\.read|scheduling\.create_booking|provider-secret|trace-id|schema-version/i;

function company(id: number) { return { id, name: id === 1 ? "Northwind Homes" : "Contoso Realty", website: null, lifecycle: "operational", createdAt: "2026-01-01T00:00:00.000Z" }; }
function profile(companyId: number) { return { id: companyId === 1 ? "assistant-one" : "assistant-two", name: companyId === 1 ? "Northwind Guide" : "Contoso Guide", description: "Helpful support", businessRole: "Customer support", objective: "Answer customers", audience: "Buyers", tone: "friendly", assistantLanguage: "en", welcomeMessage: "Hello", fallbackMessage: "A person can help.", status: "ready", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null }; }
function readiness(companyId: number) { return { assistantIdentifier: "default", workspaceId: 1, companyId, status: "ready", blockers: [], knowledgeVersionId: "knowledge-1", assistantProfileId: profile(companyId).id, evaluatedAt: "2026-01-01T00:00:00.000Z", policyVersion: "assistant-readiness-v1", configurationDigest: "safe" }; }
const operational = { assistant: { status: "ready", evaluatedAt: "2026-01-01T00:00:00.000Z", blockers: [] }, whatsApp: [], voice: { status: "unavailable" } };
const catalog = { capabilities: [{ id: "live_data.read", assigned: true, availability: "available", consequence: "read_only", safeReason: null, safeNextAction: null, toolCount: 1 }, { id: "scheduling.create_booking", assigned: false, availability: "available", consequence: "consequential", safeReason: null, safeNextAction: null, toolCount: 1 }] };
const tools = { tools: [{ id: "live_data.read", enabled: true, availability: "available", capabilityId: "live_data.read", safeReason: null, safeNextAction: null }, { id: "scheduling.create_booking", enabled: false, availability: "available", capabilityId: "scheduling.create_booking", safeReason: null, safeNextAction: null }] };
const activation = { stages: ["company", "knowledge", "assistant", "web_chat", "verification", "pilot_ready", "human_ops"].map((id, index) => ({ id, status: index < 4 || index === 6 ? "complete" : "incomplete", state: index < 4 || index === 6 ? "complete" : "incomplete", owner: index < 4 || index === 6 ? null : "customer", reasonCode: index === 4 ? "verification_required" : index === 5 ? "pilot_not_ready" : null, action: ["complete_company", "publish_knowledge", "configure_assistant", "activate_web_chat", "start_verification", "resolve_pilot_readiness", "review_human_operations"][index], actionPath: ["/companies/1", "/companies/1/knowledge", "/companies/1/assistant", "/companies/1/channels/web-chat", null, null, "/conversations"][index] })), nextAction: "start_verification", evaluatedAt: "2026-01-01T00:00:00.000Z", policyVersion: "activation-projection-v1" };
const pilotReadiness = { overall: "not_ready", classification: "configuration_ready", checks: [], nextAction: "activate_web_chat", evaluatedAt: "2026-01-01T00:00:00.000Z", policyVersion: "pilot-readiness-v1" };
const webChatConnection = { id: "wcc_1", publicId: "wcp_00000000000000000000000000000000", assistantProfileId: "assistant-one", status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

async function fulfill(route: Route, body: unknown, status = 200) { await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }); }
async function installApi(page: Page, scenario: Scenario = {}) {
  const calls: string[] = [];
  await page.addInitScript(() => { localStorage.setItem("atlas.locale", "en"); localStorage.setItem("atlas-theme", "light"); });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace(/^\/api/, ""), method = request.method();
    calls.push(`${method} ${path}`);
    if (path !== "/identity/session/bootstrap" && !path.startsWith("/public/web-chat/") && method !== "GET" && request.headers()["x-csrf-token"] !== "e2e-csrf") throw new Error(`Missing CSRF on ${method} ${path}`);
    if (path === "/identity/session/bootstrap") return fulfill(route, { status: "authenticated", identity: { userId: "user-1", email: "operator@example.test", locale: "en", status: "active", isPlatformAdmin: scenario.platformAdmin ?? false, idleExpiresAt: "2026-12-01T00:00:00.000Z", absoluteExpiresAt: "2026-12-02T00:00:00.000Z" }, csrfToken: "e2e-csrf", csrfGeneration: 1 });
    if (path === "/admin/overview") return fulfill(route, { data: { totalUsers: 1, totalWorkspaces: 1, totalCompanies: 1, totalAssistantProfiles: 1, webChatConnections: 0, whatsAppConnections: { total: 0, active: 0, healthy: 0, degraded: 0 } } });
    if (path === "/workspaces" || path === "/workspaces/selected" || path === "/workspaces/workspace-1/select") return fulfill(route, path === "/workspaces" ? [{ id: "workspace-1", name: "E2E Workspace", role: "owner", capabilities: scenario.capabilities ?? allCapabilities }] : { id: "workspace-1", name: "E2E Workspace", role: "owner", capabilities: scenario.capabilities ?? allCapabilities });
    if (path === "/workspaces/workspace-1/companies") return fulfill(route, { data: [company(1), company(2)] });
    if (path.startsWith(`/public/web-chat/${webChatConnection.publicId}/`)) {
      if (path.endsWith("/session")) return fulfill(route, {}, method === "POST" ? 201 : 204);
      if (path.endsWith("/messages") && method === "GET") return fulfill(route, { messages: [] });
      if (path.endsWith("/messages") && method === "POST") return fulfill(route, { message: "A safe public chat answer." });
      if (path.includes("/activation-verifications/") && method === "POST") return fulfill(route, {}, 204);
    }
    const companyMatch = /^\/workspaces\/workspace-1\/companies\/(\d+)(.*)$/.exec(path);
    if (!companyMatch) return fulfill(route, { error: { code: "not_found", message: "Not found" } }, 404);
    const companyId = Number(companyMatch[1]), suffix = companyMatch[2], current = profile(companyId);
    if (scenario.delayedCompanyOne && companyId === 1 && suffix === "/assistant-profiles") { await new Promise(resolve => setTimeout(resolve, 750)); }
    if (suffix === "/conversations/feed") return fulfill(route, { events: [], nextCursor: "tail", hasMore: false, resyncRequired: false });
    if (suffix === "/conversations") return fulfill(route, { items: [], nextCursor: null });
    if (suffix === "") return fulfill(route, { data: company(companyId) });
    if (suffix === "/assistant-profiles") return fulfill(route, [current]);
    if (suffix === `/assistant-profiles/${current.id}`) return fulfill(route, current);
    if (suffix === "/assistant/default") return fulfill(route, { companyId, assistantProfileId: current.id, version: 1, assignedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", assignedByActorId: null, source: "operator" });
    if (suffix.endsWith("/capabilities/catalog")) return fulfill(route, catalog);
    if (suffix.endsWith("/tools/catalog")) return fulfill(route, tools);
    if (suffix.endsWith("/capabilities") && method === "PUT") return fulfill(route, { capabilities: ["live_data.read"] });
    if (suffix === "/assistant/readiness") return fulfill(route, readiness(companyId));
    if (suffix === "/pilot-readiness") return fulfill(route, pilotReadiness);
    if (suffix === "/activation") return fulfill(route, activation);
    if (suffix === "/activation/verification-attempts" && method === "POST") return fulfill(route, { token: "a".repeat(43), expiresAt: "2026-01-01T00:15:00.000Z" }, 201);
    if (suffix === "/web-chat-connections") return fulfill(route, [webChatConnection]);
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

test("authoritative activation journey starts verification through its primary CTA", async ({ page }) => {
  const calls = await installApi(page); await page.goto("/companies/1");
  await expect(page.getByRole("button", { name: "Iniciar verificación" })).toBeVisible();
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole("button", { name: "Iniciar verificación" }).click();
  await expect.poll(() => calls).toContain("POST /workspaces/workspace-1/companies/1/activation/verification-attempts");
  await expect.poll(() => calls).toContain(`POST /public/web-chat/${webChatConnection.publicId}/activation-verifications/${"a".repeat(43)}`);
});

test("PASS A geometry keeps controls canonical and Web Chat within every acceptance viewport", async ({ page }) => {
  await installApi(page);
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/companies/1/channels/web-chat");
    await expect(page.getByRole("heading", { name: "Web Chat", exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => ({
      viewport,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      overflowing: [...document.querySelectorAll<HTMLElement>("*")]
        .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 3)
        .map((element) => ({ className: element.className, x: element.getBoundingClientRect().x, width: element.getBoundingClientRect().width })),
    }));
    if (overflow.scrollWidth !== overflow.innerWidth) throw new Error(JSON.stringify(overflow));
  }
  const geometry = await page.evaluate(() => {
    const host = document.createElement("div");
    host.innerHTML = '<button class="ds-button">Standard</button><button class="ds-button ds-button--sm">Compact</button><input class="ds-control" /><select class="ds-control ds-select"><option>Plan</option></select><section class="ds-card">Card</section><section class="ds-card ds-card--compact">Compact card</section><label class="ds-radio-label"><input class="ds-radio" type="radio" />Voice</label>';
    document.body.append(host);
    const values = [...host.children].map((element) => ({ height: getComputedStyle(element).minBlockSize, padding: getComputedStyle(element).paddingTop }));
    const radio = host.querySelector(".ds-radio")!;
    const radioRect = radio.getBoundingClientRect();
    host.remove();
    return { values, radio: { width: radioRect.width, height: radioRect.height } };
  });
  expect(geometry.values.slice(0, 6).map((value) => value.height)).toEqual(["40px", "32px", "40px", "40px", "0px", "0px"]);
  expect(geometry.values.slice(4, 6).map((value) => value.padding)).toEqual(["20px", "16px"]);
  expect(geometry.radio).toEqual({ width: 18, height: 18 });
  await page.setViewportSize({ width: 1366, height: 480 });
  await page.goto("/companies/1/channels/web-chat");
  const accountAction = page.getByRole("button", { name: "Workspace and account" });
  await accountAction.scrollIntoViewIfNeeded();
  await expect(accountAction).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("PASS A coarse-pointer controls retain 44px targets", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await installApi(page);
  await page.goto("/companies/1/channels/web-chat");
  const geometry = await page.evaluate(() => {
    const host = document.createElement("div");
    host.innerHTML = '<button class="ds-button ds-button--sm">Compact</button><label class="ds-radio-label"><input class="ds-radio" type="radio" />Voice</label>';
    document.body.append(host);
    const button = host.querySelector("button")!.getBoundingClientRect();
    const label = host.querySelector("label")!.getBoundingClientRect();
    host.remove();
    return { button: button.height, label: label.height, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
  });
  expect(geometry.button).toBeGreaterThanOrEqual(44);
  expect(geometry.label).toBeGreaterThanOrEqual(44);
  expect(geometry.scrollWidth).toBe(geometry.innerWidth);
  await context.close();
});

test("ordinary public chat leaves the mocked activation projection incomplete", async ({ page }) => {
  const calls = await installApi(page); await page.goto(`/chat/${webChatConnection.publicId}`);
  await expect(page.getByRole("textbox", { name: "Tu mensaje" })).toBeVisible();
  await page.getByRole("textbox", { name: "Tu mensaje" }).fill("Consulta normal"); await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText("A safe public chat answer.")).toBeVisible();
  await page.goto("/companies/1");
  await expect(page.getByRole("button", { name: "Iniciar verificación" })).toBeVisible();
  expect(calls).toContain(`POST /public/web-chat/${webChatConnection.publicId}/messages`);
  expect(calls.some(call => call.includes("/activation-verifications/"))).toBeFalsy();
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

for (const viewport of [[1366, 768], [1920, 1080]] as const) test(`desktop assistant controls remain contained at ${viewport[0]}x${viewport[1]}`, async ({ page }) => {
  await page.setViewportSize({ width: viewport[0], height: viewport[1] }); await installApi(page); await open(page); await section(page, "Capabilities");
  await expect(page.getByText("Current data")).toBeVisible();
  await expect(page.locator(".assistant-profile-detail").locator("select")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(await page.locator(".assistant-profile-detail").evaluate((element) => {
    const style = getComputedStyle(element); return element.scrollHeight <= element.clientHeight || !["auto", "scroll"].includes(style.overflowY);
  })).toBeTruthy();
});

async function expectDesktopContainment(page: Page, surface: string, simplePage = false) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(await page.locator(surface).evaluate((element) => {
    const controls = [...element.querySelectorAll<HTMLElement>("button, input, select, textarea")].filter((control) => control.offsetParent !== null);
    return controls.every((control) => { const box = control.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth && box.width > 0 && box.height > 0; });
  })).toBeTruthy();
  if (simplePage) expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)).toBeTruthy();
}

for (const viewport of [[1366, 768], [1920, 1080]] as const) {
  test(`desktop dashboard remains contained at ${viewport[0]}x${viewport[1]}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport[0], height: viewport[1] }); await installApi(page); await page.goto("/dashboard");
    await expect(page.locator(".today-workspace")).toBeVisible(); await expectDesktopContainment(page, ".today-workspace", true);
  });
  test(`desktop conversations remain contained at ${viewport[0]}x${viewport[1]}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport[0], height: viewport[1] }); await installApi(page); await open(page); await page.locator("a[href='/conversations']").first().click();
    await expect(page.locator(".conversation-workspace")).toBeVisible(); await expectDesktopContainment(page, ".conversation-workspace");
    expect(await page.locator(".conversation-workspace").evaluate((element) => { const style = getComputedStyle(element); return element.scrollHeight <= element.clientHeight || !["auto", "scroll"].includes(style.overflowY); })).toBeTruthy();
  });
  test(`desktop platform admin remains contained at ${viewport[0]}x${viewport[1]}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport[0], height: viewport[1] }); await installApi(page, { platformAdmin: true }); await page.goto("/admin");
    await expect(page.locator(".admin-shell")).toBeVisible(); await expectDesktopContainment(page, ".admin-shell", true);
  });
}

test("accessibility smoke exposes headings, keyboard navigation, active state, labels and live regions", async ({ page }) => {
  await installApi(page); await open(page); await section(page, "Test assistant"); await expect(page.locator("h1")).toHaveCount(1); await page.getByRole("link", { name: "General" }).focus(); await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: "Behavior" })).toBeFocused(); await expect(page.getByRole("link", { name: "Test assistant" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("tab", { name: "With active functions" }).focus(); await page.keyboard.press("Enter"); await expect(page.getByRole("tab", { name: "With active functions" })).toHaveAttribute("aria-selected", "true"); await expect(page.getByRole("textbox", { name: "Test message" })).toBeVisible(); await expect(page.locator("[aria-live='polite']")).toHaveCount(0); await page.getByRole("textbox", { name: "Test message" }).fill("Question"); await page.getByRole("button", { name: "Send test" }).click(); await expect(page.locator("[aria-live='polite']")).toHaveCount(1);
});
