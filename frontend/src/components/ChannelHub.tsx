import { useEffect, useState } from "react";
import { atlasApi } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import type { CompanyOperationalStatus } from "../types/api";
import { ObjectGrid, ObjectSurface, Section } from "../design-system/product";

interface Props { readonly companyId: number; readonly workspaceId?: string | null; readonly onNavigate: (path: string) => void; }

export function ChannelHub({ companyId, workspaceId = null, onNavigate }: Props): React.JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<CompanyOperationalStatus | null>(null);
  const [loading, setLoading] = useState(Boolean(workspaceId));
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let current = true;
    if (!workspaceId) { setLoading(false); setFailed(false); return () => { current = false; }; }
    setLoading(true); setFailed(false); setStatus(null);
    void atlasApi.getCompanyOperationalStatus(workspaceId, companyId).then(value => { if (current) setStatus(value); }).catch(() => { if (current) setFailed(true); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [workspaceId, companyId, retry]);

  const whatsApp = status?.whatsApp ?? [];
  const active = whatsApp.some(connection => connection.status === "active");
  const needsAttention = whatsApp.some(connection => connection.validationState === "invalid" || connection.healthState === "degraded");
  const state = loading ? t("waGuide.loading") : failed ? t("startup.unavailable") : needsAttention ? t("waGuide.health.degraded") : active ? t("whatsapp.active") : whatsApp.length ? t("waGuide.inactive") : t("experience.channels.ready");
  const next = loading ? t("waGuide.loading") : failed || needsAttention ? t("common.retry") : t("experience.channels.openWhatsApp");

  return <Section className="channel-hub" title={t("experience.channels.title")} description={t("experience.channels.description")}>
    <ObjectGrid>
      <ObjectSurface className="channel-card" emphasis="featured"><div><span className="channel-card__mark" aria-hidden="true">W</span><p className="channel-card__meta">{state}</p><h3>{t("channels.whatsapp")}</h3><p>{t("experience.channels.whatsappDescription")}</p><p>{next}</p></div><button className="button button--primary" type="button" disabled={loading} onClick={() => failed ? setRetry(value => value + 1) : onNavigate(`/companies/${companyId}/channels/whatsapp`)}>{failed ? t("common.retry") : t("experience.channels.openWhatsApp")}</button></ObjectSurface>
      <ObjectSurface className="channel-card"><div><span className="channel-card__mark" aria-hidden="true">C</span><p className="channel-card__meta">{t("experience.channels.available")}</p><h3>{t("channels.webChat")}</h3><p>{t("experience.channels.webChatDescription")}</p></div><button className="button button--secondary" type="button" onClick={() => onNavigate(`/companies/${companyId}/channels/web-chat`)}>{t("experience.channels.manageWebChat")}</button></ObjectSurface>
    </ObjectGrid>
    <section className="channel-hub__future" aria-labelledby="upcoming-channels-title"><header><h2 id="upcoming-channels-title">{t("experience.channels.futureTitle")}</h2><p>{t("experience.channels.futureDescription")}</p></header><ul>{["Instagram", "Messenger", "Telegram", "Email"].map((channel) => <li key={channel}>{channel}</li>)}</ul></section>
  </Section>;
}
