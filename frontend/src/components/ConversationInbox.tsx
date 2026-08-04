import { useEffect, useRef, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import type { ConversationDetail, ConversationInboxItem, Permission } from "../types/api";
import { EmptyExperience } from "../design-system/product";

interface Props { readonly csrf: string; readonly workspaceId: string | null; readonly companyId: number | null; readonly capabilities: readonly Permission[]; }

export function ConversationInbox({ csrf, workspaceId, companyId, capabilities }: Props): React.JSX.Element {
  const { locale, formatDate } = useI18n();
  const text = locale === "es" ? spanish : english;
  const [items, setItems] = useState<readonly ConversationInboxItem[]>([]);
  const [selected, setSelected] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(false), [working, setWorking] = useState(false), [error, setError] = useState<string | null>(null), [content, setContent] = useState("");
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const readable = capabilities.includes("company:read"), manageable = capabilities.includes("conversation:manage"), canSend = capabilities.includes("conversation:message:send");

  const load = async (conversationId?: string): Promise<void> => {
    if (!workspaceId || !companyId || !readable) return;
    setLoading(true); setError(null);
    try {
      const inbox = await atlasApi.listConversations(workspaceId, companyId);
      setItems(inbox);
      const id = conversationId ?? selected?.conversationId ?? inbox[0]?.conversationId;
      setSelected(id ? await atlasApi.getConversation(workspaceId, companyId, id) : null);
    } catch (cause: unknown) { setError(cause instanceof ApiError ? cause.message : text.unavailable); }
    finally { setLoading(false); }
  };

  useEffect(() => { setItems([]); setSelected(null); setContent(""); void load(); }, [workspaceId, companyId, readable]);
  useEffect(() => { if (selected) detailHeading.current?.focus(); }, [selected?.conversationId]);

  const select = async (id: string): Promise<void> => { if (!workspaceId || !companyId || working) return; setWorking(true); setError(null); try { setSelected(await atlasApi.getConversation(workspaceId, companyId, id)); } catch (cause: unknown) { setError(cause instanceof ApiError ? cause.message : text.unavailable); } finally { setWorking(false); } };
  const control = async (action: "take" | "release" | "resolve"): Promise<void> => {
    if (!workspaceId || !companyId || !selected || working) return;
    setWorking(true); setError(null);
    try {
      if (action === "take") await atlasApi.takeOverConversation(csrf, workspaceId, companyId, selected.conversationId, selected.controlVersion);
      else if (action === "release") await atlasApi.releaseConversation(csrf, workspaceId, companyId, selected.conversationId, selected.controlVersion);
      else await atlasApi.resolveConversation(csrf, workspaceId, companyId, selected.conversationId, selected.controlVersion);
      await load(selected.conversationId);
    } catch (cause: unknown) { setError(cause instanceof ApiError ? cause.message : text.unavailable); }
    finally { setWorking(false); }
  };
  const send = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!workspaceId || !companyId || !selected || !content.trim() || working) return;
    setWorking(true); setError(null);
    try { await atlasApi.sendConversationMessage(csrf, workspaceId, companyId, selected.conversationId, content.trim(), crypto.randomUUID()); setContent(""); await load(selected.conversationId); }
    catch (cause: unknown) { setError(cause instanceof ApiError ? cause.message : text.unavailable); }
    finally { setWorking(false); }
  };

  if (!workspaceId || !companyId) return <section className="authenticated-section"><h2>{text.title}</h2><p className="state-copy">{text.companyRequired}</p></section>;
  if (!readable) return <section className="authenticated-section"><h2>{text.title}</h2><p className="state-copy">{text.unavailable}</p></section>;
  return <section className="authenticated-section conversation-inbox" aria-busy={loading || working}>
    <div className="section-heading conversation-inbox__header"><div><p className="eyebrow">{text.listLabel}</p><h2>{text.title}</h2><p>{text.description}</p></div><button className="button button--secondary" type="button" onClick={() => void load()} disabled={loading || working}>{text.refresh}</button></div>
    {error && <div className="inline-message inline-message--error" role="alert">{error}</div>}
    {loading && <p role="status">{text.loading}</p>}
    {!loading && items.length === 0 && <EmptyExperience title={text.empty} description={text.emptyDescription}/>}
    {items.length > 0 && <div className="assistant-profile-layout conversation-inbox__workspace">
      <div className="assistant-profile-list conversation-inbox__list" aria-label={text.listLabel}>{items.map((item) => <button type="button" key={item.conversationId} className={`assistant-profile-item conversation-inbox__item${selected?.conversationId === item.conversationId ? " is-selected" : ""}`} aria-current={selected?.conversationId === item.conversationId ? "true" : undefined} onClick={() => void select(item.conversationId)} disabled={working}><span><strong>{channelLabel(item.channel, text)}</strong><small>{item.preview ?? text.noMessages}</small></span><small>{controlLabel(item.controlState, text)}</small></button>)}</div>
      {selected && <article className="assistant-profile-detail conversation-inbox__detail"><div className="workspace-title-row"><div><h3 ref={detailHeading} tabIndex={-1}>{channelLabel(selected.channel, text)}</h3><p>{controlLabel(selected.controlState, text)} · {formatDate(selected.lastActivityAt)}</p></div></div>
        <div className="conversation-inbox__messages" aria-label={text.messages}>{selected.messages.map((message) => <div key={message.messageId} className={`conversation-message conversation-message--${message.deliveryCategory}`}><strong>{message.deliveryCategory === "received" ? text.customer : text.sent}</strong><p>{message.content}</p><small>{formatDate(message.createdAt)}{message.delivery ? ` · ${message.delivery.state}` : ""}</small></div>)}</div>
        <div className="action-row conversation-inbox__controls">{manageable && selected.controlState !== "human_controlled" && <button className="button button--primary" type="button" disabled={working} onClick={() => void control("take")}>{text.take}</button>}{manageable && selected.controlState === "human_controlled" && <><button className="button button--secondary" type="button" disabled={working} onClick={() => void control("release")}>{text.release}</button><button className="button button--primary" type="button" disabled={working} onClick={() => void control("resolve")}>{text.resolve}</button></>}</div>
        {canSend && selected.controlState === "human_controlled" && <form className="edit-form conversation-inbox__composer" onSubmit={(event) => void send(event)}><label className="form-field"><span>{text.reply}</span><textarea required maxLength={10000} value={content} onChange={(event) => setContent(event.target.value)} disabled={working} /></label><button className="button button--primary" disabled={working || !content.trim()}>{working ? text.sending : text.send}</button></form>}
      </article>}
    </div>}
  </section>;
}

