import { useEffect, useRef, useState } from "react";
import { atlasApi } from "../api/atlasApi";
import { Button, Stack, Surface } from "../design-system/primitives";
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
  if (requested) return <Surface className="guided-registration" tone="raised"><Stack gap="4"><h1 ref={heading} tabIndex={-1}>{t("passwordRecovery.request.success.title")}</h1><p aria-live="polite" role="status">{t("passwordRecovery.request.success.description")}</p><Button onClick={onSignIn}>{t("passwordRecovery.signIn")}</Button></Stack></Surface>;
  return <Surface className="guided-registration" tone="raised"><form onSubmit={(event) => void submit(event)}><Stack gap="4"><h1 ref={heading} tabIndex={-1}>{t("passwordRecovery.request.title")}</h1><p>{t("passwordRecovery.request.description")}</p><label htmlFor="password-reset-email">{t("passwordRecovery.email")}<input id="password-reset-email" name="email" autoComplete="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>{error && <p aria-live="polite" role="alert">{t("passwordRecovery.request.unavailable")}</p>}<Button type="submit" disabled={submitting}>{t(submitting ? "passwordRecovery.request.loading" : "passwordRecovery.request.submit")}</Button><Button type="button" variant="secondary" onClick={onSignIn}>{t("passwordRecovery.signIn")}</Button></Stack></form></Surface>;
}
