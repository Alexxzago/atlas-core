import { useEffect, useRef, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { Button, Stack, Surface } from "../design-system/primitives";
import { PasswordField } from "../design-system/PasswordField";
import { useI18n } from "../i18n/I18nContext";

type State = "form" | "submitting" | "invalid" | "success" | "unavailable";

export function GuidedResetPassword({ proof, onSignIn }: { readonly proof: string; readonly onSignIn: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const [resetProof] = useState(proof), [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState(""), [state, setState] = useState<State>(proof ? "form" : "invalid"), [mismatch, setMismatch] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (resetProof) window.history.replaceState(window.history.state, "", "/reset-password"); }, [resetProof]);
  useEffect(() => { heading.current?.focus(); }, [state]);
  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault(); setMismatch(false);
    if (password !== confirmation) { setMismatch(true); return; }
    setState("submitting");
    try { await atlasApi.completePasswordReset(resetProof, password, confirmation); setState("success"); }
    catch (cause: unknown) { setState(cause instanceof ApiError && cause.status === 400 ? "invalid" : "unavailable"); }
  };
  if (state === "invalid") return <Surface className="auth-card" tone="raised"><Stack gap="4"><div className="auth-card__header"><h1 ref={heading} tabIndex={-1}>{t("passwordRecovery.reset.invalid.title")}</h1></div><p aria-live="polite" role="status">{t("passwordRecovery.reset.invalid.description")}</p><Button className="auth-card__submit" onClick={onSignIn}>{t("passwordRecovery.signIn")}</Button></Stack></Surface>;
  if (state === "success") return <Surface className="auth-card" tone="raised"><Stack gap="4"><div className="auth-card__header"><h1 ref={heading} tabIndex={-1}>{t("passwordRecovery.reset.success.title")}</h1></div><p aria-live="polite" role="status">{t("passwordRecovery.reset.success.description")}</p><Button className="auth-card__submit" onClick={onSignIn}>{t("passwordRecovery.signIn")}</Button></Stack></Surface>;
  return <Surface className="auth-card" tone="raised"><form noValidate onSubmit={(event) => void submit(event)}><div className="auth-card__header"><h1 ref={heading} tabIndex={-1}>{t("passwordRecovery.reset.title")}</h1><p>{t("passwordRecovery.reset.description")}</p></div><PasswordField autoComplete="new-password" id="password-reset-new" label={t("passwordRecovery.newPassword")} minLength={15} name="password" required showLabel={t("auth.password.show")} hideLabel={t("auth.password.hide")} value={password} onChange={(event) => { setPassword(event.target.value); setMismatch(false); }} /><PasswordField autoComplete="new-password" error={mismatch ? t("passwordRecovery.reset.mismatch") : null} id="password-reset-confirmation" label={t("passwordRecovery.confirmPassword")} minLength={15} name="confirmation" required showLabel={t("auth.password.show")} hideLabel={t("auth.password.hide")} value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setMismatch(false); }} />{state === "unavailable" && <p aria-live="polite" role="alert">{t("passwordRecovery.reset.unavailable")}</p>}<div className="auth-card__actions"><Button className="auth-card__submit" type="submit" disabled={state === "submitting"}>{t(state === "submitting" ? "passwordRecovery.reset.loading" : "passwordRecovery.reset.submit")}</Button><button className="auth-card__link" type="button" onClick={onSignIn}>{t("passwordRecovery.signIn")}</button></div></form></Surface>;
}
