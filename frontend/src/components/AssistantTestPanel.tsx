import { useEffect, useRef, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import type { AssistantProfile, Permission } from "../types/api";

type Mode = "preview" | "active";
type Outcome = "answered" | "safe_fallback";

interface Props { csrf: string; workspaceId: string | null; companyId: number | null; profile: AssistantProfile; capabilities: readonly Permission[]; onNavigate?: (path: string) => void; }

function errorPresentation(error: unknown): { key: "assistantTest.invalid" | "assistantTest.forbidden" | "assistantTest.notFound" | "assistantTest.conflict" | "assistantTest.rateLimited" | "assistantTest.unavailable" | "assistantTest.network"; destination: "general" | "status" | null } {
  if (!(error instanceof ApiError)) return { key: "assistantTest.network", destination: null };
  if (error.status === 400) return { key: "assistantTest.invalid", destination: null };
  if (error.status === 403) return { key: "assistantTest.forbidden", destination: null };
  if (error.status === 404) return { key: "assistantTest.notFound", destination: null };
  if (error.status === 429) return { key: "assistantTest.rateLimited", destination: null };
  if (error.status === 503) return { key: "assistantTest.unavailable", destination: null };
  if (error.status === 409 && error.code === "assistant_profile_not_executable") return { key: "assistantTest.conflict", destination: "general" };
  if (error.status === 409 && (error.code === "company_not_ready" || error.code === "knowledge_unavailable")) return { key: "assistantTest.conflict", destination: "status" };
  return { key: "assistantTest.unavailable", destination: null };
}

export function AssistantTestPanel({ csrf, workspaceId, companyId, profile, capabilities, onNavigate }: Props): React.JSX.Element {
  const { t } = useI18n();
  const canPreview = capabilities.includes("assistant:preview"), canActive = capabilities.includes("chat:use");
  const [mode, setMode] = useState<Mode>(canPreview ? "preview" : "active");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<{ outcome: Outcome; text: string } | null>(null);
  const [error, setError] = useState<ReturnType<typeof errorPresentation> | null>(null);
  const controller = useRef<AbortController | null>(null), generation = useRef(0);
  const length = Array.from(message.trim()).length;

  useEffect(() => {
    generation.current += 1;
    controller.current?.abort();
    setPending(false); setMessage(""); setAnswer(null); setError(null);
  }, [workspaceId, companyId, profile.id, profile.status]);
  useEffect(() => {
    generation.current += 1;
    controller.current?.abort();
    setPending(false);
    if (canPreview || canActive) { if (mode === "preview" && !canPreview) setMode("active"); if (mode === "active" && !canActive) setMode("preview"); }
  }, [canPreview, canActive]);
  useEffect(() => () => { generation.current += 1; controller.current?.abort(); }, []);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (pending || !workspaceId || !companyId || length < 1 || length > 2_000 || (mode === "preview" ? !canPreview : !canActive)) return;
    controller.current?.abort(); const active = new AbortController(); controller.current = active;
    const current = ++generation.current; setPending(true); setError(null);
    try {
      const result = mode === "preview"
        ? await atlasApi.previewAssistantProfile(csrf, workspaceId, companyId, profile.id, message.trim(), active.signal)
        : await atlasApi.executeAssistantProfile(csrf, workspaceId, companyId, profile.id, message.trim(), active.signal);
      if (generation.current === current) setAnswer({ outcome: result.status, text: result.answer });
    } catch (caught: unknown) {
      if (!(caught instanceof DOMException && caught.name === "AbortError") && generation.current === current) setError(errorPresentation(caught));
    } finally { if (generation.current === current) setPending(false); }
  };
  const href = error?.destination === "general" ? `/companies/${companyId}/assistant/${profile.id}/general` : error?.destination === "status" ? `/companies/${companyId}/assistant/${profile.id}/status` : null;
  const available = canPreview || canActive;
  return <section className="assistant-preview" aria-labelledby="assistant-test-title" aria-busy={pending}>
    <p className="atlas-eyebrow">{t("assistantTest.eyebrow")}</p><h2 id="assistant-test-title">{t("assistantTest.title")}</h2><p>{t("assistantTest.lead")}</p>
    {!available ? <p role="status">{t("assistantTest.noPermission")}</p> : <>
      <div className="assistant-test-modes" role="tablist" aria-label={t("assistantTest.modeLabel")}>
        <button className={`assistant-test-mode${mode === "preview" ? " is-selected" : ""}`} type="button" role="tab" aria-controls="assistant-test-content" aria-selected={mode === "preview"} disabled={!canPreview} onClick={() => setMode("preview")}>{t("assistantTest.preview")}</button>
        <button className={`assistant-test-mode${mode === "active" ? " is-selected" : ""}`} type="button" role="tab" aria-controls="assistant-test-content" aria-selected={mode === "active"} disabled={!canActive} onClick={() => setMode("active")}>{t("assistantTest.active")}</button>
      </div>
      <div id="assistant-test-content" className="assistant-test-content" role="tabpanel"><p>{t(mode === "preview" ? "assistantTest.previewLead" : "assistantTest.activeLead")}</p>{profile.status !== "ready" && <p role="status">{t("assistantTest.readyRequired")}</p>}
        <form className="assistant-preview-form" onSubmit={(event) => void submit(event)}><label className="form-field"><span>{t("assistantTest.messageLabel")}</span><textarea value={message} maxLength={2_000} disabled={pending || profile.status !== "ready"} placeholder={t("assistantTest.placeholder")} onChange={(event) => setMessage(event.target.value)} /><small>{t("assistantTest.limit", { count: String(length) })}</small></label><button className="button button--primary" type="submit" disabled={pending || profile.status !== "ready" || length < 1 || length > 2_000}>{pending ? t("assistantTest.sending") : t("assistantTest.send")}</button></form>
      </div>
      {pending && <p role="status">{t("assistantTest.responding")}</p>}
      {answer && <div className={`assistant-preview-result${answer.outcome === "safe_fallback" ? " assistant-preview-result--fallback" : ""}`} aria-live="polite"><strong>{t(answer.outcome === "safe_fallback" ? "assistantTest.fallback" : "assistantTest.answer")}</strong>{answer.outcome === "safe_fallback" && <p>{t("assistantTest.fallbackCue")}</p>}<p>{answer.text}</p></div>}
      {error && <p className="inline-message inline-message--error" role="alert">{t(error.key)}{href && <> <a href={href} onClick={(event) => { event.preventDefault(); onNavigate?.(href); }}>{t(error.destination === "general" ? "assistantTest.goGeneral" : "assistantTest.goStatus")}</a></>}</p>}
    </>}
  </section>;
}
