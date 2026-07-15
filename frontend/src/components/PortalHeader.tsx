import { useI18n } from "../i18n/I18nContext";
import type { Locale } from "../i18n/translations";

export function PortalHeader(): React.JSX.Element {
  const { locale, setLocale, t } = useI18n();
  return (
    <header className="portal-header">
      <div className="portal-brand"><strong>{t("app.brand")}</strong><span>{t("app.portal")}</span></div>
      <label className="language-selector">
        <span className="sr-only">{t("language.label")}</span>
        <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)} aria-label={t("language.label")}>
          <option value="es">{t("language.es")}</option>
          <option value="en">{t("language.en")}</option>
        </select>
      </label>
    </header>
  );
}
