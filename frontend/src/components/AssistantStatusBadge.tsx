import { useI18n } from "../i18n/I18nContext";
import type { AssistantProfileStatus } from "../types/api";

export function AssistantStatusBadge({ status }: { status: AssistantProfileStatus }): React.JSX.Element {
  const { t } = useI18n();
  return <span className={`assistant-status-badge assistant-status-badge--${status}`}>{t(`profiles.status.${status}`)}</span>;
}
