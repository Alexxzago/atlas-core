import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAppRoute, parsePortalRoute, portalPath } from "./routes.ts";

test("parses the frozen portal route hierarchy", () => {
  assert.deepEqual(parsePortalRoute("/companies/42/channels/whatsapp"), { name: "company-whatsapp", companyId: 42 });
  assert.deepEqual(parsePortalRoute("/companies/42/knowledge"), { name: "company-knowledge", companyId: 42 });
  assert.deepEqual(parsePortalRoute("/dashboard"), { name: "dashboard" });
});

test("rejects invalid company identifiers without a resource lookup", () => {
  assert.deepEqual(parsePortalRoute("/companies/abc"), { name: "not-found" });
  assert.deepEqual(parsePortalRoute("/companies/0"), { name: "not-found" });
  assert.deepEqual(parsePortalRoute("/companies/2/unknown"), { name: "not-found" });
});

test("builds canonical company paths", () => {
  assert.equal(portalPath({ name: "company-overview", companyId: 7 }), "/companies/7");
  assert.equal(portalPath({ name: "company-whatsapp", companyId: 7 }), "/companies/7/channels/whatsapp");
});

test("classifies public and authenticated application routes", () => {
  assert.deepEqual(parseAppRoute("/onboarding/company"), { kind: "public", name: "guided", route: { name: "company-setup" } });
  assert.deepEqual(parseAppRoute("/chat/public_connection"), { kind: "public", name: "chat", connectionPublicId: "public_connection" });
  assert.deepEqual(parseAppRoute("/companies"), { kind: "portal", route: { name: "companies" } });
});
