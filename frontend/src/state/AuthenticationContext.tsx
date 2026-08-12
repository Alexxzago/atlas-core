import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { ApiError, atlasApi, setAuthenticationRecovery } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import { authenticationReducer, type AuthenticationState } from "./authenticationState";
import type { SessionBootstrapResponse } from "../types/api";

type ChannelMessage = { type: "csrf-rotated"; csrfToken: string; csrfGeneration: number; sessionIncarnation: string | null } | { type: "session-replaced"; sessionIncarnation: string } | { type: "logout" } | { type: "session-invalidated" };
interface AuthenticationValue { readonly state: AuthenticationState; bootstrap: () => Promise<boolean>; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; invalidate: () => void; }
const AuthenticationContext = createContext<AuthenticationValue | null>(null);
let bootstrapFlight: Promise<SessionBootstrapResponse> | null = null;
function bootstrapSingleFlight(): Promise<SessionBootstrapResponse> { if (!bootstrapFlight) bootstrapFlight = atlasApi.bootstrapSession().finally(() => { bootstrapFlight = null; }); return bootstrapFlight; }
const sessionIncarnationKey = "atlas-auth-session-incarnation";
function storedSessionIncarnation(): string | null { try { return localStorage.getItem(sessionIncarnationKey); } catch { return null; } }
function storeSessionIncarnation(value: string | null): void { try { if (value) localStorage.setItem(sessionIncarnationKey, value); else localStorage.removeItem(sessionIncarnationKey); } catch { /* Storage is optional cross-tab coordination. */ } }

export function AuthenticationProvider({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const { locale } = useI18n(); const [state, dispatch] = useReducer(authenticationReducer, { status: "booting" }); const epoch = useRef(0); const channel = useRef<BroadcastChannel | null>(null); const sessionIncarnation = useRef<string | null>(storedSessionIncarnation()); const logoutFlight = useRef<Promise<void> | null>(null);
  const genericError = (): string => locale === "es" ? "No pudimos completar la operación." : "We couldn't complete the operation.";
  const publish = (message: ChannelMessage): void => channel.current?.postMessage(message);
  const invalidate = (): void => { epoch.current += 1; dispatch({ type: "unauthenticated" }); };
  const publishRotation = (result: SessionBootstrapResponse): void => publish({ type: "csrf-rotated", csrfToken: result.csrfToken, csrfGeneration: result.csrfGeneration, sessionIncarnation: sessionIncarnation.current });
  const restoreSession = async (retryConflict = true): Promise<SessionBootstrapResponse | null> => {
    const currentEpoch = epoch.current;
    try { const result = await bootstrapSingleFlight(); if (epoch.current !== currentEpoch) return null; return result; }
    catch (cause: unknown) { if (epoch.current !== currentEpoch) return null; if (cause instanceof ApiError && cause.status === 409 && retryConflict) return restoreSession(false); if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) { dispatch({ type: "unauthenticated", ...(cause.status === 403 ? { error: genericError() } : {}) }); return null; } dispatch({ type: "retryable", error: genericError() }); return null; }
  };
  const bootstrap = async (): Promise<boolean> => { const result = await restoreSession(); if (!result) return false; dispatch({ type: "authenticated", result }); publishRotation(result); return true; };
  const login = async (email: string, password: string): Promise<void> => { const result = await atlasApi.login(email, password); const identity = await atlasApi.currentIdentity(); const replacement = crypto.randomUUID(); sessionIncarnation.current = replacement; storeSessionIncarnation(replacement); dispatch({ type: "authenticated", result: { status: "authenticated", identity, csrfToken: result.csrfToken, csrfGeneration: result.csrfGeneration } }); publish({ type: "session-replaced", sessionIncarnation: replacement }); };
  const logout = (): Promise<void> => {
    if (logoutFlight.current) return logoutFlight.current;
    const current = state;
    const execute = async (): Promise<void> => {
      if (current.status !== "authenticated") { storeSessionIncarnation(null); invalidate(); publish({ type: "logout" }); return; }
      try { await atlasApi.logout(current.csrfToken); }
      catch (cause: unknown) {
        if (!(cause instanceof ApiError) || cause.status !== 401) throw cause;
        const restored = await restoreSession();
        if (!restored) { storeSessionIncarnation(null); invalidate(); return; }
        dispatch({ type: "authenticated", result: restored }); publishRotation(restored);
        try { await atlasApi.logout(restored.csrfToken); } catch { storeSessionIncarnation(null); invalidate(); return; }
      }
      storeSessionIncarnation(null); invalidate(); publish({ type: "logout" });
    };
    logoutFlight.current = execute().finally(() => { logoutFlight.current = null; });
    return logoutFlight.current;
  };
  useEffect(() => { if (typeof BroadcastChannel === "undefined") return; const instance = new BroadcastChannel("atlas-auth"); channel.current = instance; instance.onmessage = (event: MessageEvent<ChannelMessage>) => { const message = event.data; if (message.type === "csrf-rotated") { if (message.sessionIncarnation === sessionIncarnation.current) dispatch({ type: "token", csrfToken: message.csrfToken, csrfGeneration: message.csrfGeneration }); } else if (message.type === "session-replaced") { sessionIncarnation.current = message.sessionIncarnation; storeSessionIncarnation(message.sessionIncarnation); invalidate(); void bootstrap(); } else { storeSessionIncarnation(null); invalidate(); } }; return () => { instance.close(); channel.current = null; }; }, []);
  useEffect(() => { let active = true; const start = (): void => { if (active && document.visibilityState === "visible") void bootstrap(); }; if (document.visibilityState === "visible") start(); else document.addEventListener("visibilitychange", start, { once: true }); return () => { active = false; document.removeEventListener("visibilitychange", start); }; }, []);
  useEffect(() => { setAuthenticationRecovery(async (method) => { const recovered = await bootstrap(); if (!recovered && method !== "GET" && method !== "HEAD") publish({ type: "session-invalidated" }); return recovered; }); return () => setAuthenticationRecovery(null); });
  const value = useMemo<AuthenticationValue>(() => ({ state, bootstrap: () => bootstrap(), login, logout, invalidate }), [state]);
  return <AuthenticationContext.Provider value={value}>{children}</AuthenticationContext.Provider>;
}
export function useAuthentication(): AuthenticationValue { const value = useContext(AuthenticationContext); if (!value) throw new Error("useAuthentication must be used within AuthenticationProvider."); return value; }
