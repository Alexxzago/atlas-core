import { useI18n } from "../i18n/I18nContext";
import type { PilotReadiness, PilotReadinessCheck, PilotReadinessClassification, PilotReadinessNextAction } from "../types/api";
import { Badge, Button } from "../design-system/primitives";

interface Props {
  readonly companyId: number;
  readonly readiness: PilotReadiness;
  readonly onNavigate: (path: string) => void;
  readonly showActions?: boolean;
}

const classificationCopy: Record<PilotReadinessClassification, { title: string; description: string }> = {
  setup_incomplete: { title: "En curso", description: "Completá los pasos necesarios para operar el piloto." },
  code_ready: { title: "Configuración pendiente", description: "Configuración interna de Atlas pendiente." },
  configuration_ready: { title: "Atlas listo", description: "Activá un canal para que tu piloto comience a atender." },
  external_provider_blocked: { title: "Acción requerida", description: "Completá la verificación con el proveedor." },
  pilot_ready: { title: "Piloto listo", description: "Atlas puede atender conversaciones en tus canales activos." },
};

const checkCopy: Record<PilotReadinessCheck["id"], string> = {
  workspace_context: "Contexto del espacio",
  company: "Empresa activa",
  default_assistant: "Asistente predeterminado",
  published_knowledge: "Conocimiento publicado",
  commercial_entitlement: "Habilitación comercial",
  operational_channel: "Canal operativo",
  web_chat: "Web Chat",
  whatsapp: "WhatsApp",
  scheduling: "Agenda y reuniones",
  proactive: "Seguimientos proactivos",
};

const reasonCopy: Record<NonNullable<PilotReadinessCheck["reasonCode"]>, string> = {
  workspace_context_invalid: "No pudimos confirmar el contexto del espacio.",
  company_missing: "No encontramos esta empresa.",
  company_suspended: "La empresa está suspendida.",
  company_archived: "La empresa está archivada.",
  default_assistant_not_executable: "El asistente no está listo para atender.",
  published_knowledge_missing: "Falta publicar conocimiento para Atlas.",
  commercial_control_suspended: "La cuenta comercial está suspendida.",
  commercial_entitlement_missing: "Falta una habilitación comercial vigente.",
  commercial_entitlement_ineligible: "La habilitación comercial no permite operar el piloto.",
  operational_channel_missing: "Conectá y activá al menos un canal.",
  web_chat_not_connected: "Web Chat no conectado.",
  web_chat_inactive: "Web Chat está inactivo.",
  whatsapp_not_connected: "WhatsApp no conectado.",
  whatsapp_inactive: "WhatsApp está inactivo.",
  whatsapp_platform_configuration_unavailable: "Atlas está completando la configuración de WhatsApp.",
  whatsapp_business_verification_pending: "Meta está verificando la empresa.",
  whatsapp_validation_failed: "Revisar validación en Meta.",
  whatsapp_health_degraded: "WhatsApp requiere atención.",
  scheduling_not_configured: "Agenda no configurada.",
  proactive_not_configured: "Seguimientos no configurados.",
};

const actionCheck: Record<PilotReadinessNextAction, PilotReadinessCheck["id"]> = {
  resolve_workspace_context: "workspace_context",
  review_company: "company",
  configure_assistant: "default_assistant",
  publish_knowledge: "published_knowledge",
  review_billing: "commercial_entitlement",
  activate_web_chat: "web_chat",
  connect_whatsapp: "operational_channel",
  review_whatsapp: "whatsapp",
};

export function safePilotReadinessPath(path: string | null, companyId: number): string | null {
  if (path === null) return null;
  const base = `/companies/${companyId}`;
  const known = new Set([
    "/dashboard",
    "/billing",
    "/conversations",
    base,
    `${base}/assistant`,
    `${base}/knowledge`,
    `${base}/channels`,
    `${base}/channels/web-chat`,
    `${base}/channels/whatsapp`,
  ]);
  return known.has(path) ? path : null;
}

function statusCopy(status: PilotReadinessCheck["status"]): string {
  if (status === "complete") return "Listo";
  if (status === "incomplete") return "Pendiente";
  if (status === "blocked") return "Bloqueado";
  if (status === "unavailable") return "No disponible";
  return "No aplica";
}

function actionLabel(id: PilotReadinessCheck["id"]): string {
  if (id === "default_assistant") return "Configurar";
  if (id === "published_knowledge") return "Publicar";
  if (id === "commercial_entitlement") return "Facturación";
  if (id === "web_chat") return "Web Chat";
  if (id === "whatsapp") return "WhatsApp";
  if (id === "operational_channel") return "Canales";
  if (id === "scheduling" || id === "proactive") return "Automatizaciones";
  return "Configurar";
}

