import { expect, test, type Page, type Route } from "@playwright/test";

type Scenario = { capabilities?: string[]; delayedCompanyOne?: boolean; holdCompanyOneActivationRefresh?: Promise<void>; holdCompanyTwoProjection?: Promise<void>; executionStatus?: 429 | 503 | "network"; pendingPreview?: boolean; platformAdmin?: boolean; locale?: "en" | "es"; billingManage?: boolean; conversationFixture?: "standard" | "longHuman" };
const allCapabilities = ["company:read", "company:manage", "assistant:capability:manage", "assistant:preview", "chat:use"];
const rawInternal = /live_data\.read|scheduling\.create_booking|provider-secret|trace-id|schema-version/i;

function company(id: number) { return { id, name: id === 1 ? "Northwind Homes" : "Contoso Realty", website: null, lifecycle: "operational", createdAt: "2026-01-01T00:00:00.000Z" }; }
function profile(companyId: number) { return { id: companyId === 1 ? "assistant-one" : "assistant-two", name: companyId === 1 ? "Northwind Guide" : "Contoso Guide", description: "Helpful support", businessRole: "Customer support", objective: "Answer customers", audience: "Buyers", tone: "friendly", assistantLanguage: "en", welcomeMessage: "Hello", fallbackMessage: "A person can help.", status: "ready", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null }; }
function readiness(companyId: number) { return { assistantIdentifier: "default", workspaceId: 1, companyId, status: "ready", blockers: [], knowledgeVersionId: "knowledge-1", assistantProfileId: profile(companyId).id, evaluatedAt: "2026-01-01T00:00:00.000Z", policyVersion: "assistant-readiness-v1", configurationDigest: "safe" }; }
const operational = { assistant: { status: "ready", evaluatedAt: "2026-01-01T00:00:00.000Z", blockers: [] }, whatsApp: [], voice: { status: "unavailable" } };
const catalog = { capabilities: [{ id: "live_data.read", assigned: true, availability: "available", consequence: "read_only", safeReason: null, safeNextAction: null, toolCount: 1 }, { id: "scheduling.create_booking", assigned: false, availability: "available", consequence: "consequential", safeReason: null, safeNextAction: null, toolCount: 1 }] };
const tools = { tools: [{ id: "live_data.read", enabled: true, availability: "available", capabilityId: "live_data.read", safeReason: null, safeNextAction: null }, { id: "scheduling.create_booking", enabled: false, availability: "available", capabilityId: "scheduling.create_booking", safeReason: null, safeNextAction: null }] };
function activation(companyId: number) { const nextAction = companyId === 1 ? "start_verification" : "publish_knowledge"; return { stages: ["company", "knowledge", "assistant", "web_chat", "verification", "pilot_ready", "human_ops"].map((id, index) => ({ id, status: index < (companyId === 1 ? 4 : 1) || index === 6 ? "complete" : "incomplete", state: index < (companyId === 1 ? 4 : 1) || index === 6 ? "complete" : "incomplete", owner: index < (companyId === 1 ? 4 : 1) || index === 6 ? null : "customer", reasonCode: index === 4 && companyId === 1 ? "verification_required" : index === 1 && companyId === 2 ? "published_knowledge_missing" : index === 5 ? "pilot_not_ready" : null, action: ["complete_company", "publish_knowledge", "configure_assistant", "activate_web_chat", "start_verification", "resolve_pilot_readiness", "review_human_operations"][index], actionPath: [`/companies/${companyId}`, `/companies/${companyId}/knowledge`, `/companies/${companyId}/assistant`, `/companies/${companyId}/channels/web-chat`, null, null, "/conversations"][index] })), nextAction, evaluatedAt: "2026-01-01T00:00:00.000Z", policyVersion: "activation-projection-v1" }; }
const pilotReadiness = { overall: "not_ready", classification: "configuration_ready", checks: [{ id: "default_assistant", required: true, status: "complete", owner: null, reasonCode: null, actionPath: null }, { id: "commercial_entitlement", required: true, status: "blocked", owner: "external_provider", reasonCode: "commercial_entitlement_missing", actionPath: "/billing" }, { id: "web_chat", required: true, status: "incomplete", owner: "customer", reasonCode: "web_chat_inactive", actionPath: "/companies/1/channels/web-chat" }], nextAction: "activate_web_chat", evaluatedAt: "2026-01-01T00:00:00.000Z", policyVersion: "pilot-readiness-v1" };
const webChatConnection = { id: "wcc_1", publicId: "wcp_00000000000000000000000000000000", assistantProfileId: "assistant-one", status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const scheduling = { data: { aggregateVersion: 7, locations: [{ id: "loc_1", name: "Main", address: "Main Street", timezone: "UTC", active: true, created_at: "2026-01-01", updated_at: "2026-01-01" }], resources: [{ id: "res_1", location_id: "loc_1", name: "Room", timezone: "UTC", capacity: 1, active: true, created_at: "2026-01-01", updated_at: "2026-01-01" }], services: [{ id: "svc_1", resource_id: "res_1", name: "Visit", duration_minutes: 30, buffer_before_minutes: 0, buffer_after_minutes: 0, slot_granularity_minutes: 15, minimum_lead_minutes: 0, maximum_horizon_days: 30, active: true, created_at: "2026-01-01", updated_at: "2026-01-01" }], weeklyWorkingWindows: [{ id: "ww_1", resource_id: "res_1", weekday: 0, start_time: "09:00", end_time: "17:00" }], dateExceptions: [{ id: "ex_1", resource_id: "res_1", local_date: "2026-01-02", kind: "closed", start_time: null, end_time: null }], readiness: { state: "locally_configured", hasLocations: true, hasResources: true, hasServices: true, hasWeeklyAvailability: true } } };
const whatsAppConnection = { id: "wac_0123456789abcdef0123456789abcdef", assistantProfileId: "assistant-one", phoneNumberId: "123456789012345", whatsappBusinessAccountId: "456789012345678", status: "inactive", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const whatsAppStatus = { connection: whatsAppConnection, credentialsConfigured: true, credentialSource: "manual", validationState: "not_validated", validatedAt: null, lastWebhookActivityAt: null, validationFailureCode: null, healthState: "inactive", lastProviderActivityAt: null, healthFailureCode: null, updatedAt: "2026-01-01T00:00:00.000Z" };
const conversationItem = { conversationId: "conversation-one", channel: "whatsapp", state: "open", controlState: "automated", controlledByCurrentActor: false, attentionReason: null, takenAt: null, releasedAt: null, lastOperatorActivityAt: null, resolvedAt: null, controlVersion: 1, updatedAt: "2026-01-01T00:00:00.000Z", contactLabel: "Conversation customer", participant: "Conversation customer", preview: "A recent customer question", deliveryCategory: null, lastActivityAt: "2026-01-01T00:00:00.000Z", delivery: null, unreadCount: 2 };
const conversationDetail = { ...conversationItem, messages: Array.from({ length: 16 }, (_, index) => ({ messageId: `message-${index}`, senderRole: index % 2 ? "assistant" : "customer", deliveryCategory: index % 2 ? "sent" : "received", content: `Conversation message ${index + 1}`, createdAt: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`, delivery: null })) };
const longHumanConversationItem = { ...conversationItem, controlState: "human_required", attentionReason: "automation_failure", preview: "A customer needs human assistance", updatedAt: "2026-01-02T00:00:00.000Z" };
const longHumanConversationDetail = { ...longHumanConversationItem, messages: Array.from({ length: 72 }, (_, index) => ({ messageId: `long-message-${index}`, senderRole: index % 3 === 0 ? "assistant" : "customer", deliveryCategory: index % 3 === 0 ? "sent" : "received", content: `Long conversation message ${index + 1}: the customer needs assistance with a detailed ongoing request.`, createdAt: `2026-01-01T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`, delivery: null })) };

async function fulfill(route: Route, body: unknown, status = 200) { await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }); }
async function installApi(page: Page, scenario: Scenario = {}) {
  const calls: string[] = [];
  let companyOneActivationRequests = 0;
  await page.addInitScript((locale: "en" | "es") => { localStorage.setItem("atlas.locale", locale); localStorage.setItem("atlas-theme", "light"); }, scenario.locale ?? "en");
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace(/^\/api/, ""), method = request.method();
    calls.push(`${method} ${path}`);
    if (path !== "/identity/session/bootstrap" && !path.startsWith("/public/web-chat/") && method !== "GET" && request.headers()["x-csrf-token"] !== "e2e-csrf") throw new Error(`Missing CSRF on ${method} ${path}`);
    if (path === "/identity/session/bootstrap") return fulfill(route, { status: "authenticated", identity: { userId: "user-1", email: "operator@example.test", locale: "en", status: "active", isPlatformAdmin: scenario.platformAdmin ?? false, idleExpiresAt: "2026-12-01T00:00:00.000Z", absoluteExpiresAt: "2026-12-02T00:00:00.000Z" }, csrfToken: "e2e-csrf", csrfGeneration: 1 });
    if (path === "/admin/overview") return fulfill(route, { data: { totalUsers: 1, totalWorkspaces: 1, totalCompanies: 1, totalAssistantProfiles: 1, webChatConnections: 0, whatsAppConnections: { total: 0, active: 0, healthy: 0, degraded: 0 } } });
    if (path === "/workspaces" || path === "/workspaces/selected" || path === "/workspaces/workspace-1/select") { const capabilities = [...(scenario.capabilities ?? allCapabilities), ...(scenario.billingManage ? ["workspace:manage"] : [])]; return fulfill(route, path === "/workspaces" ? [{ id: "workspace-1", name: "E2E Workspace", role: "owner", capabilities }] : { id: "workspace-1", name: "E2E Workspace", role: "owner", capabilities }); }
    if (path === "/workspaces/workspace-1/companies") return fulfill(route, { data: [company(1), company(2)] });
    if (path === "/workspaces/workspace-1/billing/summary") return fulfill(route, { rolloutMode: "managed", subscription: { state: "active", plan: { key: "starter", name: "Starter", interval: "month", currency: "USD", amountMinor: 1200 } }, entitlement: null, capabilities: { canOpenBillingPortal: true, canCancel: true, canReactivate: false, canStartNewCheckout: true, canSwitchProvider: false } });
    if (path === "/workspaces/workspace-1/billing/offers") return fulfill(route, { offers: [{ offerId: "offer", provider: "stripe", key: "starter", version: 1, name: "Starter", description: "For small teams", inclusions: [], interval: "month", currency: "USD", amountMinor: 1200, checkoutAvailable: true }] });
    if (path === "/workspaces/workspace-1/billing/management-actions") return fulfill(route, { actions: [], capabilities: { canOpenBillingPortal: true, canCancel: true, canReactivate: false, canStartNewCheckout: true, canSwitchProvider: false } });
    if (path === "/workspaces/workspace-1/billing/payer-identity-options") return fulfill(route, { options: [{ identityId: "identity_opaque", email: "payer@example.test" }] });
    if (path === "/admin/billing/plans/bce_0123456789abcdef0123456789abcdef") return fulfill(route, { data: { id: "bce_0123456789abcdef0123456789abcdef", planKey: "starter", catalogVersion: 1, displayName: "Starter", description: "Small teams", publicationState: "draft", trialDurationDays: null, graceDurationDays: null, maxCompanies: 3, maxAssistantProfiles: 4, maxActiveChannels: 2, mutationEligible: true, version: 1, subscriberCount: 0, offers: [], audit: [] } });
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
    if (suffix === "/conversations") return fulfill(route, { items: scenario.conversationFixture === "longHuman" ? [longHumanConversationItem] : scenario.conversationFixture === "standard" ? [conversationItem] : [], nextCursor: null });
    if (suffix === "/conversations/conversation-one") return fulfill(route, scenario.conversationFixture === "longHuman" ? longHumanConversationDetail : scenario.conversationFixture === "standard" ? conversationDetail : {}, scenario.conversationFixture ? 200 : 404);
    if (suffix === "/conversations/conversation-one/read") return fulfill(route, {}, 204);
    if (suffix === "") return fulfill(route, { data: company(companyId) });
    if (suffix === "/assistant-profiles") return fulfill(route, [current]);
    if (suffix === `/assistant-profiles/${current.id}`) return fulfill(route, current);
    if (suffix === "/assistant/default") return fulfill(route, { companyId, assistantProfileId: current.id, version: 1, assignedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", assignedByActorId: null, source: "operator" });
    if (suffix.endsWith("/capabilities/catalog")) return fulfill(route, catalog);
    if (suffix.endsWith("/tools/catalog")) return fulfill(route, tools);
    if (suffix.endsWith("/capabilities") && method === "PUT") return fulfill(route, { capabilities: ["live_data.read"] });
    if (suffix === "/assistant/readiness") return fulfill(route, readiness(companyId));
    if (suffix === "/pilot-readiness") { if (companyId === 2) await scenario.holdCompanyTwoProjection; return fulfill(route, pilotReadiness); }
    if (suffix === "/activation") { if (companyId === 1) { companyOneActivationRequests += 1; if (companyOneActivationRequests > 1) await scenario.holdCompanyOneActivationRefresh; } if (companyId === 2) await scenario.holdCompanyTwoProjection; return fulfill(route, activation(companyId)); }
    if (suffix === "/activation/verification-attempts" && method === "POST") return fulfill(route, { token: "a".repeat(43), expiresAt: "2026-01-01T00:15:00.000Z" }, 201);
    if (suffix === "/web-chat-connections") return fulfill(route, [webChatConnection]);
    if (suffix === "/assistant/readiness/refresh") return fulfill(route, readiness(companyId));
    if (suffix === "/operational-status") return fulfill(route, operational);
    if (suffix === "/scheduling-configuration") return fulfill(route, scheduling);
    if (suffix === "/proactive-action-policy") return fulfill(route, { enabled: true, version: 1 });
    if (suffix === "/proactive-actions") return fulfill(route, { items: [] });
    if (suffix === "/whatsapp-connections") return fulfill(route, [whatsAppConnection]);
    if (suffix === `/whatsapp-connections/${whatsAppConnection.id}/status`) return fulfill(route, whatsAppStatus);
    if (suffix === `/whatsapp-connections/${whatsAppConnection.id}/voice-policy`) return fulfill(route, { voiceAiEnabled: false, audioResponseMode: "text_only", version: 1 });
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

test("PASS E Today preserves confirmed activation during background refresh and fences company changes", async ({ page }) => {
  let releaseCompanyOne!: () => void, releaseCompanyTwo!: () => void;
  const companyOnePending = new Promise<void>(resolve => { releaseCompanyOne = resolve; });
  const companyTwoPending = new Promise<void>(resolve => { releaseCompanyTwo = resolve; });
  await page.setViewportSize({ width: 1366, height: 768 });
  await installApi(page, { holdCompanyOneActivationRefresh: companyOnePending, holdCompanyTwoProjection: companyTwoPending });
  await page.goto("/companies/1");
  const primary = page.getByRole("button", { name: "Iniciar verificación" });
  await expect(primary).toBeVisible();
  const height = await page.evaluate(() => document.scrollingElement!.scrollHeight);
  await page.evaluate(() => { window.open = () => null; });
  await primary.click();
  await expect(primary).toBeVisible();
  await expect(page.getByText("Actualizando estado...")).toBeVisible();
  await expect(page.getByText("Verificando el estado de activación...")).toHaveCount(0);
  expect(Math.abs(await page.evaluate(() => document.scrollingElement!.scrollHeight) - height)).toBeLessThanOrEqual(48);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole("button", { name: "Current company: Northwind Homes" }).click();
  await page.getByRole("button", { name: /Contoso Realty/ }).click();
  await expect(page.getByRole("button", { name: "Current company: Contoso Realty" })).toBeVisible();
  await expect(page.getByText("Verificando el estado de activación...")).toBeVisible();
  await expect(primary).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publicar conocimiento" })).toHaveCount(0);
  releaseCompanyTwo();
  await expect(page.getByRole("button", { name: "Publicar conocimiento" })).toBeVisible();
  await expect(primary).toHaveCount(0);
  releaseCompanyOne();
  await expect(page.getByRole("button", { name: "Publicar conocimiento" })).toBeVisible();
  await expect(primary).toHaveCount(0);
  await expect(page.locator(".activation-journey")).toBeVisible();
  await expect(page.locator(".pilot-readiness--supporting")).toBeVisible();
  expect(await page.locator(".activation-journey").evaluate((element) => element.getBoundingClientRect().top < window.innerHeight)).toBeTruthy();
  expect(await page.locator(".pilot-readiness--supporting").evaluate((element) => element.getBoundingClientRect().top < window.innerHeight + 160)).toBeTruthy();
});

test("Production polish keeps Today compact at 1366x768", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await installApi(page);
  await page.goto("/companies/1");
  await expect(page.getByRole("button", { name: "Iniciar verificación" })).toBeVisible();
  const today = page.locator(".today-workspace--ready");
  await expect(today).toBeVisible();
  expect(await today.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);
  expect(await page.locator(".pilot-readiness--supporting").evaluate((element) => element.getBoundingClientRect().top < window.innerHeight)).toBeTruthy();
  expect(await page.locator(".pilot-readiness__check").evaluateAll((rows) => rows.every((row) => row.getBoundingClientRect().height <= 80))).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("Production polish keeps assistant workspace geometry stable across tabs", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await installApi(page);
  await open(page);
  const workspace = page.locator(".assistant-profile-workspace");
  const initial = await workspace.boundingBox();
  expect(initial).not.toBeNull();
  for (const name of ["General", "Behavior", "Capabilities", "Tools", "Automatizaciones", "Status", "Test assistant"] as const) {
    await section(page, name);
    const bounds = await workspace.boundingBox();
    expect(bounds).not.toBeNull();
    expect(Math.abs(bounds!.x - initial!.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(bounds!.y - initial!.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(bounds!.width - initial!.width)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  }
  await section(page, "Automatizaciones");
  const actions = page.locator(".scheduling-automations .button");
  expect(await actions.count()).toBeGreaterThan(0);
  expect(await actions.evaluateAll((buttons) => buttons.every((button) => { const workspace = button.closest(".assistant-profile-workspace"); return workspace === null || button.getBoundingClientRect().width < workspace.getBoundingClientRect().width * 0.65; }))).toBeTruthy();
});

test("Production polish keeps assistant workspace geometry stable at tablet viewports", async ({ page }) => {
  for (const viewport of [{ width: 1024, height: 768 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    await installApi(page);
    await open(page);
    const workspace = page.locator(".assistant-profile-workspace"), initial = await workspace.boundingBox();
    expect(initial).not.toBeNull();
    for (const name of ["General", "Behavior", "Capabilities", "Tools", "Automatizaciones", "Status", "Test assistant"] as const) {
      await section(page, name);
      const bounds = await workspace.boundingBox();
      expect(bounds).not.toBeNull();
      expect(Math.abs(bounds!.x - initial!.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(bounds!.y - initial!.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(bounds!.width - initial!.width)).toBeLessThanOrEqual(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    }
  }
});

test("Production polish keeps conversation work internal at desktop and tablet", async ({ page }) => {
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport);
    await installApi(page, { capabilities: ["company:read", "conversation:manage"], conversationFixture: "standard" });
    await page.goto("/companies/1");
    await page.getByRole("link", { name: "Conversations" }).click();
    await page.getByRole("button", { name: /Conversation customer/ }).click();
    await expect(page.getByRole("heading", { name: "Conversation customer" })).toBeVisible();
    const workspace = page.locator(".conversation-workspace"), list = page.locator(".conversation-list"), timeline = page.locator(".conversation-timeline"), action = page.locator(".conversation-control--authority");
    expect(await workspace.evaluate((element) => element.getBoundingClientRect().bottom <= window.innerHeight + 1)).toBeTruthy();
    expect(await list.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
    expect(await timeline.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
    expect(await action.evaluate((element) => element.getBoundingClientRect().bottom <= window.innerHeight)).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  }
});

test("Production polish keeps a long human-required conversation operable at 1366x768", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await installApi(page, { capabilities: ["company:read", "company:manage", "conversation:manage"], conversationFixture: "longHuman" });
  await page.goto("/companies/1");
  await page.getByRole("link", { name: "Conversations" }).click();
  await page.getByRole("button", { name: /Conversation customer/ }).click();
  const workspace = page.locator(".conversation-workspace"), article = page.locator(".conversation-detail > article"), timeline = page.locator(".conversation-timeline"), authority = page.locator(".conversation-control--authority");
  await expect(page.locator(".conversation-detail .conversation-attention")).toBeVisible();
  await expect(authority.getByRole("button")).toBeVisible();
  expect(await workspace.evaluate((element) => element.getBoundingClientRect().bottom <= window.innerHeight + 1)).toBeTruthy();
  expect(await article.evaluate((element) => element.getBoundingClientRect().height > 0)).toBeTruthy();
  expect(await timeline.evaluate((element) => element.clientHeight >= 120 && element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === "auto")).toBeTruthy();
  expect(await authority.evaluate((element) => element.getBoundingClientRect().bottom <= window.innerHeight && element.getBoundingClientRect().height > 0)).toBeTruthy();
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight + 32 && document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("PASS F admin plan form stays compact at 1366x768", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await installApi(page, { platformAdmin: true });
  await page.goto("/admin/plans/bce_0123456789abcdef0123456789abcdef");
  await expect(page.getByRole("heading", { name: "Starter" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Actualizar borrador" })).toBeVisible();
  expect(await page.locator(".admin-plan-form").evaluate((form) => getComputedStyle(form).gridTemplateColumns.split(" ").length)).toBe(2);
  expect(await page.locator(".admin-plan-form textarea").evaluateAll((fields) => fields.every((field) => field.getBoundingClientRect().height <= 72))).toBeTruthy();
  expect(await page.getByRole("button", { name: "Actualizar borrador" }).evaluate((button) => button.getBoundingClientRect().top < window.innerHeight)).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("PASS F tablet admin, billing, and account menu remain reachable", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await installApi(page, { platformAdmin: true });
  await page.goto("/admin/plans/bce_0123456789abcdef0123456789abcdef");
  await expect(page.getByRole("heading", { name: "Starter" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Actualizar borrador" })).toBeVisible();
  expect(await page.locator(".admin-plan-form textarea").evaluateAll((fields) => fields.every((field) => field.getBoundingClientRect().height <= 72 && field.getBoundingClientRect().width >= 200))).toBeTruthy();
  expect(await page.getByRole("button", { name: "Actualizar borrador" }).evaluate((button) => button.getBoundingClientRect().bottom <= window.innerHeight)).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const memberPage = await page.context().newPage();
  await memberPage.setViewportSize({ width: 768, height: 1024 });
  await installApi(memberPage, { locale: "es", billingManage: true });
  await memberPage.goto("/billing");
  await expect(memberPage.getByRole("heading", { name: "Contacto de pago" })).toBeVisible();
  await expect(memberPage.getByText("Payment contact")).toHaveCount(0);
  expect(await memberPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await memberPage.goto("/companies/1");
  await memberPage.getByRole("button", { name: "Espacio y cuenta" }).click();
  const accountMenu = memberPage.getByRole("dialog", { name: "Espacio y cuenta" });
  await expect(accountMenu).toBeVisible();
  await expect(accountMenu.getByRole("button", { name: "Facturación" })).toBeVisible();
  await expect(accountMenu.getByRole("button", { name: "Espacio y equipo" })).toBeVisible();
  expect(await accountMenu.evaluate((element) => { const bounds = element.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= window.innerWidth && bounds.top >= 0 && bounds.bottom <= window.innerHeight; })).toBeTruthy();
  expect(await memberPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await memberPage.close();
});

test("PASS F billing Spanish copy and account menu stay compact", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await installApi(page, { locale: "es", billingManage: true });
  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "Contacto de pago" })).toBeVisible();
  await expect(page.getByText("Seleccioná un correo verificado antes de elegir un plan en ARS.")).toBeVisible();
  await expect(page.getByText("Payment contact")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.goto("/companies/1");
  await page.getByRole("button", { name: "Espacio y cuenta" }).click();
  const accountMenu = page.getByRole("dialog", { name: "Espacio y cuenta" });
  await expect(accountMenu).toBeVisible();
  expect(await accountMenu.evaluate((element) => element.getBoundingClientRect().width <= 280)).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("PASS F mobile account menu keeps controls reachable", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await installApi(page, { locale: "es" });
  await page.goto("/companies/1");
  await page.getByRole("button", { name: "Espacio y cuenta" }).click();
  const accountMenu = page.getByRole("dialog", { name: "Espacio y cuenta" });
  await expect(accountMenu).toBeVisible();
  expect(await accountMenu.evaluate((element) => element.getBoundingClientRect().width <= window.innerWidth)).toBeTruthy();
  const controls = accountMenu.locator("button:not(:disabled), select:not(:disabled)");
  expect(await controls.evaluateAll((elements) => elements.every((element) => element.getBoundingClientRect().height >= 44 && element.getBoundingClientRect().width >= 44))).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await context.close();
});

test("PASS B focused routes keep one compact context shell and compact operational rows", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await installApi(page);
  await open(page);
  for (const name of ["General", "Behavior", "Capabilities", "Tools", "Automatizaciones", "Status", "Test assistant"] as const) {
    await section(page, name);
    await expect(page.locator("[aria-label='Assistant context']")).toHaveCount(1);
    await expect(page.locator(".assistant-section-navigation")).toHaveCount(1);
    await expect(page.locator(".assistant-profile-detail h1")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  }
  await section(page, "Capabilities");
  await expect(page.locator(".assistant-capability-row")).toHaveCount(2);
  await expect(page.locator(".assistant-capability-card")).toHaveCount(0);
  await section(page, "Tools");
  await expect(page.locator(".assistant-tool-row")).toHaveCount(2);
  await expect(page.locator(".assistant-tool-card")).toHaveCount(0);
  expect(await page.locator(".assistant-profile-detail").evaluate((element) => element.getBoundingClientRect().height < 220)).toBeTruthy();
  for (const name of ["General", "Status", "Test assistant"] as const) {
    await section(page, name);
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight + 96)).toBeTruthy();
  }
});

test("PASS C automations keep compact secondary tabs and contained forms", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await installApi(page);
  await open(page);
  await section(page, "Automatizaciones");
  const tabs = page.locator(".automation-tabs");
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole("tab")).toHaveCount(7);
  await tabs.getByRole("tab", { name: "Ubicaciones" }).click();
  await expect(tabs.getByRole("tab", { name: "Ubicaciones" })).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

for (const [width, height, columns] of [[1366, 768, 2], [1024, 768, 2], [768, 1024, 1]] as const) test(`PASS C automation forms remain contained at ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await installApi(page);
  await open(page);
  await section(page, "Automatizaciones");
  await page.getByRole("tab", { name: "Ubicaciones" }).click();
  const form = page.locator(".automation-form").first();
  await expect(form).toBeVisible();
  await expect(form.getByRole("button", { name: "Guardar ubicación" })).toBeVisible();
  expect(await form.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(columns);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  if (width === 1366) expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight + 128)).toBeTruthy();
});

test("PASS C mobile automation controls retain reachable touch targets", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await installApi(page);
  await open(page);
  await section(page, "Automatizaciones");
  await page.getByRole("tab", { name: "Ubicaciones" }).click();
  const checkbox = page.locator(".automation-check").filter({ hasText: "Ubicación activa" });
  await expect(checkbox).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar ubicación" })).toBeVisible();
  expect(await checkbox.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await context.close();
});

for (const [width, height] of [[1366, 768], [1024, 768], [768, 1024]] as const) test(`PASS D Channels and WhatsApp remain compact at ${width}x${height}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await installApi(page);
  await page.goto("/companies/1/channels");
  await expect(page.locator(".channel-hub__grid .channel-card")).toHaveCount(6);
  expect(await page.locator(".channel-hub__grid .channel-card").first().evaluate((element) => getComputedStyle(element).minBlockSize)).toBe("0px");
  if (width === 1366) expect(await page.locator(".channel-hub__grid").evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length >= 2)).toBeTruthy();
  if (width === 1366) expect(await page.locator(".channel-hub__grid .channel-card").evaluateAll((cards) => { const [first, second] = cards; if (!first || !second) return false; const left = first.getBoundingClientRect(), right = second.getBoundingClientRect(); return left.top < window.innerHeight && right.top < window.innerHeight && left.bottom > 0 && right.bottom > 0 && left.x !== right.x; })).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.goto("/companies/1/channels/whatsapp");
  await expect(page.getByRole("region", { name: "Connection summary" })).toBeVisible();
  await expect(page.getByRole("region", { name: "WhatsApp setup" })).toBeVisible();
  await expect(page.locator(".whatsapp-voice-policy")).toBeVisible();
  if (width === 1366) expect(await page.getByRole("region", { name: /Connection summary|WhatsApp setup/ }).evaluateAll((regions) => regions.every((region) => { const box = region.getBoundingClientRect(); return box.top < window.innerHeight && box.bottom > 0; }))).toBeTruthy();
  if (width !== 1366) { const summary = page.getByRole("region", { name: "Connection summary" }), workflow = page.getByRole("region", { name: "WhatsApp setup" }); expect(await summary.evaluate((element, workflowElement) => Boolean(workflowElement) && element.compareDocumentPosition(workflowElement) & Node.DOCUMENT_POSITION_FOLLOWING, await workflow.elementHandle())).toBeTruthy(); await summary.scrollIntoViewIfNeeded(); expect(await summary.evaluate((element) => { const box = element.getBoundingClientRect(); return box.top < window.innerHeight && box.bottom > 0; })).toBeTruthy(); await workflow.scrollIntoViewIfNeeded(); expect(await workflow.evaluate((element) => { const box = element.getBoundingClientRect(); return box.top < window.innerHeight && box.bottom > 0; })).toBeTruthy(); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test("PASS D mobile WhatsApp voice controls retain usable touch targets", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await installApi(page);
  await page.goto("/companies/1/channels");
  const channelAction = page.getByRole("button", { name: "Manage Web Chat" });
  await channelAction.scrollIntoViewIfNeeded();
  expect(await channelAction.evaluate((element) => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight; })).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.goto("/companies/1/channels/whatsapp");
  const radio = page.getByRole("radio", { name: "Reply with text" });
  await expect(radio).toBeVisible();
  const action = page.getByRole("button", { name: "Validate connection" });
  await action.scrollIntoViewIfNeeded();
  expect(await action.evaluate((element) => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight; })).toBeTruthy();
  expect(await radio.locator("xpath=..").evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await context.close();
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
