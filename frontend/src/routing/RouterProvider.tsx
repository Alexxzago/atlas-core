import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { parsePortalRoute, type PortalRoute } from "./routes";

interface RouterValue {
  readonly route: PortalRoute;
  navigate: (path: string, options?: { readonly replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [route, setRoute] = useState<PortalRoute>(() => parsePortalRoute(window.location.pathname));

  useEffect(() => {
    const onPopState = (): void => setRoute(parsePortalRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((path: string, options?: { readonly replace?: boolean }): void => {
    if (path === window.location.pathname) return;
    if (options?.replace) window.history.replaceState({}, "", path);
    else window.history.pushState({}, "", path);
    setRoute(parsePortalRoute(path));
  }, []);

  const value = useMemo<RouterValue>(() => ({ route, navigate }), [route, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error("useRouter must be used within RouterProvider.");
  return value;
}
