import { useEffect, type ReactNode } from "react";
import { useI18n } from "../i18n/I18nContext";
import { ErrorState } from "../design-system/feedback";

export function RouteLoadingBoundary({ loading, children }: { readonly loading: boolean; readonly children: ReactNode }): React.JSX.Element {
  const { t } = useI18n();
  return loading ? <div className="route-boundary route-boundary--loading" role="status" aria-label={t("shell.loadingRoute")}><div className="route-skeleton"><span/><span/><span/><span/><span/></div><p>{t("shell.loadingRoute")}</p></div> : <>{children}</>;
}

export function RouteErrorBoundary({ active, onBack, children }: { readonly active: boolean; readonly onBack: () => void; readonly children: ReactNode }): React.JSX.Element {
  const { t } = useI18n();
  useEffect(() => { if (active) document.getElementById("main-content")?.focus(); }, [active]);
  if (!active) return <>{children}</>;
  return <div className="route-boundary"><ErrorState title={t("shell.routeUnavailableTitle")} description={t("shell.routeUnavailableDescription")} action={<button className="button button--secondary" type="button" onClick={onBack}>{t("shell.returnToCompanies")}</button>} /></div>;
}
