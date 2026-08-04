import { useRef, useState } from "react";
import { ApiError } from "../api/atlasApi";
import { Button, Surface } from "../design-system/primitives";
import { Field, fieldDescribedBy } from "../design-system/Field";
import { PasswordField } from "../design-system/PasswordField";
import { useI18n } from "../i18n/I18nContext";
import { useAuthentication } from "../state/AuthenticationContext";
import { useRouter } from "../routing/RouterProvider";

export function GuidedSignIn(): React.JSX.Element {
  const { t } = useI18n(); const { navigate } = useRouter(); const { state: auth, login } = useAuthentication();
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null), [emailError, setEmailError] = useState<string | null>(null), [passwordError, setPasswordError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const signIn = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    const fields = new FormData(event.currentTarget), submittedEmail = fields.get("email"), submittedPassword = fields.get("password");
    event.preventDefault();
    const normalizedEmail = typeof submittedEmail === "string" ? submittedEmail.trim() : "";
    const nextEmailError = !normalizedEmail ? t("auth.validation.required") : !/^\S+@\S+\.\S+$/.test(normalizedEmail) ? t("auth.validation.email") : null;
    const nextPasswordError = typeof submittedPassword !== "string" || submittedPassword.length === 0 ? t("auth.validation.required") : null;
    setEmailError(nextEmailError); setPasswordError(nextPasswordError);
    if (nextEmailError || nextPasswordError || loading) return;
    setLoading(true); setError(null);
    try { await login(normalizedEmail, typeof submittedPassword === "string" ? submittedPassword : ""); }
    catch (cause: unknown) { setError(cause instanceof ApiError && cause.status === 401 ? t("assistantSetup.signIn.invalid") : t("assistantSetup.error.unavailable")); }
    finally { setLoading(false); }
  };
  if (auth.status === "authenticated") return <Surface className="auth-card" tone="raised"><p role="status">{t("assistantSetup.loading")}</p></Surface>;
  const link = (path: string) => (event: React.MouseEvent<HTMLAnchorElement>): void => { event.preventDefault(); navigate(path); };
  return <Surface className="auth-card" tone="raised"><form noValidate onSubmit={(event) => void signIn(event)}><div className="auth-card__header"><h1 ref={heading} tabIndex={-1}>{t("assistantSetup.signIn.title")}</h1><p>{t("assistantSetup.signIn.description")}</p></div><Field error={emailError} id="guided-sign-in-email" label={t("registration.field.email")}><input aria-describedby={fieldDescribedBy("guided-sign-in-email", false, Boolean(emailError))} aria-invalid={emailError ? true : undefined} autoComplete="email" className="ds-control" id="guided-sign-in-email" name="email" required type="email" value={email} onChange={(event) => { setEmail(event.target.value); setEmailError(null); }} /></Field><PasswordField autoComplete="current-password" error={passwordError} id="guided-sign-in-password" label={t("registration.field.password")} name="password" required showLabel={t("auth.password.show")} hideLabel={t("auth.password.hide")} value={password} onChange={(event) => { setPassword(event.target.value); setPasswordError(null); }} />{error && <p className="auth-card__alert" role="alert">{error}</p>}<div className="auth-card__actions"><Button className="auth-card__submit" type="submit" disabled={loading}>{t(loading ? "assistantSetup.loading" : "assistantSetup.continue")}</Button><a className="auth-card__link auth-card__recovery" href="/forgot-password" onClick={link("/forgot-password")}>{t("auth.signIn.forgot")}</a><p className="auth-card__prompt">{t("auth.signIn.createPrompt")} <a className="auth-card__link" href="/register" onClick={link("/register")}>{t("auth.signIn.createAction")}</a></p></div></form></Surface>;
}
