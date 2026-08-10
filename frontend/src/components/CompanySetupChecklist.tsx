import { useCallback, useEffect, useState } from "react";
import { atlasApi } from "../api/atlasApi";
import { DashboardPage } from "../dashboard/DashboardPage";
import { buildCompanyWorkspaceViewModel, type CompanyWorkspaceSnapshot } from "../dashboard/dashboardPresentation";
import type { Company, WorkspaceSummary } from "../types/api";

interface Props {
  readonly workspace: WorkspaceSummary;
  readonly companies: readonly Company[];
  readonly company: Company;
  readonly onNavigate: (path: string) => void;
  readonly onChooseCompany: () => void;
}

export function CompanySetupChecklist({ workspace, companies, company, onNavigate, onChooseCompany }: Props): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<CompanyWorkspaceSnapshot | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [generation, setGeneration] = useState(0);
  const retry = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(() => {
    let current = true;
    setSnapshot(null); setUnavailable(false);
    void Promise.all([
    atlasApi.getAssistantReadiness(workspace.id, company.id),
    atlasApi.listWebChatConnections(workspace.id, company.id),
    atlasApi.listWhatsAppConnections(workspace.id, company.id),
  ]).then(async ([readiness, webChat, whatsApp]) => {
    const whatsAppStatuses = await Promise.all(
      whatsApp.map((connection) =>
        atlasApi.getWhatsAppConnectionStatus(
          workspace.id,
          company.id,
          connection.id
        )
      )
    );

    if (current) {
      setSnapshot({
        readiness,
        webChatConnections: webChat.length,
        whatsAppConnections: whatsApp.length,
        operationalWebChatConnections: webChat.filter(
          (connection) => connection.status === "active"
        ).length,
        operationalWhatsAppConnections: whatsAppStatuses.filter(
          (status) =>
            status.connection.status === "active" &&
            status.validationState === "valid"
        ).length,
      });
    }
  }).catch(() => {
    if (current) setUnavailable(true);
  });
    return () => { current = false; };
  }, [workspace.id, company.id, generation]);

  const model = buildCompanyWorkspaceViewModel({ workspace, companies, company, snapshot, loading: !snapshot && !unavailable, unavailable });
  return <DashboardPage model={model} onNavigate={onNavigate} onRetry={retry} onChooseCompany={onChooseCompany}/>;
}