export function PilotReadinessPanel({
  companyId,
  readiness,
  onNavigate,
  showActions = true,
}: Props): React.JSX.Element {
  const { formatDate } = useI18n();
  const summary = classificationCopy[readiness.classification];
  const required = readiness.checks.filter((check) => check.required);
  const optional = readiness.checks.filter((check) => !check.required);
  const completedCount = required.filter((c) => c.status === "complete").length;
  const totalCount = required.length || 1;
  const progressPercent = Math.round((completedCount / totalCount) * 100);
  const isPilotReady = readiness.classification === "pilot_ready";

  const nextAction = readiness.nextAction;
  const primaryCheck =
    nextAction === null ? null : readiness.checks.find((check) => check.id === actionCheck[nextAction]) ?? null;
  const primaryPath = primaryCheck ? safePilotReadinessPath(primaryCheck.actionPath, companyId) : null;

  return (
    <aside className="pilot-readiness-card" aria-label="Preparación del piloto">
      <div className="pilot-readiness-card__header">
        <div className="pilot-readiness-card__status-indicator">
          <span className={`pilot-readiness-card__dot ${isPilotReady ? "is-ready" : "is-active"}`} />
          <strong className="pilot-readiness-card__status-label">
            {summary.title}
          </strong>
        </div>
        <span className="pilot-readiness-card__percentage">{progressPercent}%</span>
      </div>

      <div className="pilot-readiness-card__progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
        <div
          className="pilot-readiness-card__progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <p className="pilot-readiness-card__description">{summary.description}</p>

      {showActions && primaryPath && primaryCheck && (
        <Button
          variant="primary"
          className="pilot-readiness-card__primary-btn"
          onClick={() => onNavigate(primaryPath)}
        >
          {actionLabel(primaryCheck.id)}
        </Button>
      )}

      <div className="pilot-readiness-card__checks-list">
        {required.map((check) => {
          const isDone = check.status === "complete";
          const path = safePilotReadinessPath(check.actionPath, companyId);
          const tone =
            check.status === "complete"
              ? "success"
              : check.status === "blocked"
                ? "danger"
                : check.status === "unavailable"
                  ? "warning"
                  : "info";

          return (
            <div key={check.id} className={`pilot-readiness-check-item ${isDone ? "is-done" : ""}`}>
              <div className="pilot-readiness-check-item__left">
                <span className="pilot-readiness-check-item__icon">
                  {isDone ? (
                    <svg viewBox="0 0 16 16" fill="currentColor">
                      <path d="M12.207 4.793a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414 0l-2.5-2.5a1 1 0 0 1 1.414-1.414L6.5 9.086l4.293-4.293a1 1 0 0 1 1.414 0z" />
                    </svg>
                  ) : (
                    <span className="pilot-readiness-check-item__dot" />
                  )}
                </span>
                <span className="pilot-readiness-check-item__name">{checkCopy[check.id]}</span>
              </div>
              <div className="pilot-readiness-check-item__right">
                <Badge tone={tone}>{statusCopy(check.status)}</Badge>
                {showActions && path && !isDone && check.status !== "not_applicable" && (
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => onNavigate(path)}
                  >
                    {actionLabel(check.id)}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {optional.length > 0 && (
        <details className="pilot-readiness-card__optional">
          <summary>Mejoras opcionales ({optional.length})</summary>
          <div className="pilot-readiness-card__checks-list is-optional">
            {optional.map((check) => {
              const isDone = check.status === "complete";
              const path = safePilotReadinessPath(check.actionPath, companyId);
              return (
                <div key={check.id} className="pilot-readiness-check-item">
                  <div className="pilot-readiness-check-item__left">
                    <span className="pilot-readiness-check-item__name">{checkCopy[check.id]}</span>
                  </div>
                  <div className="pilot-readiness-check-item__right">
                    <Badge tone={isDone ? "success" : "info"}>{statusCopy(check.status)}</Badge>
                    {showActions && path && !isDone && (
                      <Button size="sm" variant="quiet" onClick={() => onNavigate(path)}>
                        {actionLabel(check.id)}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}

      <footer className="pilot-readiness-card__footer">
        <time dateTime={readiness.evaluatedAt}>
          Verificado: {formatDate(readiness.evaluatedAt)}
        </time>
      </footer>
    </aside>
  );
}
