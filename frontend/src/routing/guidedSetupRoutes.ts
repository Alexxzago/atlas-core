export type GuidedSetupRoute =
  | { readonly name: "landing" }
  | { readonly name: "register" }
  | { readonly name: "verify-email" }
  | { readonly name: "sign-in" }
  | { readonly name: "forgot-password" }
  | { readonly name: "reset-password" }
  | { readonly name: "workspace-setup" }
  | { readonly name: "company-setup" }
  | { readonly name: "not-found" };

export type GuidedSetupGuardState = "booting" | "unauthenticated" | "authenticated-needs-workspace" | "authenticated-needs-company" | "authenticated-ready";

export function parseGuidedSetupRoute(pathname: string): GuidedSetupRoute | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "landing" };
  const names: Readonly<Record<string, Exclude<GuidedSetupRoute["name"], "landing" | "not-found">>> = {
    "/register": "register", "/verify-email": "verify-email", "/sign-in": "sign-in", "/forgot-password": "forgot-password", "/reset-password": "reset-password", "/onboarding/workspace": "workspace-setup", "/onboarding/company": "company-setup",
  };
  return names[path] ? { name: names[path] } : null;
}

export function guidedSetupPath(route: Exclude<GuidedSetupRoute, { name: "not-found" }>): string {
  return ({ landing: "/", register: "/register", "verify-email": "/verify-email", "sign-in": "/sign-in", "forgot-password": "/forgot-password", "reset-password": "/reset-password", "workspace-setup": "/onboarding/workspace", "company-setup": "/onboarding/company" })[route.name];
}

export function resolveGuidedSetupRoute(route: GuidedSetupRoute, state: GuidedSetupGuardState): GuidedSetupRoute | { readonly redirect: string } {
  if (state === "booting") return route;
  const publicRoute = route.name === "landing" || route.name === "register" || route.name === "verify-email" || route.name === "sign-in" || route.name === "forgot-password" || route.name === "reset-password";
  if (state === "unauthenticated") return route.name === "workspace-setup" || route.name === "company-setup" ? { redirect: "/sign-in" } : route;
  if (publicRoute) return { redirect: state === "authenticated-needs-workspace" ? "/onboarding/workspace" : state === "authenticated-needs-company" ? "/onboarding/company" : "/dashboard" };
  if (state === "authenticated-needs-workspace") return { redirect: "/onboarding/workspace" };
  if (state === "authenticated-needs-company") return { redirect: "/onboarding/company" };
  return route.name === "company-setup" ? route : { redirect: "/dashboard" };
}
