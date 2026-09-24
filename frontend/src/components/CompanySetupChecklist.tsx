import { useCallback, useEffect, useState } from "react";
import { atlasApi } from "../api/atlasApi";
import { ActivationJourney } from "./ActivationJourney";
import { PilotReadinessPanel } from "./PilotReadinessPanel";
import type { Company, WorkspaceSummary } from "../types/api";
import { ContextBackLink } from "./ContextBackLink";
import { Button } from "../design-system/primitives";

interface Props {
  readonly csrf: string;
  readonly workspace: WorkspaceSummary;
  readonly companies: readonly Company[];
  readonly company: Company;
  readonly onNavigate: (path: string) => void;
  readonly onChooseCompany: () => void;
}

interface ConfirmedProjection {
  readonly scope: string;
  readonly readiness: import("../types/api").PilotReadiness;
  readonly activation: import("../types/api").ActivationProjection;
}

export function CompanySetupChecklist({ csrf, workspace, companies, company, onNavigate, onChooseCompany }: Props): React.JSX.Element {
  const [confirmed, setConfirmed] = useState<ConfirmedProjection | null>(null);
  const [unavailableScope, setUnavailableScope] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [generation, setGeneration] = useState(0);
  const retry = useCallback(() => setGeneration((value) => value + 1), []);
  const scope = `${workspace.id}:${company.id}`;
  const projection = confirmed?.scope === scope ? confirmed : null;

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const hasConfirmedProjection = confirmed?.scope === scope;
    setRefreshing(hasConfirmedProjection);
    if (!hasConfirmedProjection) setUnavailableScope(null);
    void Promise.all([atlasApi.getPilotReadiness(workspace.id, company.id, controller.signal), atlasApi.getActivation(workspace.id, company.id, controller.signal)]).then(([readiness, activation]) => {
      if (!current) return;
      setConfirmed({ scope, readiness, activation });
      setUnavailableScope(null);
      setRefreshing(false);
    }).catch((error: unknown) => {
      if (!current || error instanceof DOMException && error.name === "AbortError") return;
      setUnavailableScope(scope);
      setRefreshing(false);
    });
    return () => { current = false; controller.abort(); };
  }, [workspace.id, company.id, generation]);

  if (!projection && unavailableScope !== scope) return <div className="today-workspace today-workspace--loading" aria-busy="true"><p role="status">Verificando el estado de activación...</p></div>;
  if (!projection) return <><ContextBackLink href="/dashboard" label="Volver al inicio" onNavigate={event=>{event.preventDefault();onNavigate("/dashboard");}}/><div className="today-workspace today-workspace--unavailable"><header className="work-anchor"><h1>Activación</h1><p role="alert">Estado temporalmente no disponible</p><Button className="next-action" onClick={retry}>Reintentar</Button></header></div></>;
  return <><ContextBackLink href="/dashboard" label="Volver al inicio" onNavigate={event=>{event.preventDefault();onNavigate("/dashboard");}}/><ActivationJourney csrf={csrf} workspaceId={workspace.id} companyId={company.id} projection={projection.activation} onNavigate={onNavigate} onRefresh={retry} refreshing={refreshing} refreshFailed={unavailableScope===scope}/><PilotReadinessPanel companyId={company.id} readiness={projection.readiness} onNavigate={onNavigate} showActions={false}/></>;
}
