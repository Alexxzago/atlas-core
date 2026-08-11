export type PortalRoute =
  | { readonly name: "dashboard" }
  | { readonly name: "companies" }
  | { readonly name: "company-overview"; readonly companyId: number }
  | { readonly name: "company-assistant"; readonly companyId: number }
  | { readonly name: "company-knowledge"; readonly companyId: number }
  | { readonly name: "company-channels"; readonly companyId: number }
  | { readonly name: "company-whatsapp"; readonly companyId: number }
  | { readonly name: "company-web-chat"; readonly companyId: number }
  | { readonly name: "conversations" }
  | { readonly name: "analytics" }
  | { readonly name: "settings" }
  | { readonly name: "not-found" };

export type AppRoute =
  | { readonly kind: "public"; readonly name: "guided"; readonly route: GuidedSetupRoute }
  | { readonly kind: "public"; readonly name: "chat"; readonly connectionPublicId: string }
  | { readonly kind: "admin"; readonly route: "overview" | "workspaces" | "not-found" }
  | { readonly kind: "portal"; readonly route: PortalRoute };

function companyId(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parsePortalRoute(pathname: string): PortalRoute {
  const segments = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (segments.length === 0 || segments[0] === "dashboard" && segments.length === 1) return { name: "dashboard" };
  if (segments[0] === "companies" && segments.length === 1) return { name: "companies" };
  if (segments[0] === "companies") {
    const id = companyId(segments[1]);
    if (!id) return { name: "not-found" };
    if (segments.length === 2) return { name: "company-overview", companyId: id };
    if (segments.length === 3 && segments[2] === "assistant") return { name: "company-assistant", companyId: id };
    if (segments.length === 3 && segments[2] === "knowledge") return { name: "company-knowledge", companyId: id };
    if (segments.length === 3 && segments[2] === "channels") return { name: "company-channels", companyId: id };
    if (segments.length === 4 && segments[2] === "channels" && segments[3] === "whatsapp") return { name: "company-whatsapp", companyId: id };
    if (segments.length === 4 && segments[2] === "channels" && segments[3] === "web-chat") return { name: "company-web-chat", companyId: id };
    return { name: "not-found" };
  }
  if (segments.length === 1 && segments[0] === "conversations") return { name: "conversations" };
  if (segments.length === 1 && segments[0] === "analytics") return { name: "analytics" };
  if (segments.length === 1 && segments[0] === "settings") return { name: "settings" };
  return { name: "not-found" };
}

export function parseAppRoute(pathname: string): AppRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  const guidedRoute = parseGuidedSetupRoute(path);
  if (guidedRoute) return { kind: "public", name: "guided", route: guidedRoute };
  const chat = /^\/chat\/([a-zA-Z0-9_-]+)$/.exec(path);
  if (chat?.[1]) return { kind: "public", name: "chat", connectionPublicId: chat[1] };
  if (path === "/admin") return { kind: "admin", route: "overview" };
  if (path === "/admin/workspaces") return { kind: "admin", route: "workspaces" };
  if (path.startsWith("/admin/")) return { kind: "admin", route: "not-found" };
  return { kind: "portal", route: parsePortalRoute(path) };
}

export function portalPath(route: Exclude<PortalRoute, { name: "not-found" }>): string {
  if (route.name === "dashboard") return "/dashboard";
  if (route.name === "companies") return "/companies";
  if (route.name === "conversations") return "/conversations";
  if (route.name === "analytics") return "/analytics";
  if (route.name === "settings") return "/settings";
  const base = `/companies/${route.companyId}`;
  if (route.name === "company-overview") return base;
  if (route.name === "company-assistant") return `${base}/assistant`;
  if (route.name === "company-knowledge") return `${base}/knowledge`;
  if (route.name === "company-channels") return `${base}/channels`;
  if (route.name === "company-whatsapp") return `${base}/channels/whatsapp`;
  return `${base}/channels/web-chat`;
}

export function routeCompanyId(route: PortalRoute): number | null {
  return "companyId" in route ? route.companyId : null;
}
import { parseGuidedSetupRoute, type GuidedSetupRoute } from "./guidedSetupRoutes.ts";
