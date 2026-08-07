import { expect, test } from "vitest";
import { parseGuidedSetupRoute, resolveGuidedSetupRoute } from "./guidedSetupRoutes";

test("parses root, public, and setup paths", () => {
  expect(parseGuidedSetupRoute("/")).toEqual({ name: "landing" });
  expect(parseGuidedSetupRoute("/register/")).toEqual({ name: "register" });
  expect(parseGuidedSetupRoute("/verify-email")).toEqual({ name: "verify-email" });
  expect(parseGuidedSetupRoute("/identity/verify-email")).toEqual({ name: "verify-email" });
  expect(parseGuidedSetupRoute("/onboarding/workspace")).toEqual({ name: "workspace-setup" });
  expect(parseGuidedSetupRoute("/onboarding/company")).toEqual({ name: "company-setup" });
  expect(parseGuidedSetupRoute("/activation-pending")).toEqual({ name: "activation-pending" });
  expect(parseGuidedSetupRoute("/dashboard")).toBeNull();
});

test("keeps the requested route while the session state is booting", () => {
  expect(resolveGuidedSetupRoute({ name: "company-setup" }, "booting")).toEqual({ name: "company-setup" });
});

test("redirects unauthenticated setup access to sign in", () => {
  expect(resolveGuidedSetupRoute({ name: "landing" }, "unauthenticated")).toEqual({ redirect: "/sign-in" });
  expect(resolveGuidedSetupRoute({ name: "workspace-setup" }, "unauthenticated")).toEqual({ redirect: "/sign-in" });
  expect(resolveGuidedSetupRoute({ name: "company-setup" }, "unauthenticated")).toEqual({ redirect: "/sign-in" });
});

test("enforces workspace then company setup before the portal", () => {
  expect(resolveGuidedSetupRoute({ name: "sign-in" }, "authenticated-needs-workspace")).toEqual({ redirect: "/onboarding/workspace" });
  expect(resolveGuidedSetupRoute({ name: "company-setup" }, "authenticated-needs-workspace")).toEqual({ redirect: "/onboarding/workspace" });
  expect(resolveGuidedSetupRoute({ name: "sign-in" }, "authenticated-needs-company")).toEqual({ redirect: "/onboarding/company" });
  expect(resolveGuidedSetupRoute({ name: "landing" }, "authenticated-ready")).toEqual({ redirect: "/dashboard" });
  expect(resolveGuidedSetupRoute({ name: "register" }, "authenticated-activation-pending")).toEqual({ redirect: "/activation-pending" });
  expect(resolveGuidedSetupRoute({ name: "company-setup" }, "authenticated-ready")).toEqual({ redirect: "/dashboard" });
});

test("renders the required onboarding route instead of self-redirecting", () => {
  expect(resolveGuidedSetupRoute({ name: "workspace-setup" }, "authenticated-needs-workspace")).toEqual({ name: "workspace-setup" });
  expect(resolveGuidedSetupRoute({ name: "company-setup" }, "authenticated-needs-company")).toEqual({ name: "company-setup" });
});
