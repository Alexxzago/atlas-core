import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { parseAppRoute, parsePortalRoute, type AppRoute, type PortalRoute } from "./routes";

interface RouterValue {
  readonly route: PortalRoute;
  readonly appRoute: AppRoute;
  readonly pathname: string;
  readonly search: string;
  readonly intentionalWorkspaceAccess: boolean;
  navigate: (path: string, options?: { readonly replace?: boolean }) => void;
  navigateToOwnWorkspace: () => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [route, setRoute] = useState<PortalRoute>(() => parsePortalRoute(window.location.pathname));
  const [appRoute, setAppRoute] = useState<AppRoute>(() => parseAppRoute(window.location.pathname));
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [search, setSearch] = useState(() => window.location.search);
  const [intentionalWorkspaceAccess, setIntentionalWorkspaceAccess] = useState(false);

  useEffect(() => {
    const onPopState = (): void => { setIntentionalWorkspaceAccess(false); setRoute(parsePortalRoute(window.location.pathname)); setAppRoute(parseAppRoute(window.location.pathname)); setPathname(window.location.pathname); setSearch(window.location.search); };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((path: string, options?: { readonly replace?: boolean }): void => {
    if (path === window.location.pathname) return;
    if (!path.startsWith("/companies") && !path.startsWith("/onboarding/") && path !== "/dashboard" && path !== "/conversations" && path !== "/analytics" && path !== "/settings" && path !== "/activation-pending") setIntentionalWorkspaceAccess(false);
    if (options?.replace) window.history.replaceState({}, "", path);
    else window.history.pushState({}, "", path);
    setRoute(parsePortalRoute(path)); setAppRoute(parseAppRoute(path)); setPathname(path); setSearch("");
  }, []);
  const navigateToOwnWorkspace = useCallback((): void => { setIntentionalWorkspaceAccess(true); navigate("/companies"); }, [navigate]);

  const value = useMemo<RouterValue>(() => ({ route, appRoute, pathname, search, intentionalWorkspaceAccess, navigate, navigateToOwnWorkspace }), [route, appRoute, pathname, search, intentionalWorkspaceAccess, navigate, navigateToOwnWorkspace]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error("useRouter must be used within RouterProvider.");
  return value;
}
