import { useEffect, useState } from "react";
import { atlasApi } from "../api/atlasApi";
import { Button, Stack, Surface } from "../design-system/primitives";
import { useI18n } from "../i18n/I18nContext";
import { useAuthentication } from "../state/AuthenticationContext";
import { useAuthenticatedPortal } from "../state/AuthenticatedPortalProvider";
import type { AssistantReadinessAssessment } from "../types/api";
import { Callout, ProductHero } from "../design-system/product";
import { useRouter } from "../routing/RouterProvider";

export function ActivationPending(): React.JSX.Element {
  const { t } = useI18n(); const { navigate } = useRouter(); const { state: auth } = useAuthentication(); const { selectedWorkspace, selectedCompany } = useAuthenticatedPortal(); const [readiness, setReadiness] = useState<AssistantReadinessAssessment | null>(null); const [loading, setLoading] = useState(false);
  const refresh = (): void => { if (!selectedWorkspace || !selectedCompany || auth.status !== "authenticated") return; setLoading(true); void atlasApi.refreshAssistantReadiness(auth.csrfToken, selectedWorkspace.id, selectedCompany.id).then(setReadiness).catch(() => setReadiness(null)).finally(() => setLoading(false)); };
  useEffect(refresh, [auth, selectedWorkspace?.id, selectedCompany?.id]);
  const destination = selectedCompany ? `/companies/${selectedCompany.id}` : "/dashboard";
  return <Surface tone="raised"><Stack gap="5"><ProductHero title={t("activationPending.title")} description={t("activationPending.description")}/>{readiness?.status === "ready" ? <Callout tone="success" title={t("activationPending.ready")}><p>{t("activationPending.description")}</p></Callout> : <Callout tone="warning" title={t("activationPending.blocked", { blockers: "" })}><p>{t("activationPending.description")}</p></Callout>}<Button onClick={refresh} disabled={loading}>{t("common.retry")}</Button><Button variant="secondary" onClick={() => navigate(destination)}>{t("guided.action")}</Button></Stack></Surface>;
}
