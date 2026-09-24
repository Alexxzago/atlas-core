import { useEffect, useRef, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import type { VoiceAudioResponseMode, WhatsAppVoicePolicy } from "../types/api";
import { Radio } from "../design-system/primitives";

interface Props { readonly csrf:string; readonly workspaceId:string; readonly companyId:number; readonly connectionId:string; readonly manageable:boolean; }
type Draft = Pick<WhatsAppVoicePolicy,"voiceAiEnabled"|"audioResponseMode">;
type PendingOperation = { readonly key:string; readonly operationId:string; readonly expectedVersion:number; };

const same = (left: Draft, right: Draft): boolean => left.voiceAiEnabled === right.voiceAiEnabled && left.audioResponseMode === right.audioResponseMode;
const key = (draft: Draft): string => `${draft.voiceAiEnabled}:${draft.audioResponseMode}`;
const aborted = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

export function WhatsAppVoicePolicyPanel({ csrf, workspaceId, companyId, connectionId, manageable }: Props): React.JSX.Element {
  const { t } = useI18n();
  const [policy, setPolicy] = useState<WhatsAppVoicePolicy | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<"saved"|"conflict"|"error"|null>(null);
  const loadAbort = useRef<AbortController | null>(null), mutationAbort = useRef<AbortController | null>(null), request = useRef(0), operation = useRef<PendingOperation | null>(null);

  const load = async (preserveDraft: boolean): Promise<void> => {
    loadAbort.current?.abort();
    const controller = new AbortController(), current = ++request.current;
    loadAbort.current = controller;
    setLoading(true);
    try {
      const next = await atlasApi.getWhatsAppVoicePolicy(workspaceId, companyId, connectionId, controller.signal);
      if (controller.signal.aborted || current !== request.current) return;
      setPolicy(next);
      if (!preserveDraft) setDraft({ voiceAiEnabled: next.voiceAiEnabled, audioResponseMode: next.audioResponseMode });
    } catch (error: unknown) {
      if (!controller.signal.aborted && current === request.current && !aborted(error)) setMessage("error");
    } finally { if (!controller.signal.aborted && current === request.current) setLoading(false); }
  };

  useEffect(() => {
    operation.current = null;
    setPolicy(null); setDraft(null); setMessage(null); setLoading(true);
    void load(false);
    return () => { loadAbort.current?.abort(); mutationAbort.current?.abort(); };
  }, [workspaceId, companyId, connectionId]);

  const change = (next: Partial<Draft>): void => {
    if (!draft) return;
    const value = { ...draft, ...next };
    if (operation.current?.key !== key(value)) operation.current = null;
    setDraft(value); setMessage(null);
  };

  const save = async (): Promise<void> => {
    if (!manageable || !policy || !draft || saving || same(policy, draft)) return;
    const draftKey = key(draft), existing = operation.current;
    const pending = existing && existing.key === draftKey && existing.expectedVersion === policy.version ? existing : { key: draftKey, operationId: crypto.randomUUID(), expectedVersion: policy.version };
    operation.current = pending;
    mutationAbort.current?.abort();
    const controller = new AbortController(), current = ++request.current;
    mutationAbort.current = controller;
    setSaving(true); setMessage(null);
    try {
      const saved = await atlasApi.updateWhatsAppVoicePolicy(csrf, workspaceId, companyId, connectionId, { operationId: pending.operationId, expectedVersion: pending.expectedVersion, ...draft }, controller.signal);
      if (controller.signal.aborted || current !== request.current) return;
      operation.current = null; setPolicy(saved); setDraft({ voiceAiEnabled: saved.voiceAiEnabled, audioResponseMode: saved.audioResponseMode }); setMessage("saved");
    } catch (error: unknown) {
      if (controller.signal.aborted || current !== request.current || aborted(error)) return;
      if (error instanceof ApiError && error.status === 409) { operation.current = null; setMessage("conflict"); await load(true); if (!controller.signal.aborted) setSaving(false); }
      else { setMessage("error"); }
    } finally { if (!controller.signal.aborted && current === request.current) setSaving(false); }
  };

  const disabled = !manageable || saving;
  return <section className="whatsapp-scenario-guidance whatsapp-voice-policy" aria-busy={loading || saving}>
    <h4>{t("voicePolicy.title")}</h4>
    <p>{t("voicePolicy.lead")}</p>
    <p>{t("voicePolicy.availability")}</p>
    {loading || !policy || !draft ? <p role="status">{t("voicePolicy.loading")}</p> : <>
      <label className="whatsapp-prerequisite-confirm"><input aria-label={t("voicePolicy.toggle")} type="checkbox" checked={draft.voiceAiEnabled} disabled={disabled} onChange={event => change({ voiceAiEnabled: event.target.checked })}/><span>{t("voicePolicy.toggle")}</span></label>
      <fieldset disabled={disabled || !draft.voiceAiEnabled}><legend>{t("voicePolicy.mode")}</legend>
        <label className="ds-radio-label"><Radio name={`voice-policy-${connectionId}`} disabled={disabled || !draft.voiceAiEnabled} checked={draft.audioResponseMode === "text_only"} onChange={() => change({ audioResponseMode: "text_only" })}/>{t("voicePolicy.textOnly")}</label>
        <label className="ds-radio-label"><Radio name={`voice-policy-${connectionId}`} disabled={disabled || !draft.voiceAiEnabled} checked={draft.audioResponseMode === "voice_with_text_fallback"} onChange={() => change({ audioResponseMode: "voice_with_text_fallback" })}/>{t("voicePolicy.voiceFallback")}</label>
      </fieldset>
      {!manageable && <p>{t("voicePolicy.readOnly")}</p>}
      {manageable && <button className="button button--primary" type="button" disabled={saving || same(policy, draft)} onClick={() => void save()}>{t(saving ? "voicePolicy.saving" : "voicePolicy.save")}</button>}
      {message && <p className={`inline-message ${message === "saved" ? "inline-message--success" : "inline-message--error"}`} role={message === "saved" ? "status" : "alert"}>{t(message === "saved" ? "voicePolicy.saved" : message === "conflict" ? "voicePolicy.conflict" : "voicePolicy.error")}</p>}
    </>}
  </section>;
}
