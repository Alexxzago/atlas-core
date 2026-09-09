import { useEffect, useRef, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import type { AssistantReadinessAssessment, CompanyOperationalStatus } from "../types/api";

interface Props { csrf: string; workspaceId: string | null; companyId: number | null; profileId: string; canManage: boolean; onNavigate?: (path: string) => void; }
interface ConfirmedStatus { readiness: AssistantReadinessAssessment; operational: CompanyOperationalStatus; }
type ViewState = "loading" | "ready" | "not_found" | "unavailable" | "error";

function blockerPresentation(blocker: string): { reason: "assistantStatus.blocker.knowledge" | "assistantStatus.blocker.default" | "assistantStatus.blocker.profile" | "assistantStatus.blocker.connection" | "assistantStatus.blocker.generic"; action: "assistantStatus.action.knowledge" | "assistantStatus.action.general" | "assistantStatus.action.connection"; destination: "knowledge" | "general" | null } {
  if (blocker === "published_knowledge_missing") return { reason: "assistantStatus.blocker.knowledge", action: "assistantStatus.action.knowledge", destination: "knowledge" };
  if (blocker === "default_assistant_missing" || blocker === "default_assistant_ambiguous" || blocker === "default_assistant_not_found") return { reason: "assistantStatus.blocker.default", action: "assistantStatus.action.general", destination: "general" };
  if (blocker === "default_assistant_not_executable" || blocker === "default_assistant_wrong_tenant") return { reason: "assistantStatus.blocker.profile", action: "assistantStatus.action.general", destination: "general" };
  if (blocker === "whatsapp_connection_missing" || blocker === "whatsapp_connection_inconsistent" || blocker === "whatsapp_credentials_missing" || blocker === "whatsapp_validation_missing") return { reason: "assistantStatus.blocker.connection", action: "assistantStatus.action.connection", destination: null };
  return { reason: "assistantStatus.blocker.generic", action: "assistantStatus.action.general", destination: "general" };
}

function errorState(error: unknown): ViewState { if (error instanceof ApiError) { if (error.status === 404) return "not_found"; if (error.status === 429 || error.status === 503) return "unavailable"; } return "error"; }

export function AssistantStatusPanel({ csrf, workspaceId, companyId, profileId, canManage, onNavigate }: Props): React.JSX.Element {
  const { t, formatDate } = useI18n();
  const [confirmed, setConfirmed] = useState<ConfirmedStatus | null>(null);
  const [state, setState] = useState<ViewState>("loading");
  const [pending, setPending] = useState(false);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const generation = useRef(0);
  const refreshController = useRef<AbortController | null>(null);

  const load = async (signal: AbortSignal, currentGeneration: number): Promise<void> => {
    if (!workspaceId || !companyId) return;
    try {
      // Readiness is evaluated first so operational status reflects the same confirmed assessment.
      const readiness = await atlasApi.getAssistantReadiness(workspaceId, companyId, signal);
      const operational = await atlasApi.getCompanyOperationalStatus(workspaceId, companyId, signal);
      if (!signal.aborted && currentGeneration === generation.current) { setConfirmed({ readiness, operational }); setState("ready"); setRetryAfter(null); }
    } catch (error: unknown) {
      if (!signal.aborted && currentGeneration === generation.current) { setState(errorState(error)); setRetryAfter(error instanceof ApiError ? error.retryAfterSeconds : null); }
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const currentGeneration = ++generation.current;
    setConfirmed(null); setState("loading"); setPending(false); setRetryAfter(null);
    void load(controller.signal, currentGeneration);
    return () => { controller.abort(); refreshController.current?.abort(); };
  }, [workspaceId, companyId, profileId]);

  const refresh = async (): Promise<void> => {
    if (!workspaceId || !companyId || pending || !canManage) return;
    const controller = new AbortController(); refreshController.current = controller; const currentGeneration = generation.current;
    setPending(true); setState("ready"); setRetryAfter(null);
    try {
      await atlasApi.refreshAssistantReadiness(csrf, workspaceId, companyId, controller.signal);
      await load(controller.signal, currentGeneration);
    } catch (error: unknown) {
      if (currentGeneration !== generation.current) return;
      setState(errorState(error)); setRetryAfter(error instanceof ApiError ? error.retryAfterSeconds : null);
      if (error instanceof ApiError && error.status === 409) await load(controller.signal, currentGeneration);
    } finally { if (refreshController.current === controller) refreshController.current = null; if (currentGeneration === generation.current) setPending(false); }
  };

  if (state === "loading" && !confirmed) return <p role="status">{t("assistantStatus.loading")}</p>;
  if (!confirmed) return <section aria-labelledby="assistant-status-title"><h2 id="assistant-status-title">{t(state === "not_found" ? "assistantStatus.notFound" : "assistantStatus.unavailable")}</h2><p role="alert">{t(state === "error" ? "assistantStatus.error" : "assistantStatus.summary.unavailable")}</p></section>;

  const { readiness, operational } = confirmed;
  const overall = pending ? "checking" : state !== "ready" ? "unavailable" : readiness.status === "ready" ? "ready" : "needsAttention";
  const label = overall === "ready" ? t("assistantStatus.ready") : overall === "needsAttention" ? t("assistantStatus.needsAttention") : overall === "checking" ? t("assistantStatus.checking") : t("assistantStatus.unavailable");
  const summary = overall === "ready" ? t("assistantStatus.summary.ready") : overall === "needsAttention" ? t("assistantStatus.summary.attention") : t("assistantStatus.summary.unavailable");
  const blockers = [...new Set(readiness.blockers)];
  return <section className="assistant-status" aria-labelledby="assistant-status-title" aria-busy={pending}>
    <p className="atlas-eyebrow">{t("assistantStatus.eyebrow")}</p><h2 id="assistant-status-title">{t("assistantStatus.title")}</h2><p>{t("assistantStatus.lead")}</p>
    <div className={`assistant-status__summary assistant-status__summary--${overall}`} role="status" aria-live="polite"><strong>{label}</strong><p>{summary}</p>{readiness.evaluatedAt && <p>{t("assistantStatus.checked", { date: formatDate(readiness.evaluatedAt) })}</p>}</div>
    {readiness.assistantProfileId !== profileId && <p>{t("assistantStatus.defaultOther")}</p>}
    {state !== "ready" && <p role="alert">{state === "unavailable" && retryAfter !== null ? t("assistantStatus.retryAfter", { seconds: retryAfter }) : state === "unavailable" ? t("assistantStatus.retryLater") : t("assistantStatus.preserved")}</p>}
    {canManage ? <button className="button button--secondary" type="button" disabled={pending} aria-busy={pending} onClick={() => void refresh()}>{pending ? t("assistantStatus.refreshing") : t("assistantStatus.refresh")}</button> : <p>{t("assistantStatus.readOnly")}</p>}
    {blockers.length > 0 && <section aria-labelledby="assistant-status-blockers"><h3 id="assistant-status-blockers">{t("assistantStatus.blockers")}</h3><ul>{blockers.map(blocker => { const item = blockerPresentation(blocker), href = item.destination === "knowledge" ? `/companies/${companyId}/knowledge` : item.destination === "general" ? `/companies/${companyId}/assistant/${profileId}/general` : null; return <li key={blocker}><p>{t(item.reason)}</p><p><strong>{t("assistantStatus.action")}:</strong> {href ? <a href={href} onClick={event => { event.preventDefault(); onNavigate?.(href); }}>{t(item.action)}</a> : t(item.action)}</p></li>; })}</ul></section>}
    <section aria-labelledby="assistant-status-details"><h3 id="assistant-status-details">{t("assistantStatus.details")}</h3><h4>{t("assistantStatus.channels")}</h4><ul>{operational.whatsApp.length === 0 ? <li>{t("assistantStatus.channelInactive")}</li> : operational.whatsApp.map(channel => <li key={channel.connectionId}>{channel.status === "active" && channel.validationState === "valid" && channel.healthState === "healthy" ? t("assistantStatus.channelActive") : channel.status === "inactive" ? t("assistantStatus.channelInactive") : t("assistantStatus.channelAttention")}</li>)}</ul><h4>{t("assistantStatus.voice")}</h4><p>{t("assistantStatus.voiceUnavailable")}</p></section>
  </section>;
}
