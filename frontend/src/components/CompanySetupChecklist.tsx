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

export function CompanySetupChecklist({ csrf, workspace, companies, company, onNavigate, onChooseCompany }: Props): React.JSX.Element {
  const [readiness, setReadiness] = useState<import("../types/api").PilotReadiness | null>(null);
  const [activation, setActivation] = useState<import("../types/api").ActivationProjection | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [generation, setGeneration] = useState(0);
  const retry = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setReadiness(null); setActivation(null); setUnavailable(false);
    void Promise.all([atlasApi.getPilotReadiness(workspace.id, company.id,controller.signal),atlasApi.getActivation(workspace.id,company.id,controller.signal)]).then(([nextReadiness,nextActivation]) => {if(current){setReadiness(nextReadiness);setActivation(nextActivation);}}).catch((error:unknown) => {if(current&&(error instanceof DOMException&&error.name==="AbortError")===false)setUnavailable(true);});
    return () => { current = false; controller.abort(); };
  }, [workspace.id, company.id, generation]);

  if ((!readiness||!activation) && !unavailable) return <div className="today-workspace today-workspace--loading" aria-busy="true"><p role="status">Verificando el estado de activación...</p></div>;
  if (!readiness||!activation) return <><ContextBackLink href="/dashboard" label="Volver al inicio" onNavigate={event=>{event.preventDefault();onNavigate("/dashboard");}}/><div className="today-workspace today-workspace--unavailable"><header className="work-anchor"><h1>Activación</h1><p role="alert">Estado temporalmente no disponible</p><Button className="next-action" onClick={retry}>Reintentar</Button></header></div></>;
  return <><ContextBackLink href="/dashboard" label="Volver al inicio" onNavigate={event=>{event.preventDefault();onNavigate("/dashboard");}}/><ActivationJourney csrf={csrf} workspaceId={workspace.id} companyId={company.id} projection={activation} onNavigate={onNavigate} onRefresh={retry}/><PilotReadinessPanel companyId={company.id} readiness={readiness} onNavigate={onNavigate} showActions={false}/></>;
}
