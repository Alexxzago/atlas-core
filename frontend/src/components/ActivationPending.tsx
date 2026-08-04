import { useEffect, useState } from "react";
import { atlasApi } from "../api/atlasApi";
import { Stack, Surface } from "../design-system/primitives";
import { useI18n } from "../i18n/I18nContext";
import { useAuthentication } from "../state/AuthenticationContext";
import { useAuthenticatedPortal } from "../state/AuthenticatedPortalProvider";
import type { AssistantReadinessAssessment } from "../types/api";

export function ActivationPending(): React.JSX.Element {
  const { t } = useI18n(); const { state: auth } = useAuthentication(); const { selectedWorkspace, selectedCompany } = useAuthenticatedPortal(); const [readiness, setReadiness] = useState<AssistantReadinessAssessment | null>(null);
  useEffect(() => { if (!selectedWorkspace || !selectedCompany || auth.status !== "authenticated") return; void atlasApi.refreshAssistantReadiness(auth.csrfToken, selectedWorkspace.id, selectedCompany.id).then(setReadiness).catch(() => setReadiness(null)); }, [auth, selectedWorkspace?.id, selectedCompany?.id]);
  return <Surface className="auth-card" tone="raised"><Stack gap="4"><div className="auth-card__header"><h1 tabIndex={-1}>{t("activationPending.title")}</h1></div><p role="status" aria-live="polite">{readiness ? readiness.status === "ready" ? t("activationPending.ready") : t("activationPending.blocked", { blockers: readiness.blockers.join(", ") }) : t("activationPending.description")}</p></Stack></Surface>;
}
