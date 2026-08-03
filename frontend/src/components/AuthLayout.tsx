import type { ReactNode } from "react";
import { ThemeSelector } from "./ThemeSelector";
import { useI18n } from "../i18n/I18nContext";

export function AuthLayout({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const { t } = useI18n();
  return <main className="auth-layout" id="main-content">
    <header className="auth-layout__header"><a aria-label="Atlas" className="auth-layout__brand" href="/"><strong>ATLAS</strong><span>{t("app.portal")}</span></a><ThemeSelector /></header>
    <section className="auth-layout__content">{children}</section>
  </main>;
}
