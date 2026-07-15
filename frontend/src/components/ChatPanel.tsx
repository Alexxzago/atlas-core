import { useEffect, useRef, useState, type FormEvent } from "react";
import { atlasApi } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import type { Company } from "../types/api";

interface Message { id: number; role: "user" | "atlas" | "system"; text: string; }

export function ChatPanel({ company }: { company: Company }): React.JSX.Element {
  const { t } = useI18n();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const nextId = useRef(1);
  const enabled = company.status === "ready";

  useEffect(() => { setMessages([]); setDraft(""); setLastFailedMessage(null); nextId.current = 1; }, [company.id]);

  const send = async (message: string): Promise<void> => {
    const cleanMessage = message.trim();
    if (!cleanMessage || sending || !enabled) return;
    setMessages((current) => [...current, { id: nextId.current++, role: "user", text: cleanMessage }]);
    setDraft(""); setSending(true); setLastFailedMessage(null);
    try {
      const response = await atlasApi.chat(company.id, cleanMessage);
      const role = response.status === "answered" ? "atlas" : "system";
      const text = response.status === "answered"
        ? response.answer
        : response.status === "knowledge_not_found"
          ? t("chat.missingKnowledge")
          : t("chat.error");
      setMessages((current) => [...current, { id: nextId.current++, role, text }]);
    } catch {
      setMessages((current) => [...current, { id: nextId.current++, role: "system", text: t("chat.error") }]);
      setLastFailedMessage(cleanMessage);
    } finally { setSending(false); }
  };

  const submit = (event: FormEvent): void => { event.preventDefault(); void send(draft); };
  const unavailable = company.status === "processing" ? t("chat.unavailableProcessing") : t("chat.unavailableFailed");

  return (
    <section className="workspace-section chat-section" aria-labelledby="chat-title">
      <div className="section-heading"><div><h2 id="chat-title">{t("chat.title")}</h2><p>{t("chat.context", { companyName: company.name })}</p></div></div>
      <p className="language-note">{t("chat.languageNote")}</p>
      {!enabled && <div className="inline-message inline-message--warning" role="status">{unavailable}</div>}
      <div className="chat-log" role="log" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 && <div className="chat-empty"><strong>{t("chat.emptyTitle")}</strong><p>{t("chat.emptyDescription")}</p></div>}
        {messages.map((message) => <article key={message.id} className={`chat-message chat-message--${message.role}`}><strong>{t(message.role === "user" ? "chat.user" : message.role === "atlas" ? "chat.atlas" : "chat.system")}</strong><p>{message.text}</p></article>)}
        {sending && <div className="chat-responding" role="status"><span className="spinner" aria-hidden="true" />{t("chat.responding")}</div>}
      </div>
      {lastFailedMessage && <button className="button button--secondary chat-retry" type="button" onClick={() => void send(lastFailedMessage)} disabled={sending}>{t("chat.retry")}</button>}
      <form className="chat-composer" onSubmit={submit}><label className="sr-only" htmlFor="chat-message">{t("chat.placeholder")}</label><textarea id="chat-message" rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("chat.placeholder")} disabled={!enabled || sending} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button className="button button--primary" disabled={!enabled || sending || !draft.trim()}>{sending ? t("chat.sending") : t("chat.send")}</button></form>
      <p className="supporting-copy">{t("chat.clearOnSwitch")}</p>
    </section>
  );
}
