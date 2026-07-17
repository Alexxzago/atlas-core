import { useEffect, useReducer, useRef, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import type { AssistantProfile } from "../types/api";
import { abortPreview, assistantPreviewAccessibility, assistantPreviewReducer, initialAssistantPreviewState, previewMessageLength, previewMessageValid } from "../state/assistantPreviewState";

interface Props {
  csrf: string;
  workspaceId: string;
  companyId: number;
  companyName: string;
  profile: AssistantProfile;
  allowed: boolean;
}

export function AssistantPreviewPanel(props: Props): React.JSX.Element | null {
  const { t } = useI18n();
  const [message, setMessage] = useState("");
  const [state, dispatch] = useReducer(assistantPreviewReducer, initialAssistantPreviewState);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    request.current += 1;
    abortPreview(controller.current);
    setMessage("");
    dispatch({ type: "contextChanged" });
    return () => abortPreview(controller.current);
  }, [props.workspaceId, props.companyId, props.profile.id, props.profile.status]);

  if (!props.allowed) return null;
  const length = previewMessageLength(message);
  const executable = props.profile.status === "ready";
  const pending = state.status === "pending";

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!executable || !previewMessageValid(message) || pending) return;
    abortPreview(controller.current);
    const active = new AbortController(); controller.current = active;
    const requestId = ++request.current;
    dispatch({ type: "started", requestId });
    try {
      const result = await atlasApi.previewAssistantProfile(props.csrf, props.workspaceId, props.companyId, props.profile.id, message.trim(), active.signal);
      dispatch({ type: "succeeded", requestId, outcome: result.status, answer: result.answer });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const code = error instanceof ApiError ? error.code : null;
      const key = code === "assistant_profile_not_executable" ? "preview.profileUnavailable"
        : code === "company_not_ready" ? "preview.companyUnavailable"
        : code === "knowledge_unavailable" ? "preview.knowledgeUnavailable"
        : error instanceof ApiError && error.status === 400 ? "preview.invalid"
        : "preview.temporarilyUnavailable";
      dispatch({ type: "failed", requestId, key });
    }
  };

  return <section className="assistant-preview" aria-labelledby="assistant-preview-title">
    <div><h4 id="assistant-preview-title">{t("preview.title")}</h4><p>{t("preview.context", { profileName: props.profile.name, companyName: props.companyName })}</p></div>
    {!executable && <div className="inline-message inline-message--warning" role="status">{t("preview.readyRequired")}</div>}
    <form className="assistant-preview-form" onSubmit={(event) => void submit(event)}>
      <label className="form-field"><span>{t("preview.messageLabel")}</span><textarea value={message} maxLength={2_000} disabled={!executable || pending} placeholder={t("preview.placeholder")} onChange={(event) => setMessage(event.target.value)}/><small>{t("preview.limit", { count: String(length) })}</small></label>
      <button className="button button--primary" type="submit" disabled={!executable || pending || length < 1 || length > 2_000}>{pending ? t("preview.sending") : t("preview.send")}</button>
    </form>
    {pending && <p role={assistantPreviewAccessibility.pendingRole}>{t("preview.responding")}</p>}
    {(state.status === "answered" || state.status === "safe_fallback") && <div className={`assistant-preview-result${state.status === "safe_fallback" ? " assistant-preview-result--fallback" : ""}`} aria-live={assistantPreviewAccessibility.resultLive}><strong>{state.status === "safe_fallback" ? t("preview.fallback") : t("preview.answer")}</strong><p>{state.answer}</p></div>}
    {state.status === "error" && <div className="inline-message inline-message--error" role={assistantPreviewAccessibility.errorRole}>{t(state.key)}</div>}
  </section>;
}
