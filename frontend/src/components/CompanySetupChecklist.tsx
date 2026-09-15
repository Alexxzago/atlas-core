import { useCallback, useEffect, useState } from "react";
import { atlasApi } from "../api/atlasApi";
import { PilotReadinessPanel } from "./PilotReadinessPanel";
import type { Company, WorkspaceSummary } from "../types/api";
import { ContextBackLink } from "./ContextBackLink";

interface Props {
  readonly workspace: WorkspaceSummary;
  readonly companies: readonly Company[];
  readonly company: Company;
  readonly onNavigate: (path: string) => void;
  readonly onChooseCompany: () => void;
}

export function CompanySetupChecklist({ workspace, companies, company, onNavigate, onChooseCompany }: Props): React.JSX.Element {
  const [readiness, setReadiness] = useState<import("../types/api").PilotReadiness | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [generation, setGeneration] = useState(0);
  const retry = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(() => {
    let current = true;
    setReadiness(null); setUnavailable(false);
    void atlasApi.getPilotReadiness(workspace.id, company.id).then((value) => {
      if (current) setReadiness(value);
    }).catch(() => {
    if (current) setUnavailable(true);
  });
    return () => { current = false; };
  }, [workspace.id, company.id, generation]);

  if (!readiness && !unavailable) return <div className="today-workspace today-workspace--loading" aria-busy="true"><p role="status">Verificando el estado del piloto...</p></div>;
  if (!readiness) return <><ContextBackLink href="/dashboard" label="Volver al inicio" onNavigate={event=>{event.preventDefault();onNavigate("/dashboard");}}/><div className="today-workspace today-workspace--unavailable"><header className="work-anchor"><h1>Estado del piloto</h1><p role="alert">Estado temporalmente no disponible</p><button className="button button--primary next-action" type="button" onClick={retry}>Reintentar</button></header></div></>;
  return <><ContextBackLink href="/dashboard" label="Volver al inicio" onNavigate={event=>{event.preventDefault();onNavigate("/dashboard");}}/><PilotReadinessPanel companyId={company.id} readiness={readiness} onNavigate={onNavigate}/></>;
}
