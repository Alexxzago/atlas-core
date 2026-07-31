import { useEffect, useReducer, useRef } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { Button, Skeleton, Stack, Surface } from "../design-system/primitives";
import { useI18n } from "../i18n/I18nContext";

type Step = "welcome" | "name" | "email" | "password" | "confirmation" | "requested" | "verified" | "invalid" | "unavailable";
interface State { step: Step; fullName: string; email: string; password: string; confirmation: string; loading: boolean; error: string | null; }
type Action = { type: "next" } | { type: "field"; field: "fullName" | "email" | "password" | "confirmation"; value: string } | { type: "error"; error: string } | { type: "requested" } | { type: "verified" | "invalid" | "unavailable" } | { type: "loading"; value: boolean };
const initialState: State = { step: "welcome", fullName: "", email: "", password: "", confirmation: "", loading: false, error: null };
const next: Record<Exclude<Step, "requested" | "verified" | "invalid" | "unavailable">, Step> = { welcome: "name", name: "email", email: "password", password: "confirmation", confirmation: "requested" };

function reducer(state: State, action: Action): State {
  if (action.type === "field") return { ...state, [action.field]: action.value, error: null };
  if (action.type === "next") return { ...state, step: next[state.step as keyof typeof next], error: null };
  if (action.type === "error") return { ...state, error: action.error, loading: false };
  if (action.type === "loading") return { ...state, loading: action.value, error: null };
  if (action.type === "requested") return { ...state, step: "requested", loading: false, error: null };
  return { ...state, step: action.type, loading: false, error: null };
}

function registrationError(error: unknown, invalid: string, unavailable: string): string { return error instanceof ApiError && error.status === 400 ? invalid : unavailable; }

export function GuidedRegistration({ verificationProof, onContinue }: { readonly verificationProof?: string; readonly onContinue?: () => void }): React.JSX.Element {
  const { locale, t } = useI18n();
  const [state, dispatch] = useReducer(reducer, verificationProof === undefined ? initialState : { ...initialState, step: "welcome", loading: true });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [state.step]);
  useEffect(() => {
    if (verificationProof === undefined) return;
    void atlasApi.verifyEmail(verificationProof).then((result) => dispatch({ type: result.status === "verified" ? "verified" : "invalid" })).catch(() => dispatch({ type: "unavailable" }));
  }, [verificationProof]);
  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (state.step === "confirmation") {
      if (state.password !== state.confirmation) { dispatch({ type: "error", error: t("registration.validation.match") }); return; }
      dispatch({ type: "loading", value: true });
      try { await atlasApi.register({ fullName: state.fullName.trim(), email: state.email.trim(), password: state.password, confirmation: state.confirmation, locale }); dispatch({ type: "requested" }); }
      catch (error: unknown) { dispatch({ type: "error", error: registrationError(error, t("registration.error.invalid"), t("registration.error.unavailable")) }); }
      return;
    }
    dispatch({ type: "next" });
  };
  const resend = async (): Promise<void> => { dispatch({ type: "loading", value: true }); try { await atlasApi.resendVerification(state.email.trim(), locale); dispatch({ type: "loading", value: false }); } catch (error: unknown) { dispatch({ type: "error", error: registrationError(error, t("registration.error.email"), t("registration.error.unavailable")) }); } };
  if (verificationProof !== undefined) return <Surface className="guided-registration" key={state.step} tone="raised"><Stack gap="4"><h1 ref={heading} tabIndex={-1}>{t(`registration.verify.${state.step}` as "registration.verify.verified")}</h1>{state.loading ? <Skeleton label={t("registration.loading")} /> : <p role="status" aria-live="polite">{t(`registration.verify.${state.step}.description` as "registration.verify.verified.description")}</p>}{state.step === "verified" && onContinue && <Button onClick={onContinue}>{t("registration.continue")}</Button>}</Stack></Surface>;
  if (state.step === "requested") return <Surface className="guided-registration" key={state.step} tone="raised"><Stack gap="4"><h1 ref={heading} tabIndex={-1}>{t("registration.requested.title")}</h1><p role="status" aria-live="polite">{t("registration.requested.description", { email: state.email })}</p><Button disabled={state.loading} onClick={() => void resend()}>{t(state.loading ? "registration.resend.loading" : "registration.resend")}</Button>{state.error && <p role="alert">{state.error}</p>}</Stack></Surface>;
  const field = state.step === "name" ? "fullName" : state.step === "email" ? "email" : state.step === "password" ? "password" : state.step === "confirmation" ? "confirmation" : null;
  const inputType = field === "email" ? "email" : field === "password" || field === "confirmation" ? "password" : "text";
  return <Surface className="guided-registration" key={state.step} tone="raised"><form onSubmit={(event) => void submit(event)}><Stack gap="4"><h1 ref={heading} tabIndex={-1}>{t(`registration.${state.step}.title` as "registration.welcome.title")}</h1><p aria-live="polite">{t(`registration.${state.step}.description` as "registration.welcome.description")}</p>{field && <label>{t(`registration.field.${field}` as "registration.field.fullName")}<input autoComplete={field === "fullName" ? "name" : field === "email" ? "email" : "new-password"} autoFocus required minLength={field === "password" || field === "confirmation" ? 12 : undefined} name={field} type={inputType} value={state[field]} onChange={(event) => dispatch({ type: "field", field, value: event.target.value })} /></label>}{state.error && <p role="alert">{state.error}</p>}<Button type="submit" disabled={state.loading}>{t(state.loading ? "registration.loading" : "registration.continue")}</Button></Stack></form></Surface>;
}
