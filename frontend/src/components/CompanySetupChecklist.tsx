import { useEffect, useState } from "react";
import { atlasApi } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import { useRouter } from "../routing/RouterProvider";
import type { AssistantReadinessAssessment, AssistantProfile } from "../types/api";

interface Props { readonly workspaceId: string; readonly companyId: number; readonly profiles: readonly AssistantProfile[]; }
type ChecklistState = { readonly readiness: AssistantReadinessAssessment; readonly webChatConnections: number; readonly whatsAppConnections: number; } | null;

function blockerKey(blocker: string): "whatsapp.blocker.defaultAssistantMissing" | "whatsapp.blocker.publishedKnowledgeMissing" | "whatsapp.blocker.generic" {
  if (blocker === "default_assistant_missing") return "whatsapp.blocker.defaultAssistantMissing";
  if (blocker === "published_knowledge_missing") return "whatsapp.blocker.publishedKnowledgeMissing";
  return "whatsapp.blocker.generic";
}

export function CompanySetupChecklist({ workspaceId, companyId, profiles }: Props): React.JSX.Element {
  const { t } = useI18n(); const { navigate } = useRouter(); const [state, setState] = useState<ChecklistState>(null); const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    setState(null); setError(false);
    void Promise.all([atlasApi.getAssistantReadiness(workspaceId, companyId), atlasApi.listWebChatConnections(workspaceId, companyId), atlasApi.listWhatsAppConnections(workspaceId, companyId)])
      .then(([readiness, webChat, whatsApp]) => { if (current) setState({ readiness, webChatConnections: webChat.length, whatsAppConnections: whatsApp.length }); })
      .catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [workspaceId, companyId]);
  const item = (title: Parameters<typeof t>[0], complete: boolean, path: string): React.JSX.Element => <li><button className="button button--secondary" type="button" onClick={() => navigate(path)}><strong>{t(title)}</strong><span>{t(complete ? "companySetup.complete" : "companySetup.incomplete")}</span></button></li>;
  return <section className="authenticated-section"><div className="section-heading"><div><h2>{t("companySetup.title")}</h2></div></div>
    {error && <p role="alert">{t("companySetup.unavailable")}</p>}
    {!state && !error && <p role="status">{t("common.loading")}</p>}
    {state && <><ul className="whatsapp-steps">
      {item("companySetup.profile", profiles.some((profile) => profile.status === "ready"), `/companies/${companyId}/assistant`)}
      {item("companySetup.knowledge", state.readiness.knowledgeVersionId !== null, `/companies/${companyId}/knowledge`)}
      {item("companySetup.channels", state.webChatConnections + state.whatsAppConnections > 0, `/companies/${companyId}/channels`)}
      {item("companySetup.whatsapp", state.whatsAppConnections > 0, `/companies/${companyId}/channels/whatsapp`)}
      {item("companySetup.readiness", state.readiness.status === "ready", `/companies/${companyId}/channels/whatsapp`)}
    </ul>
    {state.readiness.status === "blocked" && <ul>{state.readiness.blockers.map((blocker) => <li key={blocker}>{t(blockerKey(blocker))}</li>)}</ul>}
    <h3>{t("companySetup.orderTitle")}</h3><ol>{["companySetup.order.profile", "companySetup.order.profileReady", "companySetup.order.default", "companySetup.order.knowledge", "companySetup.order.publish", "companySetup.order.connection", "companySetup.order.credentials", "companySetup.order.validate", "companySetup.order.activate"].map((key) => <li key={key}>{t(key as Parameters<typeof t>[0])}</li>)}</ol></>}
  </section>;
}
