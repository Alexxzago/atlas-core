import { useEffect, useRef, useState } from "react";
import { atlasApi } from "../api/atlasApi";
import { Button, Stack, Surface } from "../design-system/primitives";
import { Field, fieldDescribedBy } from "../design-system/Field";
import { useI18n } from "../i18n/I18nContext";

export function GuidedForgotPassword({ onSignIn }: { readonly onSignIn: () => void }): React.JSX.Element {
  const { locale, t } = useI18n();
  const [email, setEmail] = useState(""), [submitting, setSubmitting] = useState(false), [requested, setRequested] = useState(false), [error, setError] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [requested]);
  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault(); setSubmitting(true); setError(false);
    try { await atlasApi.requestPasswordReset(email.trim(), locale); setRequested(true); }
    catch { setError(true); }
    finally { setSubmitting(false); }
  };
  if (requested) return <Surface className="auth-card" tone="raised"><Stack gap="4"><div className="auth-card__header"><h1 ref={heading} tabIndex={-1}>{t("passwordRecovery.request.success.title")}</h1></div><p aria-live="polite" role="status">{t("passwordRecovery.request.success.description")}</p><Button className="auth-card__submit" onClick={onSignIn}>{t("passwordRecovery.signIn")}</Button></Stack></Surface>;
  return <Surface className="auth-card" tone="raised"><form noValidate onSubmit={(event) => void submit(event)}><div className="auth-card__header"><h1 ref={heading} tabIndex={-1}>{t("passwordRecovery.request.title")}</h1><p>{t("passwordRecovery.request.description")}</p></div><Field id="password-reset-email" label={t("passwordRecovery.email")}><input aria-describedby={fieldDescribedBy("password-reset-email", false, false)} autoComplete="email" className="ds-control" id="password-reset-email" name="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>{error && <p aria-live="polite" role="alert">{t("passwordRecovery.request.unavailable")}</p>}<div className="auth-card__actions"><Button className="auth-card__submit" type="submit" disabled={submitting}>{t(submitting ? "passwordRecovery.request.loading" : "passwordRecovery.request.submit")}</Button><button className="auth-card__link" type="button" onClick={onSignIn}>{t("passwordRecovery.signIn")}</button></div></form></Surface>;
}
