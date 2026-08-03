import { useI18n } from "../i18n/I18nContext";
import { Button, Spinner } from "../design-system/primitives";

interface Props { readonly unavailable?: boolean; readonly onRetry?: () => void; }

export function StartupState({ unavailable = false, onRetry }: Props): React.JSX.Element {
  const { t } = useI18n();
  return <main className="startup-state" id="main-content">
    <section className="startup-state__card" aria-labelledby="startup-title" {...(unavailable ? { role: "alert" } : {})}>
      <div className="startup-state__brand" aria-label="Atlas">ATLAS</div>
      {unavailable ? <><h1 id="startup-title">{t("startup.unavailable")}</h1><p>{t("startup.unavailableDescription")}</p>{onRetry && <Button onClick={onRetry}>{t("startup.retry")}</Button>}</> : <><Spinner label={t("startup.loading")} /><h1 id="startup-title">{t("startup.loading")}</h1><p>{t("startup.loadingDescription")}</p></>}
    </section>
  </main>;
}
