import { useEffect, useRef, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { Button, Stack, Surface } from "../design-system/primitives";
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
  if (state === "invalid") return <Surface className="guided-registration" tone="raised"><Stack gap="4"><h1 ref={heading} tabIndex={-1}>{t("passwordRecovery.reset.invalid.title")}</h1><p aria-live="polite" role="status">{t("passwordRecovery.reset.invalid.description")}</p><Button onClick={onSignIn}>{t("passwordRecovery.signIn")}</Button></Stack></Surface>;
  if (state === "success") return <Surface className="guided-registration" tone="raised"><Stack gap="4"><h1 ref={heading} tabIndex={-1}>{t("passwordRecovery.reset.success.title")}</h1><p aria-live="polite" role="status">{t("passwordRecovery.reset.success.description")}</p><Button onClick={onSignIn}>{t("passwordRecovery.signIn")}</Button></Stack></Surface>;
  return <Surface className="guided-registration" tone="raised"><form onSubmit={(event) => void submit(event)}><Stack gap="4"><h1 ref={heading} tabIndex={-1}>{t("passwordRecovery.reset.title")}</h1><p>{t("passwordRecovery.reset.description")}</p><label htmlFor="password-reset-new">{t("passwordRecovery.newPassword")}<input id="password-reset-new" name="password" autoComplete="new-password" required minLength={15} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label htmlFor="password-reset-confirmation">{t("passwordRecovery.confirmPassword")}<input id="password-reset-confirmation" name="confirmation" autoComplete="new-password" required minLength={15} type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>{mismatch && <p aria-live="polite" role="alert">{t("passwordRecovery.reset.mismatch")}</p>}{state === "unavailable" && <p aria-live="polite" role="alert">{t("passwordRecovery.reset.unavailable")}</p>}<Button type="submit" disabled={state === "submitting"}>{t(state === "submitting" ? "passwordRecovery.reset.loading" : "passwordRecovery.reset.submit")}</Button><Button type="button" variant="secondary" onClick={onSignIn}>{t("passwordRecovery.signIn")}</Button></Stack></form></Surface>;
}
