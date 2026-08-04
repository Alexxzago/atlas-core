import { useI18n } from "../i18n/I18nContext";
import { ObjectGrid, ObjectSurface, Section } from "../design-system/product";

interface Props { readonly companyId: number; readonly onNavigate: (path: string) => void; }

export function ChannelHub({ companyId, onNavigate }: Props): React.JSX.Element {
  const { t } = useI18n();
  return <Section className="channel-hub" title={t("experience.channels.title")} description={t("experience.channels.description")}>
    <ObjectGrid>
      <ObjectSurface className="channel-card" emphasis="featured"><div><span className="channel-card__mark" aria-hidden="true">W</span><p className="channel-card__meta">{t("experience.channels.ready")}</p><h3>{t("channels.whatsapp")}</h3><p>{t("experience.channels.whatsappDescription")}</p></div><button className="button button--primary" type="button" onClick={() => onNavigate(`/companies/${companyId}/channels/whatsapp`)}>{t("experience.channels.openWhatsApp")}</button></ObjectSurface>
      <ObjectSurface className="channel-card"><div><span className="channel-card__mark" aria-hidden="true">C</span><p className="channel-card__meta">{t("experience.channels.available")}</p><h3>{t("channels.webChat")}</h3><p>{t("experience.channels.webChatDescription")}</p></div><button className="button button--secondary" type="button" onClick={() => onNavigate(`/companies/${companyId}/channels/web-chat`)}>{t("experience.channels.manageWebChat")}</button></ObjectSurface>
    </ObjectGrid>
    <section className="channel-hub__future" aria-labelledby="upcoming-channels-title"><header><h2 id="upcoming-channels-title">{t("experience.channels.futureTitle")}</h2><p>{t("experience.channels.futureDescription")}</p></header><ul>{["Instagram", "Messenger", "Telegram", "Email"].map((channel) => <li key={channel}>{channel}</li>)}</ul></section>
  </Section>;
}
