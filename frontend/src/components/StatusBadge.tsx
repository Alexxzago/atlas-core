import { useI18n } from "../i18n/I18nContext";
import type { CompanyStatus } from "../types/api";

export function StatusBadge({ status }: { status: CompanyStatus }): React.JSX.Element {
  const { t } = useI18n();
  const details = {
    processing: { label: t("status.processing"), accessible: t("accessibility.processing"), symbol: "◌" },
    ready: { label: t("status.ready"), accessible: t("accessibility.ready"), symbol: "✓" },
    failed: { label: t("status.failed"), accessible: t("accessibility.failed"), symbol: "!" },
  }[status];
  return <span className={`status-badge status-badge--${status}`} aria-label={details.accessible}><span aria-hidden="true">{details.symbol}</span>{details.label}</span>;
}
