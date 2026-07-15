import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOnboardingFailure, setCompanyStatus } from "./companyState.ts";
import type { Company } from "../types/api.ts";

const readyCompany: Company = {
  id: 1,
  name: "Ready Company",
  website: "https://ready.test",
  phone: "",
  email: "",
  status: "ready",
  createdAt: "2026-07-14T00:00:00.000Z",
};

test("onboarding retry immediately removes stale ready status", () => {
  const companies = setCompanyStatus([readyCompany], readyCompany.id, "processing");
  assert.equal(companies[0]?.status, "processing");
});

test("onboarding failure is failed even when refresh cannot provide a company", () => {
  const processing = setCompanyStatus([readyCompany], readyCompany.id, "processing");
  const companies = applyOnboardingFailure(processing, readyCompany.id);
  assert.equal(companies[0]?.status, "failed");
});

test("onboarding failure never accepts a stale ready refresh response", () => {
  const processing = setCompanyStatus([readyCompany], readyCompany.id, "processing");
  const staleRefresh = { ...readyCompany, name: "Refreshed details", status: "ready" as const };
  const companies = applyOnboardingFailure(processing, readyCompany.id, staleRefresh);
  assert.equal(companies[0]?.status, "failed");
  assert.equal(companies[0]?.name, "Refreshed details");
});
