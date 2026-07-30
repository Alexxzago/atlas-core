import assert from "node:assert/strict";
import { test } from "node:test";
import { companyRouteKey, companyRoutePresentation } from "./companyRoutePresentation.ts";

test("company A state is never ready for a company B route", () => {
  const validation = { key: companyRouteKey("workspace", 2), status: "loading" as const };
  assert.equal(companyRoutePresentation("workspace", 2, 1, false, validation), "loading");
});

test("company panels require validated matching state", () => {
  const key = companyRouteKey("workspace", 2);
  assert.equal(companyRoutePresentation("workspace", 2, 2, true, { key, status: "ready" }), "loading");
  assert.equal(companyRoutePresentation("workspace", 2, 2, false, { key, status: "ready" }), "ready");
});

test("an inaccessible company route stays non-disclosing", () => {
  assert.equal(companyRoutePresentation("workspace", 2, null, false, { key: companyRouteKey("workspace", 2), status: "error" }), "error");
});