type Text = typeof english;
const english = { title: "Conversation inbox", description: "Review and handle customer conversations for the selected company.", refresh: "Refresh", loading: "Loading conversations...", empty: "No conversations yet", emptyDescription: "Incoming customer conversations will appear here.", companyRequired: "Select a company to view its conversations.", unavailable: "Conversations are unavailable.", listLabel: "Conversations", noMessages: "No messages", messages: "Messages", customer: "Customer", sent: "Sent", take: "Take over", release: "Release", resolve: "Resolve", reply: "Manual reply", send: "Send reply", sending: "Sending...", automated: "Automated", human_required: "Needs human", human_controlled: "Human controlled", whatsapp: "WhatsApp", web_chat: "Web chat", internal: "Internal" };
const spanish: Text = { title: "Bandeja de conversaciones", description: "Revisá y atendé las conversaciones de clientes de la empresa seleccionada.", refresh: "Actualizar", loading: "Cargando conversaciones...", empty: "Todavía no hay conversaciones", emptyDescription: "Las conversaciones entrantes de clientes aparecerán acá.", companyRequired: "Seleccioná una empresa para ver sus conversaciones.", unavailable: "Las conversaciones no están disponibles.", listLabel: "Conversaciones", noMessages: "Sin mensajes", messages: "Mensajes", customer: "Cliente", sent: "Enviado", take: "Tomar control", release: "Liberar", resolve: "Resolver", reply: "Respuesta manual", send: "Enviar respuesta", sending: "Enviando...", automated: "Automatizada", human_required: "Requiere atención", human_controlled: "Control humano", whatsapp: "WhatsApp", web_chat: "Chat web", internal: "Interna" };
function controlLabel(value: ConversationInboxItem["controlState"], text: Text): string { return text[value]; }
function channelLabel(value: ConversationInboxItem["channel"], text: Text): string { return text[value]; }
