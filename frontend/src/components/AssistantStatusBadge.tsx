import { useI18n } from "../i18n/I18nContext";
import type { AssistantProfileStatus } from "../types/api";

export function AssistantStatusBadge({ status }: { status: AssistantProfileStatus }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <span className={`assistant-status-badge assistant-status-badge--${status}`}>
      <span className="assistant-status-badge__dot" aria-hidden="true" />
      <span className="assistant-status-badge__text">{t(`profiles.status.${status}`)}</span>
    </span>
  );
}
