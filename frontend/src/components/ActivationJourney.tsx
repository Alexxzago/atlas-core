import { useEffect, useRef, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { publicWebChatApi } from "../api/publicWebChatApi";
import { Button } from "../design-system/primitives";
import type { ActivationAction, ActivationProjection, ActivationStage, ActivationStageId } from "../types/api";

interface Props {
  readonly csrf: string;
  readonly workspaceId: string;
  readonly companyId: number;
  readonly projection: ActivationProjection;
  readonly onNavigate: (path: string) => void;
  readonly onRefresh: () => void;
  readonly refreshing?: boolean;
  readonly refreshFailed?: boolean;
}

const stageCopy: Record<ActivationStageId, string> = {
  company: "Empresa",
  knowledge: "Conocimiento",
  assistant: "Asistente",
  web_chat: "Web Chat",
  verification: "Verificación",
  pilot_ready: "Piloto",
  human_ops: "Operaciones",
};

const actionCopy: Record<ActivationAction, string> = {
  complete_company: "Completar empresa",
  publish_knowledge: "Publicar conocimiento",
  configure_assistant: "Configurar asistente",
  activate_web_chat: "Activar Web Chat",
  start_verification: "Iniciar verificación",
  resolve_pilot_readiness: "Actualizar estado del piloto",
  review_human_operations: "Abrir conversaciones",
};

const reasonCopy: Record<NonNullable<ActivationStage["reasonCode"]>, string> = {
  company_missing: "No encontramos esta empresa.",
  company_suspended: "La empresa está suspendida.",
  company_archived: "La empresa está archivada.",
  default_assistant_not_executable: "El asistente todavía no está listo.",
  published_knowledge_missing: "Falta publicar conocimiento.",
  web_chat_not_connected: "Web Chat no conectado.",
  web_chat_inactive: "Web Chat está inactivo.",
  verification_required: "Probá una conversación de prueba.",
  verification_pending: "Verificación en curso.",
  verification_failed: "La comprobación anterior falló.",
  pilot_not_ready: "Comprobando preparación.",
};

export function safeActivationPath(path: string | null, companyId: number): string | null {
  if (path === null) return null;
  const base = `/companies/${companyId}`;
  const known = new Set([
    base,
    `${base}/knowledge`,
    `${base}/assistant`,
    `${base}/channels/web-chat`,
    `/conversations`,
  ]);
  return known.has(path) ? path : null;
}

function statusCopy(stage: ActivationStage): string {
  if (stage.state === "complete") return "Listo";
  if (stage.state === "blocked") return "Bloqueado";
  if (stage.state === "unavailable") return "No disponible";
  return "Pendiente";
}

function ownerCopy(stage: ActivationStage): string | null {
  if (stage.owner === "platform") return "Atlas necesita completar una configuración.";
  if (stage.owner === "external_provider") return "Se requiere acción del proveedor.";
  return null;
}

export function ActivationJourney({
  csrf,
  workspaceId,
  companyId,
  projection,
  onNavigate,
  onRefresh,
  refreshing = false,
  refreshFailed = false,
}: Props): React.JSX.Element {
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
  const scopeRef = useRef("");
  const scope = `${workspaceId}:${companyId}`;
  scopeRef.current = scope;

  const actionStage = projection.stages.find((stage) => stage.action === projection.nextAction) ?? null;
  const actionPath = actionStage ? safeActivationPath(actionStage.actionPath, companyId) : null;

  useEffect(() => {
    const refresh = (): void => onRefresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [onRefresh, scope]);

  const perform = async (verificationWindow: Window | null = null): Promise<void> => {
    if (submitting || !actionStage) return;
    setNotice(null);
    setVerificationUrl(null);
    if (actionPath) {
      onNavigate(actionPath);
      return;
    }
    if (projection.nextAction === "resolve_pilot_readiness") {
      onRefresh();
      setNotice("Actualizamos el estado con la información más reciente.");
      return;
    }
    if (projection.nextAction !== "start_verification") return;
    const actionScope = scope;
    setSubmitting(true);
    try {
      const attempt = await atlasApi.startActivationVerification(csrf, workspaceId, companyId);
      const connections = await atlasApi.listWebChatConnections(workspaceId, companyId);
      const connection = connections.find((value) => value.status === "active");
      if (!connection) throw new Error("Web Chat is unavailable.");
      await publicWebChatApi.startActivationVerification(connection.publicId, attempt.token);
      if (scopeRef.current !== actionScope) return;
      const url = `/chat/${connection.publicId}`;
      setVerificationUrl(url);
      if (verificationWindow) {
        verificationWindow.opener = null;
        verificationWindow.location.replace(url);
      }
      setNotice(
        verificationWindow
          ? "La conversación de verificación está abierta. Enviá un mensaje y volvé a esta página para confirmar el resultado."
          : "Abrí la conversación de verificación para continuar."
      );
      onRefresh();
    } catch (error: unknown) {
      verificationWindow?.close();
      if (scopeRef.current === actionScope)
        setNotice(error instanceof ApiError ? error.message : "No pudimos iniciar la verificación. Intentá nuevamente.");
    } finally {
      if (scopeRef.current === actionScope) setSubmitting(false);
    }
  };

  const begin = (): void => {
    const verificationWindow = projection.nextAction === "start_verification" ? window.open("", "_blank") : null;
    void perform(verificationWindow);
  };

  const currentStage =
    projection.stages.find((stage) => stage.action === projection.nextAction) ??
    projection.stages.find((stage) => stage.state !== "complete") ??
    null;

  return (
    <section className="activation-journey" aria-busy={submitting} aria-labelledby="activation-journey-title">
      <header className="activation-journey__header">
        <div className="activation-journey__intro">
          <span className="activation-journey__eyebrow">Recorrido de activación</span>
          <h2 id="activation-journey-title" className="activation-journey__title">
            Fases de despliegue
          </h2>
        </div>
        {actionStage && projection.nextAction !== "activate_web_chat" && (
          <Button variant="primary" className="activation-journey__action" onClick={begin} disabled={submitting}>
            {submitting ? "Iniciando..." : actionCopy[projection.nextAction]}
          </Button>
        )}
      </header>

      {refreshing && <p className="activation-journey__refresh" role="status">Actualizando estado...</p>}
      {refreshFailed && (
        <p className="activation-journey__refresh" role="status">
          No pudimos actualizar el estado. Conservamos la última verificación confirmada.
        </p>
      )}
      {notice && <p className="activation-journey__notice" role="status">{notice}</p>}
      {verificationUrl && (
        <a className="activation-journey__verify-link" href={verificationUrl} target="_blank" rel="noreferrer">
          Abrir conversación de verificación →
        </a>
      )}

      {/* Franja de progreso compacta (Single horizontal strip) */}
      <nav className="activation-stepper" aria-label="Progreso de activación">
        <ol className="activation-stepper__strip">
          {projection.stages.map((stage, index) => {
            const isComplete = stage.state === "complete";
            const isCurrent = stage.action === projection.nextAction;

            return (
              <li
                key={stage.id}
                className={`activation-stepper__item ${isComplete ? "is-complete" : ""} ${isCurrent ? "is-current" : ""}`}
                title={`${stageCopy[stage.id]}: ${statusCopy(stage)}`}
              >
                <span className="activation-stepper__dot">
                  {isComplete ? (
                    <svg className="activation-stepper__check" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M12.207 4.793a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414 0l-2.5-2.5a1 1 0 0 1 1.414-1.414L6.5 9.086l4.293-4.293a1 1 0 0 1 1.414 0z" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="activation-stepper__name">{stageCopy[stage.id]}</span>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Detalle del paso actual debajo de la franja */}
      {currentStage && (currentStage.reasonCode || ownerCopy(currentStage)) && (
        <div className="activation-stepper__active-detail">
          <strong className="activation-stepper__active-step-title">{stageCopy[currentStage.id]}:</strong>{" "}
          <span>{currentStage.reasonCode ? reasonCopy[currentStage.reasonCode] : ownerCopy(currentStage)}</span>
        </div>
      )}

      <footer className="activation-journey__footer">
        <p className="activation-journey__timestamp">
          Última verificación: <time dateTime={projection.evaluatedAt}>{projection.evaluatedAt}</time>
        </p>
      </footer>
    </section>
  );
}
