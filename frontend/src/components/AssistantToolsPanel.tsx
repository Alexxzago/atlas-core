import { useEffect, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import type { AssistantToolCatalogItem } from "../types/api";
import { Badge, Card, ErrorState, LoadingState } from "../design-system/primitives";

interface Props { workspaceId: string | null; companyId: number | null; profileId: string; onNavigate?: (path: string) => void; }
const presentation: Record<string, { name: "tools.liveData.name" | "tools.createBooking.name" | "tools.rescheduleBooking.name" | "tools.cancelBooking.name" | "tools.getBooking.name"; purpose: "tools.liveData.purpose" | "tools.createBooking.purpose" | "tools.rescheduleBooking.purpose" | "tools.cancelBooking.purpose" | "tools.getBooking.purpose" }> = { "live_data.read": { name: "tools.liveData.name", purpose: "tools.liveData.purpose" }, "scheduling.create_booking": { name: "tools.createBooking.name", purpose: "tools.createBooking.purpose" }, "scheduling.reschedule_booking": { name: "tools.rescheduleBooking.name", purpose: "tools.rescheduleBooking.purpose" }, "scheduling.cancel_booking": { name: "tools.cancelBooking.name", purpose: "tools.cancelBooking.purpose" }, "scheduling.get_booking": { name: "tools.getBooking.name", purpose: "tools.getBooking.purpose" } };

export function AssistantToolsPanel({ workspaceId, companyId, profileId, onNavigate }: Props): React.JSX.Element {
  const { t } = useI18n();
  const [tools, setTools] = useState<readonly AssistantToolCatalogItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "not_found" | "unavailable" | "error">("loading");

  useEffect(() => {
    if (!workspaceId || !companyId) return;
    const controller = new AbortController();
    setStatus("loading");
    void atlasApi.getAssistantToolCatalog(workspaceId, companyId, profileId, controller.signal).then((value) => { setTools(value.tools); setStatus("ready"); }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setStatus(error instanceof ApiError && error.status === 404 ? "not_found" : error instanceof ApiError && (error.status === 429 || error.status === 503) ? "unavailable" : "error");
    });
    return () => controller.abort();
  }, [workspaceId, companyId, profileId]);

  if (status === "loading") return <LoadingState title={t("tools.loading")} />;
  if (status !== "ready") return <ErrorState title={t(status === "not_found" ? "tools.notFound" : "tools.error")} description={t(status === "not_found" ? "tools.notFound" : "tools.error")} />;
  return <section className="authenticated-section assistant-tools" aria-labelledby="assistant-tools-title">
    <header><p className="atlas-eyebrow">{t("tools.eyebrow")}</p><h2 id="assistant-tools-title">{t("tools.title")}</h2><p>{t("tools.lead")}</p></header>
    {tools.length === 0 ? <p>{t("tools.empty")}</p> : <ul className="assistant-tools__list" aria-label={t("tools.listLabel")}>{tools.map((tool) => {
      const item = presentation[tool.id], available = tool.availability === "available", capabilitiesPath = `/companies/${companyId}/assistant/${profileId}/capabilities`;
      return <li key={tool.id}><Card className="assistant-tool-card"><h3>{t(item?.name ?? "tools.generic.name")}</h3><p>{t(item?.purpose ?? "tools.generic.purpose")}</p><p className="assistant-tool-card__status"><Badge tone={tool.enabled?"success":"neutral"}>{tool.enabled ? t("tools.enabled") : t("tools.notEnabled")}</Badge><Badge tone={available?"success":"warning"}>{t(`tools.${tool.availability}`)}</Badge></p>{!tool.enabled && <p className="assistant-tool-card__guidance">{t("tools.capabilityOff")}</p>}{!available && (tool.safeReason || tool.safeNextAction) && <div className="assistant-tool-card__guidance">{tool.safeReason && <p>{tool.safeReason}</p>}{tool.safeNextAction && <p>{tool.safeNextAction}</p>}</div>}<a className="assistant-tool-card__action" href={capabilitiesPath} onClick={(event) => { event.preventDefault(); onNavigate?.(capabilitiesPath); }}>{t("tools.openCapabilities")}</a></Card></li>;
    })}</ul>}
  </section>;
}
