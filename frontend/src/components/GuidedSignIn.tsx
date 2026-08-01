import { useRef, useState } from "react";
import { Button, Stack, Surface } from "../design-system/primitives";
import { useI18n } from "../i18n/I18nContext";
import { useAuthentication } from "../state/AuthenticationContext";
import { useRouter } from "../routing/RouterProvider";

export function GuidedSignIn(): React.JSX.Element {
  const { t } = useI18n(); const { navigate } = useRouter(); const { state: auth, login } = useAuthentication();
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const signIn = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault(); setLoading(true); setError(null);
    try { await login(email.trim(), password); }
    catch { setError(t("assistantSetup.signIn.invalid")); }
    finally { setLoading(false); }
  };
  if (auth.status === "authenticated") return <Surface className="guided-registration" tone="raised"><Stack gap="4"><p role="status">{t("assistantSetup.loading")}</p></Stack></Surface>;
  return <Surface className="guided-registration" tone="raised"><form onSubmit={(event) => void signIn(event)}><Stack gap="4"><h1 ref={heading} tabIndex={-1}>{t("assistantSetup.signIn.title")}</h1><p>{t("assistantSetup.signIn.description")}</p><label>{t("registration.field.email")}<input autoComplete="username" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>{t("registration.field.password")}<input autoComplete="current-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p role="alert">{error}</p>}<Button type="submit" disabled={loading}>{t(loading ? "assistantSetup.loading" : "assistantSetup.continue")}</Button><Button type="button" variant="secondary" onClick={() => navigate("/register")}>{t("guided.register.title")}</Button><Button type="button" variant="secondary" onClick={() => navigate("/forgot-password")}>{t("guided.forgot.title")}</Button></Stack></form></Surface>;
}
