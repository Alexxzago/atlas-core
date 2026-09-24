import { useEffect, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import type { AssistantCapabilityCatalog } from "../types/api";
import { Button, Checkbox, ConfirmDialog } from "../design-system/primitives";

interface Props { csrf: string; workspaceId: string | null; companyId: number | null; profileId: string; canManage: boolean; }
const presentation: Record<string, { name: "capabilities.liveData.name" | "capabilities.createBooking.name" | "capabilities.rescheduleBooking.name" | "capabilities.cancelBooking.name" | "capabilities.getBooking.name"; purpose: "capabilities.liveData.purpose" | "capabilities.createBooking.purpose" | "capabilities.rescheduleBooking.purpose" | "capabilities.cancelBooking.purpose" | "capabilities.getBooking.purpose" }> = { "live_data.read": { name: "capabilities.liveData.name", purpose: "capabilities.liveData.purpose" }, "scheduling.create_booking": { name: "capabilities.createBooking.name", purpose: "capabilities.createBooking.purpose" }, "scheduling.reschedule_booking": { name: "capabilities.rescheduleBooking.name", purpose: "capabilities.rescheduleBooking.purpose" }, "scheduling.cancel_booking": { name: "capabilities.cancelBooking.name", purpose: "capabilities.cancelBooking.purpose" }, "scheduling.get_booking": { name: "capabilities.getBooking.name", purpose: "capabilities.getBooking.purpose" } };

export function AssistantCapabilitiesPanel({ csrf, workspaceId, companyId, profileId, canManage }: Props): React.JSX.Element {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<AssistantCapabilityCatalog | null>(null);
  const [proposed, setProposed] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"loading" | "ready" | "not_found" | "unavailable" | "error">("loading");
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!workspaceId || !companyId) return;
    const controller = new AbortController();
    setStatus("loading");
    void atlasApi.getAssistantCapabilityCatalog(workspaceId, companyId, profileId, controller.signal).then((value) => {
      setCatalog(value); setProposed(new Set(value.capabilities.filter((item) => item.assigned).map((item) => item.id))); setStatus("ready");
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setStatus(error instanceof ApiError && error.status === 404 ? "not_found" : error instanceof ApiError && (error.status === 503 || error.status === 429) ? "unavailable" : "error");
    });
    return () => controller.abort();
  }, [workspaceId, companyId, profileId]);

  const save = async (): Promise<void> => {
    if (!workspaceId || !companyId || pending) return;
    setPending(true);
    try {
      await atlasApi.replaceAssistantCapabilities(csrf, workspaceId, companyId, profileId, [...proposed]);
      const value = await atlasApi.getAssistantCapabilityCatalog(workspaceId, companyId, profileId);
      setCatalog(value); setProposed(new Set(value.capabilities.filter((item) => item.assigned).map((item) => item.id)));
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 409) {
        try { const value = await atlasApi.getAssistantCapabilityCatalog(workspaceId, companyId, profileId); setCatalog(value); setProposed(new Set(value.capabilities.filter((item) => item.assigned).map((item) => item.id))); } catch { setStatus("error"); }
      } else if (error instanceof ApiError && error.status === 404) setStatus("not_found");
      else setStatus("error");
    } finally { setPending(false); setConfirm(false); }
  };

  if (status === "loading") return <p role="status">{t("capabilities.loading")}</p>;
  if (status === "not_found") return <p role="alert">{t("capabilities.notFound")}</p>;
  if (status !== "ready" || !catalog) return <p role="alert">{t("capabilities.error")}</p>;
  const changed = catalog.capabilities.some((item) => item.assigned !== proposed.has(item.id));
  const requiresConfirmation = catalog.capabilities.some((item) => item.consequence === "consequential" && !item.assigned && proposed.has(item.id));
  return <section className="assistant-capabilities" aria-labelledby="assistant-capabilities-title">
    <header><p className="atlas-eyebrow">{t("capabilities.eyebrow")}</p><h2 id="assistant-capabilities-title">{t("capabilities.title")}</h2><p>{t("capabilities.lead")}</p>{!canManage && <p role="status">{t("capabilities.readOnly")}</p>}</header>
    <ul className="assistant-capabilities__list" aria-label={t("capabilities.title")}>{catalog.capabilities.map((item) => {
      const assigned = proposed.has(item.id), detail = presentation[item.id];
      return <li key={item.id} className="assistant-capability-row"><div><h3>{t(detail?.name ?? "capabilities.generic.name")}</h3><p>{t(detail?.purpose ?? "capabilities.generic.purpose")}</p>{item.safeReason && <p className="assistant-capability-row__guidance">{item.safeReason}</p>}{item.safeNextAction && <p className="assistant-capability-row__guidance">{item.safeNextAction}</p>}</div><div className="assistant-capability-row__meta"><span className={`assistant-capability-row__availability assistant-capability-row__availability--${item.availability}`}>{t(`capabilities.${item.availability}`)}</span><label htmlFor={`capability-${item.id}`}><Checkbox id={`capability-${item.id}`} checked={assigned} disabled={!canManage || pending} onChange={() => setProposed((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}/>{t("capabilities.enabled")}</label></div></li>;
    })}</ul>
    {canManage && <div className="action-row"><Button disabled={pending || !changed} onClick={() => requiresConfirmation ? setConfirm(true) : void save()}>{pending ? t("capabilities.saving") : t("capabilities.save")}</Button></div>}
    <ConfirmDialog cancelLabel={t("common.cancel")} confirmDisabled={pending} confirmLabel={t("capabilities.confirmSave")} confirmVariant="primary" description={t("capabilities.confirm")} open={confirm} title={t("capabilities.confirmLabel")} onCancel={() => setConfirm(false)} onConfirm={() => void save()}/>
  </section>;
}
