import { useCallback, useEffect, useState } from "react";
import { atlasApi } from "../api/atlasApi";
import { ActivationJourney, safeActivationPath } from "./ActivationJourney";
import { PilotReadinessPanel } from "./PilotReadinessPanel";
import { TodayHero } from "./TodayHero";
import type { Company, ConversationInboxItem, WorkspaceSummary } from "../types/api";
import { Button } from "../design-system/primitives";
import { useI18n } from "../i18n/I18nContext";

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

const actionLabels: Record<string, string> = {
  complete_company: "Completar empresa",
  publish_knowledge: "Publicar conocimiento",
  configure_assistant: "Configurar asistente",
  activate_web_chat: "Activar Web Chat",
  start_verification: "Iniciar verificación",
  resolve_pilot_readiness: "Actualizar estado",
  review_human_operations: "Abrir conversaciones",
};

export function CompanySetupChecklist({
  csrf,
  workspace,
  company,
  onNavigate,
}: Props): React.JSX.Element {
  const { formatDate } = useI18n();
  const [confirmed, setConfirmed] = useState<ConfirmedProjection | null>(null);
  const [unavailableScope, setUnavailableScope] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [recentConversations, setRecentConversations] = useState<ConversationInboxItem[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);

  const retry = useCallback(() => setGeneration((value) => value + 1), []);
  const scope = `${workspace.id}:${company.id}`;
  const projection = confirmed?.scope === scope ? confirmed : null;

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const hasConfirmedProjection = confirmed?.scope === scope;
    setRefreshing(hasConfirmedProjection);
    if (!hasConfirmedProjection) setUnavailableScope(null);

    setConversationsLoading(true);
    void Promise.all([
      atlasApi.getPilotReadiness(workspace.id, company.id, controller.signal),
      atlasApi.getActivation(workspace.id, company.id, controller.signal),
      atlasApi.listConversations(workspace.id, company.id, {}, undefined, controller.signal).catch(() => ({ items: [] })),
    ])
      .then(([readiness, activation, convResponse]) => {
        if (!current) return;
        setConfirmed({ scope, readiness, activation });
        setRecentConversations(convResponse.items.slice(0, 5));
        setUnavailableScope(null);
        setRefreshing(false);
        setConversationsLoading(false);
      })
      .catch((error: unknown) => {
        if (!current || (error instanceof DOMException && error.name === "AbortError")) return;
        setUnavailableScope(scope);
        setRefreshing(false);
        setConversationsLoading(false);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [workspace.id, company.id, generation]);

  if (!projection && unavailableScope !== scope) {
    return (
      <div className="today-loading-state" aria-busy="true">
        <div className="today-loading-state__spinner" />
        <p role="status">Verificando el estado de activación...</p>
      </div>
    );
  }

  if (!projection) {
    return (
      <div className="today-error-state" role="alert">
        <h1>Activación</h1>
        <p>El estado está temporalmente no disponible.</p>
        <Button variant="primary" onClick={retry}>
          Reintentar
        </Button>
      </div>
    );
  }

  const activation = projection.activation;
  const actionStage = activation.stages.find((stage) => stage.action === activation.nextAction) ?? null;
  const actionPath = actionStage ? safeActivationPath(actionStage.actionPath, company.id) : null;
  const nextActionKey = activation.nextAction;
  const nextActionLabel = actionLabels[nextActionKey] ?? "Continuar configuración";

  // Only offer primary CTA in hero if there is a concrete navigation target!
  const heroPrimaryAction = actionPath ? () => onNavigate(actionPath) : undefined;
  const heroPrimaryLabel = actionPath ? nextActionLabel : undefined;

  const isComplete = activation.stages.every((s) => s.state === "complete");

  return (
    <div className="today-dashboard-fluid">
      {/* 1. Atmospheric Today Hero (fluid on canvas) */}
      <TodayHero
        companyName={company.name}
        isReady={isComplete}
        {...(heroPrimaryLabel && heroPrimaryAction
          ? {
              primaryActionLabel: heroPrimaryLabel,
              onPrimaryAction: heroPrimaryAction,
            }
        : {})}
        secondaryActionLabel="Ver conversaciones"
        onSecondaryAction={() => onNavigate("/conversations")}
      />

      {/* 2. Compact Stepper Strip (single horizontal row) */}
      <ActivationJourney
        csrf={csrf}
        workspaceId={workspace.id}
        companyId={company.id}
        projection={projection.activation}
        onNavigate={onNavigate}
        onRefresh={retry}
        refreshing={refreshing}
        refreshFailed={unavailableScope === scope}
      />

      {/* 3. Operational Grid: Left = Real Conversations table, Right = Pilot Readiness */}
      <div className="today-dashboard-grid">
        <section className="today-operations-area" aria-label="Actividad de conversaciones">
          <div className="today-operations-header">
            <div>
              <h2 className="today-operations-title">Actividad de conversaciones</h2>
              <p className="today-operations-subtitle">
                Atención en tiempo real gestionada por Atlas y tu equipo.
              </p>
            </div>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => onNavigate("/conversations")}
            >
              Abrir bandeja completa →
            </Button>
          </div>

          {conversationsLoading ? (
            <div className="today-operations-loading">
              <span className="today-loading-state__spinner" />
              <p>Cargando actividad...</p>
            </div>
          ) : recentConversations.length > 0 ? (
            <div className="today-conversations-table">
              <div className="today-conversations-row today-conversations-row--header">
                <span>Contacto</span>
                <span>Canal</span>
                <span>Control</span>
                <span>Último mensaje</span>
                <span>Acción</span>
              </div>
              {recentConversations.map((item) => (
                <div key={item.conversationId} className="today-conversations-row">
                  <div className="today-conversation-contact">
                    <span className="today-conversation-avatar">
                      {item.contactLabel ? item.contactLabel.slice(0, 2).toUpperCase() : "CO"}
                    </span>
                    <strong>{item.contactLabel || "Contacto sin nombre"}</strong>
                  </div>
                  <span className="today-conversation-channel">
                    {item.channel === "whatsapp" ? "WhatsApp" : "Web Chat"}
                  </span>
                  <span className={`today-conversation-state state--${item.controlState}`}>
                    {item.controlState === "human_controlled" ? "Humano" : "Autónomo"}
                  </span>
                  <time className="today-conversation-time" dateTime={item.lastActivityAt ?? item.updatedAt}>
                    {formatDate(item.lastActivityAt ?? item.updatedAt)}
                  </time>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => onNavigate("/conversations")}
                  >
                    Ver
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="today-operations-empty">
              <div className="today-operations-empty__icon">💬</div>
              <h3>Sin conversaciones activas aún</h3>
              <p>
                Las interacciones iniciadas en Web Chat o WhatsApp aparecerán aquí de forma inmediata.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onNavigate("/conversations")}
              >
                Ir a la bandeja de entrada
              </Button>
            </div>
          )}
        </section>

        {/* Right Contextual Rail: Pilot Readiness Panel */}
        <aside className="today-dashboard-aside">
          <PilotReadinessPanel
            companyId={company.id}
            readiness={projection.readiness}
            onNavigate={onNavigate}
            showActions={false}
          />
        </aside>
      </div>
    </div>
  );
}
