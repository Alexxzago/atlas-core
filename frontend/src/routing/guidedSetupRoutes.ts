export type GuidedSetupRoute =
  | { readonly name: "landing" }
  | { readonly name: "register" }
  | { readonly name: "verify-email" }
  | { readonly name: "sign-in" }
  | { readonly name: "forgot-password" }
  | { readonly name: "reset-password" }
  | { readonly name: "workspace-setup" }
  | { readonly name: "company-setup" }
  | { readonly name: "activation-pending" }
  | { readonly name: "not-found" };

export type GuidedSetupGuardState = "booting" | "unauthenticated" | "authenticated-needs-workspace" | "authenticated-needs-company" | "authenticated-activation-pending" | "authenticated-ready";

export function parseGuidedSetupRoute(pathname: string): GuidedSetupRoute | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "landing" };
  const names: Readonly<Record<string, Exclude<GuidedSetupRoute["name"], "landing" | "not-found">>> = {
    "/register": "register", "/verify-email": "verify-email", "/sign-in": "sign-in", "/forgot-password": "forgot-password", "/reset-password": "reset-password", "/onboarding/workspace": "workspace-setup", "/onboarding/company": "company-setup", "/activation-pending": "activation-pending",
  };
  return names[path] ? { name: names[path] } : null;
}

export function guidedSetupPath(route: Exclude<GuidedSetupRoute, { name: "not-found" }>): string {
  return ({ landing: "/", register: "/register", "verify-email": "/verify-email", "sign-in": "/sign-in", "forgot-password": "/forgot-password", "reset-password": "/reset-password", "workspace-setup": "/onboarding/workspace", "company-setup": "/onboarding/company", "activation-pending": "/activation-pending" })[route.name];
}

export function resolveGuidedSetupRoute(route: GuidedSetupRoute, state: GuidedSetupGuardState): GuidedSetupRoute | { readonly redirect: string } {
  if (state === "booting") return route;
  const publicRoute = route.name === "register" || route.name === "verify-email" || route.name === "sign-in" || route.name === "forgot-password" || route.name === "reset-password";
  if (state === "unauthenticated") return route.name === "register" || route.name === "verify-email" || route.name === "sign-in" || route.name === "forgot-password" || route.name === "reset-password" ? route : { redirect: "/sign-in" };
  const destination = state === "authenticated-needs-workspace" ? "/onboarding/workspace" : state === "authenticated-needs-company" ? "/onboarding/company" : state === "authenticated-activation-pending" ? "/activation-pending" : "/dashboard";
  if (route.name === "landing" || publicRoute) return { redirect: destination };
  if (state === "authenticated-needs-workspace") return route.name === "workspace-setup" ? route : { redirect: "/onboarding/workspace" };
  if (state === "authenticated-needs-company") return route.name === "company-setup" ? route : { redirect: "/onboarding/company" };
  if (state === "authenticated-activation-pending") return route.name === "activation-pending" ? route : { redirect: "/activation-pending" };
  return { redirect: "/dashboard" };
}
