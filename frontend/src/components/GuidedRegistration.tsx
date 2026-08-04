import { useEffect, useReducer, useRef } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { Button, Skeleton, Stack, Surface } from "../design-system/primitives";
import { Field, fieldDescribedBy } from "../design-system/Field";
import { PasswordField } from "../design-system/PasswordField";
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
  if (verificationProof !== undefined) return <Surface className="auth-card" key={state.step} tone="raised"><Stack gap="4"><div className="auth-card__header"><h1 ref={heading} tabIndex={-1}>{t(`registration.verify.${state.step}` as "registration.verify.verified")}</h1></div>{state.loading ? <Skeleton label={t("registration.loading")} /> : <p role="status" aria-live="polite">{t(`registration.verify.${state.step}.description` as "registration.verify.verified.description")}</p>}{state.step === "verified" && onContinue && <Button className="auth-card__submit" onClick={onContinue}>{t("registration.continue")}</Button>}</Stack></Surface>;
  if (state.step === "requested") return <Surface className="auth-card" key={state.step} tone="raised"><Stack gap="4"><div className="auth-card__header"><h1 ref={heading} tabIndex={-1}>{t("registration.requested.title")}</h1></div><p role="status" aria-live="polite">{t("registration.requested.description", { email: state.email })}</p><Button className="auth-card__submit" disabled={state.loading} onClick={() => void resend()}>{t(state.loading ? "registration.resend.loading" : "registration.resend")}</Button>{state.error && <p role="alert">{state.error}</p>}</Stack></Surface>;
  const field = state.step === "name" ? "fullName" : state.step === "email" ? "email" : state.step === "password" ? "password" : state.step === "confirmation" ? "confirmation" : null;
  const id = field ? `guided-registration-${field}` : "guided-registration-welcome";
  const label = field ? t(`registration.field.${field}` as "registration.field.fullName") : "";
  const value = field ? state[field] : "";
  const change = field ? (event: React.ChangeEvent<HTMLInputElement>): void => dispatch({ type: "field", field, value: event.target.value }) : undefined;
  return <Surface className="auth-card" key={state.step} tone="raised"><form noValidate onSubmit={(event) => void submit(event)}><div className="auth-card__header"><h1 ref={heading} tabIndex={-1}>{t(`registration.${state.step}.title` as "registration.welcome.title")}</h1><p aria-live="polite">{t(`registration.${state.step}.description` as "registration.welcome.description")}</p></div>{field === "password" || field === "confirmation" ? <PasswordField autoComplete="new-password" id={id} label={label} minLength={12} name={field} required showLabel={t("auth.password.show")} hideLabel={t("auth.password.hide")} value={value} onChange={change} /> : field && <Field id={id} label={label}><input aria-describedby={fieldDescribedBy(id, false, false)} autoComplete={field === "fullName" ? "name" : "email"} autoFocus className="ds-control" id={id} name={field} required type={field === "email" ? "email" : "text"} value={value} onChange={change} /></Field>}{state.error && <p role="alert">{state.error}</p>}<Button className="auth-card__submit" type="submit" disabled={state.loading}>{t(state.loading ? "registration.loading" : "registration.continue")}</Button></form></Surface>;
}
