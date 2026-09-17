import { useEffect, useState } from "react";
import { atlasApi } from "../api/atlasApi";
import { StartupState } from "../components/StartupState";
import type { PlatformPilotReadiness } from "../types/api";
import {
  Alert,
  EmptyState,
  StatusBadge,
  Surface,
} from "../design-system/primitives";

export function WorkspacePilotReadiness({
  id,
}: {
  readonly id: string;
}): React.JSX.Element {
  const [data, setData] = useState<PlatformPilotReadiness | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void atlasApi
      .platformWorkspacePilotReadiness(id)
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [id]);
  if (error)
    return (
      <section className="admin-state">
        <h1>Preparación no disponible</h1>
        <Alert tone="danger">
          No pudimos cargar la preparación del piloto.
        </Alert>
      </section>
    );
  if (!data) return <StartupState />;
  return (
    <section className="admin-page">
      <header>
        <p className="admin-eyebrow">Preparación del piloto</p>
        <h1>Workspace {id}</h1>
        <StatusBadge
          tone={
            data.aggregate.unavailable > 0
              ? "warning"
              : data.aggregate.notReady > 0
                ? "info"
                : "success"
          }
        >
          {data.aggregate.pilotReady} listos, {data.aggregate.notReady}{" "}
          pendientes y {data.aggregate.unavailable} no disponibles.
        </StatusBadge>
      </header>
      {data.companies.length === 0 ? (
        <EmptyState
          title="No hay empresas"
          description="Las empresas de este workspace aparecerán aquí."
        />
      ) : (
        <div className="admin-readiness-list">
          {data.companies.map((company) => (
            <Surface key={company.companyId} tone="subtle">
              <details>
                <summary>
                  {company.companyName}{" "}
                  <StatusBadge
                    tone={
                      company.state === "unavailable"
                        ? "warning"
                        : company.overall === "pilot_ready"
                          ? "success"
                          : "info"
                    }
                  >
                    {company.state === "unavailable"
                      ? "No disponible"
                      : company.overall === "pilot_ready"
                        ? "Listo"
                        : "Pendiente"}
                  </StatusBadge>
                </summary>
                {company.state === "unavailable" ? (
                  <p>La evaluación no está disponible temporalmente.</p>
                ) : company.issues.length === 0 ? (
                  <p>Sin incidencias de preparación.</p>
                ) : (
                  <ul>
                    {company.issues.map((issue) => (
                      <li key={issue.id}>
                        {issue.id}: {issue.reasonCode} ({issue.owner})
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            </Surface>
          ))}
        </div>
      )}
    </section>
  );
}
