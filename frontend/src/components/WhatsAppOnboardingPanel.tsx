import { useEffect, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import type { AssistantProfile, AssistantReadinessAssessment, CompanyStatus, Permission, WhatsAppConnection, WhatsAppConnectionOperationalStatus } from "../types/api";

interface Props { readonly csrf: string; readonly workspaceId: string | null; readonly companyId: number | null; readonly companyStatus?: CompanyStatus | null; readonly profiles: readonly AssistantProfile[]; readonly capabilities: readonly Permission[]; }

function errorMessage(error: unknown): string { return error instanceof ApiError ? error.message : "WhatsApp setup is temporarily unavailable."; }
function validationError(status: WhatsAppConnectionOperationalStatus): string { return status.validationFailureCode === "provider_unavailable" ? "WhatsApp provider validation is temporarily unavailable." : "WhatsApp credentials could not be validated."; }
function blockerKey(value: string): "whatsapp.blocker.defaultAssistantMissing" | "whatsapp.blocker.publishedKnowledgeMissing" | "whatsapp.blocker.generic" { if (value === "default_assistant_missing") return "whatsapp.blocker.defaultAssistantMissing"; if (value === "published_knowledge_missing") return "whatsapp.blocker.publishedKnowledgeMissing"; return "whatsapp.blocker.generic"; }

export function WhatsAppOnboardingPanel({ csrf, workspaceId, companyId, profiles, capabilities }: Props): React.JSX.Element | null {
  const { t, formatDate } = useI18n();
  const [connections, setConnections] = useState<readonly WhatsAppConnection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [status, setStatus] = useState<WhatsAppConnectionOperationalStatus | null>(null);
  const [readiness, setReadiness] = useState<AssistantReadinessAssessment | null>(null);
  const [profileId, setProfileId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const readable = capabilities.includes("company:read"), manageable = capabilities.includes("company:manage");
  const readyProfiles = profiles.filter((profile) => profile.status === "ready");
  const readinessValue = readiness && Array.isArray(readiness.blockers) ? readiness : null;
  const activeConnection = connections.find((connection) => connection.id === connectionId) ?? null;

  const loadStatus = async (id: string): Promise<void> => {
    if (!workspaceId || !companyId) return;
    setStatus(await atlasApi.getWhatsAppConnectionStatus(workspaceId, companyId, id));
  };
  const refreshReadiness = async (): Promise<void> => { if (!workspaceId || !companyId) return; setReadiness(await atlasApi.refreshAssistantReadiness(csrf, workspaceId, companyId)); };

  useEffect(() => {
    let current = true;
    setConnections([]); setConnectionId(""); setStatus(null); setReadiness(null); setError(null); setNotice(null);
    if (!workspaceId || !companyId || !readable) return () => { current = false; };
    setLoading(true);
    void Promise.all([atlasApi.listWhatsAppConnections(workspaceId, companyId), atlasApi.getAssistantReadiness(workspaceId, companyId).catch(() => atlasApi.refreshAssistantReadiness(csrf, workspaceId, companyId))]).then(([value, assessment]) => { if (current) { setConnections(value); setReadiness(Array.isArray(assessment.blockers) ? assessment : null); } }).catch((cause: unknown) => { if (current) setError(errorMessage(cause)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [workspaceId, companyId, readable]);

  const selectConnection = async (id: string): Promise<void> => {
    setConnectionId(id); setStatus(null); setError(null); setNotice(null);
    if (!id) return;
    setLoading(true);
    try { await loadStatus(id); } catch (cause: unknown) { setError(errorMessage(cause)); } finally { setLoading(false); }
  };
  const create = async (): Promise<void> => {
    if (!workspaceId || !companyId || !profileId || !phoneNumberId.trim() || !businessAccountId.trim() || pending) return;
    setPending(true); setError(null); setNotice(null);
    try {
      const created = await atlasApi.createWhatsAppConnection(csrf, workspaceId, companyId, { assistantProfileId: profileId, phoneNumberId: phoneNumberId.trim(), whatsappBusinessAccountId: businessAccountId.trim() });
      setConnections((current) => [...current, created]); setConnectionId(created.id); setProfileId(""); setPhoneNumberId(""); setBusinessAccountId(""); await loadStatus(created.id); await refreshReadiness(); setNotice(t("whatsapp.connectionCreated"));
    } catch (cause: unknown) { setError(errorMessage(cause)); } finally { setPending(false); }
  };
  const configureCredentials = async (): Promise<void> => {
    if (!workspaceId || !companyId || !connectionId || !accessToken.trim() || pending) return;
    setPending(true); setError(null); setNotice(null);
    try { setStatus(await atlasApi.configureWhatsAppCredentials(csrf, workspaceId, companyId, connectionId, accessToken.trim())); await refreshReadiness(); setAccessToken(""); setNotice(t("whatsapp.credentialsSaved")); } catch (cause: unknown) { setError(errorMessage(cause)); } finally { setPending(false); }
  };
  const operation = async (action: "validate" | "activate" | "deactivate"): Promise<void> => {
    if (!workspaceId || !companyId || !connectionId || pending) return;
    setPending(true); setError(null); setNotice(null);
    try {
      const updated = action === "validate" ? await atlasApi.validateWhatsAppConnection(csrf, workspaceId, companyId, connectionId) : action === "activate" ? await atlasApi.activateWhatsAppConnection(csrf, workspaceId, companyId, connectionId) : await atlasApi.deactivateWhatsAppConnection(csrf, workspaceId, companyId, connectionId);
      setStatus(updated); setConnections((current) => current.map((connection) => connection.id === updated.connection.id ? updated.connection : connection)); await refreshReadiness(); if (action === "validate" && updated.validationState !== "valid") { setError(validationError(updated)); return; } setNotice(t(action === "validate" ? "whatsapp.validated" : action === "activate" ? "whatsapp.activated" : "whatsapp.deactivated"));
    } catch (cause: unknown) { setError(errorMessage(cause)); } finally { setPending(false); }
  };

  if (!workspaceId || !companyId) return <section className="authenticated-section"><h2>{t("whatsapp.title")}</h2><p className="state-copy">{t("whatsapp.companyRequired")}</p></section>;
  if (!readable) return null;
  const validationValid = status?.validationState === "valid";
  return <section className="authenticated-section whatsapp-onboarding" aria-busy={loading || pending}>
    <div className="section-heading"><div><h2>{t("whatsapp.title")}</h2><p>{t("whatsapp.description")}</p></div></div>
    {error && <div className="inline-message inline-message--error" role="alert">{error}</div>}
    {notice && <div className="inline-message inline-message--success" role="status">{notice}</div>}
    <ol className="whatsapp-steps">
       <li className={readinessValue?.status === "ready" ? "is-complete" : ""}><div><strong>{t("whatsapp.step.company")}</strong><p>{readinessValue?.status === "ready" ? t("whatsapp.companyReady") : t("whatsapp.companyNotReady")}</p></div></li>
       <li className={readinessValue?.assistantProfileId ? "is-complete" : ""}><div><strong>{t("whatsapp.step.profile")}</strong><p>{readinessValue?.assistantProfileId ? t("whatsapp.profileReady") : t("whatsapp.profileRequired")}</p></div></li>
       <li className={activeConnection ? "is-complete" : ""}><div><strong>{t("whatsapp.step.configuration")}</strong><p>{activeConnection ? t("whatsapp.connectionSelected") : t("whatsapp.connectionRequired")}</p></div></li>
       <li className={status?.credentialsConfigured ? "is-complete" : ""}><div><strong>{t("whatsapp.step.credentials")}</strong><p>{status?.credentialsConfigured ? t("whatsapp.credentialsConfigured") : t("whatsapp.credentialsRequired")}</p></div></li>
       <li className={validationValid ? "is-complete" : ""}><div><strong>{t("whatsapp.step.validation")}</strong><p>{validationValid ? t("whatsapp.validationValid") : t("whatsapp.validationRequired")}</p></div></li>
       <li className={status?.connection.status === "active" ? "is-complete" : ""}><div><strong>{t("whatsapp.step.activation")}</strong><p>{status?.connection.status === "active" ? t("whatsapp.active") : t("whatsapp.inactive")}</p></div></li>
       <li><div><strong>{t("whatsapp.step.status")}</strong><p>{status ? t(status.healthState === "healthy" ? "whatsapp.health.healthy" : status.healthState === "degraded" ? "whatsapp.health.degraded" : "whatsapp.health.inactive") : t("whatsapp.statusUnavailable")}</p></div></li>
     </ol>
      {readinessValue && <div role="status">{readinessValue.status === "ready" ? "Ready" : <ul>{readinessValue.blockers.map((blocker) => <li key={blocker}>{t(blockerKey(blocker))}</li>)}</ul>}</div>}
    {manageable && <div className="whatsapp-workflow">
      <label className="form-field"><span>{t("whatsapp.connectionSelect")}</span><select value={connectionId} onChange={(event) => void selectConnection(event.target.value)} disabled={loading || pending}><option value="">{t("whatsapp.connectionPlaceholder")}</option>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.phoneNumberId}</option>)}</select></label>
       {!activeConnection && <><aside className="whatsapp-help-card"><strong>{t("experience.whatsapp.helpTitle")}</strong><p>{t("experience.whatsapp.phoneHelp")}</p><p>{t("experience.whatsapp.businessHelp")}</p></aside><div className="whatsapp-create"><label className="form-field"><span>{t("whatsapp.profileSelect")}</span><select value={profileId} onChange={(event) => setProfileId(event.target.value)} disabled={pending}><option value="">{t("whatsapp.profilePlaceholder")}</option>{readyProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><label className="form-field"><span>{t("whatsapp.phoneNumberId")}</span><input value={phoneNumberId} onChange={(event) => setPhoneNumberId(event.target.value)} disabled={pending}/></label><label className="form-field"><span>{t("whatsapp.businessAccountId")}</span><input value={businessAccountId} onChange={(event) => setBusinessAccountId(event.target.value)} disabled={pending}/></label><button className="button button--secondary" type="button" onClick={() => void create()} disabled={!profileId || !phoneNumberId.trim() || !businessAccountId.trim() || pending}>{t("whatsapp.createConnection")}</button></div></>}
      {activeConnection && status && <><div className="whatsapp-credential-row"><label className="form-field"><span>{t("whatsapp.accessToken")}</span><input type="password" autoComplete="off" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} disabled={pending}/></label><button className="button button--secondary" type="button" onClick={() => void configureCredentials()} disabled={!accessToken.trim() || pending}>{t("whatsapp.saveCredentials")}</button></div><div className="action-row"><button className="button button--secondary" type="button" onClick={() => void operation("validate")} disabled={!status.credentialsConfigured || pending}>{t("whatsapp.validate")}</button><button className="button button--primary" type="button" onClick={() => void operation("activate")} disabled={!validationValid || status.connection.status === "active" || pending}>{t("whatsapp.activate")}</button>{status.connection.status === "active" && <button className="button button--secondary" type="button" onClick={() => void operation("deactivate")} disabled={pending}>{t("whatsapp.deactivate")}</button>}</div><p className="supporting-copy">{t("whatsapp.lastUpdated", { date: formatDate(status.updatedAt) })}</p></>}
    </div>}
    {loading && <p role="status">{t("common.loading")}</p>}
  </section>;
}
