import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAppRoute, parsePortalRoute, portalPath } from "./routes.ts";

test("parses the frozen portal route hierarchy", () => {
  assert.deepEqual(parsePortalRoute("/companies/42/channels/whatsapp"), { name: "company-whatsapp", companyId: 42 });
  assert.deepEqual(parsePortalRoute("/companies/42/channels/web-chat"), { name: "company-web-chat", companyId: 42 });
  assert.deepEqual(parsePortalRoute("/companies/42/knowledge"), { name: "company-knowledge", companyId: 42 });
  assert.deepEqual(parsePortalRoute("/dashboard"), { name: "dashboard" });
  assert.deepEqual(parsePortalRoute("/billing"), { name: "billing" });
  assert.deepEqual(parsePortalRoute("/billing/checkout/success"), { name: "billing" });
  assert.deepEqual(parsePortalRoute("/billing/portal/return"), { name: "billing" });
});

test("rejects invalid company identifiers without a resource lookup", () => {
  assert.deepEqual(parsePortalRoute("/companies/abc"), { name: "not-found" });
  assert.deepEqual(parsePortalRoute("/companies/0"), { name: "not-found" });
  assert.deepEqual(parsePortalRoute("/companies/2/unknown"), { name: "not-found" });
});

test("builds canonical company paths", () => {
  assert.equal(portalPath({ name: "company-overview", companyId: 7 }), "/companies/7");
  assert.equal(portalPath({ name: "company-whatsapp", companyId: 7 }), "/companies/7/channels/whatsapp");
  assert.equal(portalPath({ name: "company-web-chat", companyId: 7 }), "/companies/7/channels/web-chat");
  assert.equal(portalPath({ name: "company-assistant-section", companyId: 7, assistantProfileId: "asp_1", section: "status" }), "/companies/7/assistant/asp_1/status");
});

test("parses assistant subpaths while preserving the existing assistant route", () => {
  assert.deepEqual(parsePortalRoute("/companies/7/assistant"), { name: "company-assistant", companyId: 7 });
  assert.deepEqual(parsePortalRoute("/companies/7/assistant/asp_1/general"), { name: "company-assistant-section", companyId: 7, assistantProfileId: "asp_1", section: "general" });
  assert.deepEqual(parsePortalRoute("/companies/7/assistant/asp_1/behavior"), { name: "company-assistant-section", companyId: 7, assistantProfileId: "asp_1", section: "behavior" });
  assert.deepEqual(parsePortalRoute("/companies/7/assistant/asp_1/capabilities"), { name: "company-assistant-section", companyId: 7, assistantProfileId: "asp_1", section: "capabilities" });
  assert.deepEqual(parsePortalRoute("/companies/7/assistant/asp_1/status"), { name: "company-assistant-section", companyId: 7, assistantProfileId: "asp_1", section: "status" });
  assert.deepEqual(parsePortalRoute("/companies/7/assistant/asp_1/test"), { name: "company-assistant-section", companyId: 7, assistantProfileId: "asp_1", section: "test" });
  assert.deepEqual(parsePortalRoute("/companies/7/assistant/asp_1/unknown"), { name: "company-assistant", companyId: 7 });
});

test("classifies public and authenticated application routes", () => {
  assert.deepEqual(parseAppRoute("/"), { kind: "public", name: "guided", route: { name: "landing" } });
  assert.deepEqual(parseAppRoute("/onboarding/company"), { kind: "public", name: "guided", route: { name: "company-setup" } });
  assert.deepEqual(parseAppRoute("/chat/public_connection"), { kind: "public", name: "chat", connectionPublicId: "public_connection" });
  assert.deepEqual(parseAppRoute("/admin"), { kind: "admin", route: "overview" });
  assert.deepEqual(parseAppRoute("/admin/workspaces"), { kind: "admin", route: "workspaces" });
  assert.deepEqual(parseAppRoute("/admin/workspaces/wsp_1"), { kind: "admin", route: "workspace-commercial", id: "wsp_1" });
  assert.deepEqual(parseAppRoute("/admin/users/usr_1"), { kind: "admin", route: "user-commercial", id: "usr_1" });
  assert.deepEqual(parseAppRoute("/admin/plans"), { kind: "admin", route: "plans" });
  assert.deepEqual(parseAppRoute("/admin/plans/bce_0123456789abcdef0123456789abcdef"), { kind: "admin", route: "plan-detail", id: "bce_0123456789abcdef0123456789abcdef" });
  assert.deepEqual(parseAppRoute("/admin/plans/not-a-plan"), { kind: "admin", route: "not-found" });
  assert.deepEqual(parseAppRoute("/companies"), { kind: "portal", route: { name: "companies" } });
});
