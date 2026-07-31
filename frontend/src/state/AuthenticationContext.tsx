import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { ApiError, atlasApi, setAuthenticationRecovery } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import { authenticationReducer, type AuthenticationState } from "./authenticationState";
import type { SessionBootstrapResponse } from "../types/api";

type ChannelMessage = { type: "csrf-rotated"; csrfToken: string; csrfGeneration: number } | { type: "logout" } | { type: "session-invalidated" };
interface AuthenticationValue { readonly state: AuthenticationState; bootstrap: () => Promise<boolean>; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; invalidate: () => void; }
const AuthenticationContext = createContext<AuthenticationValue | null>(null);
let bootstrapFlight: Promise<SessionBootstrapResponse> | null = null;
function bootstrapSingleFlight(): Promise<SessionBootstrapResponse> { if (!bootstrapFlight) bootstrapFlight = atlasApi.bootstrapSession().finally(() => { bootstrapFlight = null; }); return bootstrapFlight; }

export function AuthenticationProvider({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const { locale } = useI18n(); const [state, dispatch] = useReducer(authenticationReducer, { status: "booting" }); const epoch = useRef(0); const channel = useRef<BroadcastChannel | null>(null);
  const genericError = (): string => locale === "es" ? "No pudimos completar la operación." : "We couldn't complete the operation.";
  const publish = (message: ChannelMessage): void => channel.current?.postMessage(message);
  const invalidate = (): void => { epoch.current += 1; dispatch({ type: "unauthenticated" }); };
  const bootstrap = async (retryConflict = true): Promise<boolean> => {
    const currentEpoch = epoch.current;
    try { const result = await bootstrapSingleFlight(); if (epoch.current !== currentEpoch) return false; dispatch({ type: "authenticated", result }); publish({ type: "csrf-rotated", csrfToken: result.csrfToken, csrfGeneration: result.csrfGeneration }); return true; }
    catch (cause: unknown) { if (epoch.current !== currentEpoch) return false; if (cause instanceof ApiError && cause.status === 409 && retryConflict) return bootstrap(false); if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) { dispatch({ type: "unauthenticated", ...(cause.status === 403 ? { error: genericError() } : {}) }); return false; } dispatch({ type: "retryable", error: genericError() }); return false; }
  };
  const login = async (email: string, password: string): Promise<void> => { const result = await atlasApi.login(email, password); const identity = await atlasApi.currentIdentity(); dispatch({ type: "authenticated", result: { status: "authenticated", identity, csrfToken: result.csrfToken, csrfGeneration: result.csrfGeneration } }); publish({ type: "csrf-rotated", csrfToken: result.csrfToken, csrfGeneration: result.csrfGeneration }); };
  const logout = async (): Promise<void> => { if (state.status === "authenticated") await atlasApi.logout(state.csrfToken); invalidate(); publish({ type: "logout" }); };
  useEffect(() => { if (typeof BroadcastChannel === "undefined") return; const instance = new BroadcastChannel("atlas-auth"); channel.current = instance; instance.onmessage = (event: MessageEvent<ChannelMessage>) => { const message = event.data; if (message.type === "csrf-rotated") dispatch({ type: "token", csrfToken: message.csrfToken, csrfGeneration: message.csrfGeneration }); else invalidate(); }; return () => { instance.close(); channel.current = null; }; }, []);
  useEffect(() => { let active = true; const start = (): void => { if (active && document.visibilityState === "visible") void bootstrap(); }; if (document.visibilityState === "visible") start(); else document.addEventListener("visibilitychange", start, { once: true }); return () => { active = false; document.removeEventListener("visibilitychange", start); }; }, []);
  useEffect(() => { setAuthenticationRecovery(async (method) => { const recovered = await bootstrap(); if (!recovered && method !== "GET" && method !== "HEAD") publish({ type: "session-invalidated" }); return recovered; }); return () => setAuthenticationRecovery(null); });
  const value = useMemo<AuthenticationValue>(() => ({ state, bootstrap: () => bootstrap(), login, logout, invalidate }), [state]);
  return <AuthenticationContext.Provider value={value}>{children}</AuthenticationContext.Provider>;
}
export function useAuthentication(): AuthenticationValue { const value = useContext(AuthenticationContext); if (!value) throw new Error("useAuthentication must be used within AuthenticationProvider."); return value; }
