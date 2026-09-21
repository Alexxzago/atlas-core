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
    const target = new URL(path, window.location.origin);
    if (target.pathname === window.location.pathname && target.search === window.location.search) return;
    if (!target.pathname.startsWith("/companies") && !target.pathname.startsWith("/onboarding/") && target.pathname !== "/dashboard" && target.pathname !== "/conversations" && target.pathname !== "/analytics" && target.pathname !== "/billing" && target.pathname !== "/settings" && target.pathname !== "/activation-pending") setIntentionalWorkspaceAccess(false);
    const destination = `${target.pathname}${target.search}${target.hash}`;
    if (options?.replace) window.history.replaceState({}, "", destination);
    else window.history.pushState({}, "", destination);
    setRoute(parsePortalRoute(target.pathname)); setAppRoute(parseAppRoute(target.pathname)); setPathname(target.pathname); setSearch(target.search);
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
