import { Stack, Surface } from "../design-system/primitives";
import { useI18n } from "../i18n/I18nContext";

export function ActivationPending(): React.JSX.Element {
  const { t } = useI18n();
  return <Surface className="guided-registration" tone="raised"><Stack gap="4"><h1 tabIndex={-1}>{t("activationPending.title")}</h1><p role="status" aria-live="polite">{t("activationPending.description")}</p></Stack></Surface>;
}
