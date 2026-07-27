import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { PublicWebChatApiError, publicWebChatApi, type PublicWebChatHistoryMessage } from "../api/publicWebChatApi";

type ChatStatus = "initializing" | "ready" | "sending" | "unavailable" | "error" | "closed";
type ChatMessage = { readonly localId: number; readonly role: "visitor" | "assistant"; readonly content: string; };

const welcome: ChatMessage = { localId: 0, role: "assistant", content: "Hola, soy Atlas. ¿En qué puedo ayudarte?" };
function historicalMessages(messages: readonly PublicWebChatHistoryMessage[]): readonly ChatMessage[] { return messages.map((message, index) => ({ localId: index + 1, role: message.direction === "inbound" ? "visitor" : "assistant", content: message.content })); }

export function publicConnectionIdFromPath(pathname: string): string | null {
  const match = /^\/chat\/(wcp_[0-9a-f]{32})\/?$/i.exec(pathname);
  return match?.[1] ?? null;
}

function messageError(status: number): string {
  if (status === 400) return "Revisá el mensaje e intentá nuevamente.";
  if (status === 409) return "Esperá unos segundos antes de enviar otro mensaje.";
  if (status === 413) return "El mensaje es demasiado largo.";
  if (status === 404) return "Este chat no está disponible en este momento.";
  return "No pudimos responder en este momento. Intentá nuevamente.";
}

export function PublicChatPage({ connectionPublicId }: { readonly connectionPublicId: string }): React.JSX.Element {
  const [status, setStatus] = useState<ChatStatus>("initializing");
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const nextLocalId = useRef(1);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const interactive = status === "ready" || status === "error";

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        await publicWebChatApi.startSession(connectionPublicId);
        try {
          const history = await publicWebChatApi.history(connectionPublicId);
          if (!current) return;
          const hydrated = historicalMessages(history.messages); nextLocalId.current = hydrated.length + 1;
          setMessages(hydrated.length ? hydrated : [welcome]); setStatus("ready");
        } catch {
          if (!current) return;
          setNotice("No pudimos restaurar los mensajes anteriores."); setStatus("ready");
        }
      } catch { if (current) setStatus("unavailable"); }
    })();
    return () => { current = false; };
  }, [connectionPublicId]);

  const send = async (): Promise<void> => {
    const message = draft.normalize("NFKC").trim();
    if (!interactive || !message) { if (!message) setNotice("Revisá el mensaje e intentá nuevamente."); return; }
    if (Array.from(message).length > 4_000) { setNotice("El mensaje es demasiado largo."); return; }
    setMessages((current) => [...current, { localId: nextLocalId.current++, role: "visitor", content: message }]);
    setDraft(""); setNotice(null); setStatus("sending");
    try {
      const response = await publicWebChatApi.sendMessage(connectionPublicId, message);
      setMessages((current) => [...current, { localId: nextLocalId.current++, role: "assistant", content: response.message }]);
      setStatus("ready");
      window.setTimeout(() => textarea.current?.focus(), 0);
    } catch (error: unknown) {
      const code = error instanceof PublicWebChatApiError ? error.status : 503;
      const copy = messageError(code);
      setNotice(copy);
      setStatus(code === 404 ? "unavailable" : "error");
    }
  };

  const close = async (): Promise<void> => {
    if (!interactive) return;
    setStatus("sending"); setNotice(null);
    try { await publicWebChatApi.closeSession(connectionPublicId); setMessages([]); setStatus("closed"); }
    catch { setNotice("No pudimos cerrar la conversación en este momento."); setStatus("error"); }
  };

  const submit = (event: FormEvent): void => { event.preventDefault(); void send(); };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } };
  const stateCopy = status === "initializing" ? "Conectando..." : status === "sending" ? "Atlas está respondiendo..." : status === "unavailable" ? "Este chat no está disponible en este momento." : status === "closed" ? "La conversación fue cerrada." : "Chat listo";

  return <main className="public-chat-shell"><section className="public-chat" aria-labelledby="public-chat-title"><header className="public-chat__header"><div><p className="public-chat__eyebrow">ATLAS</p><h1 id="public-chat-title">Conversación</h1></div><button className="button button--secondary button--compact" type="button" onClick={() => void close()} disabled={!interactive}>Cerrar sesión</button></header><p className={`public-chat__state public-chat__state--${status}`} role="status">{stateCopy}</p><div className="public-chat__messages" role="log" aria-live="polite" aria-relevant="additions">{messages.map((message) => <article key={message.localId} className={`public-chat__message public-chat__message--${message.role}`}><strong>{message.role === "visitor" ? "Vos" : "Atlas"}</strong><p>{message.content}</p></article>)}{status === "sending" && <div className="public-chat__typing" role="status"><span className="spinner" aria-hidden="true" />Atlas está respondiendo...</div>}</div>{notice && <p className="public-chat__notice" role="alert">{notice}</p>}<form className="public-chat__composer" onSubmit={submit}><label htmlFor="public-chat-message">Tu mensaje</label><textarea ref={textarea} id="public-chat-message" rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={keyDown} placeholder="Escribí tu consulta" disabled={!interactive} maxLength={16_000} /><div><span className="supporting-copy">Enter para enviar. Shift+Enter para nueva línea.</span><button className="button button--primary" disabled={!interactive || !draft.trim()}>{status === "sending" ? "Enviando..." : "Enviar"}</button></div></form></section></main>;
}
