import { useEffect, useRef, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import type { AssistantProfile, CompanyStatus, Permission, WebChatConnection, WebChatConnectionStatus } from "../types/api";
import { EmptyExperience } from "../design-system/product";
import { Alert, Button, Select, StatusBadge, Surface } from "../design-system/primitives";

interface Props {
  readonly csrf: string;
  readonly workspaceId: string | null;
  readonly companyId: number | null;
  readonly companyStatus: CompanyStatus | null;
  readonly profiles: readonly AssistantProfile[];
  readonly capabilities: readonly Permission[];
  readonly onNavigate?: (path: string) => void;
}

function publicUrl(publicId: string): string {
  return new URL(`/chat/${publicId}`, window.location.origin).href;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function WebChatConnectionsPanel({ csrf, workspaceId, companyId, companyStatus, profiles, capabilities, onNavigate }: Props): React.JSX.Element | null {
  const { t, formatDate } = useI18n();
  const [connections, setConnections] = useState<readonly WebChatConnection[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const createInFlight = useRef(false);
  const readable = capabilities.includes("company:read");
  const manageable = capabilities.includes("company:manage");
  const companyReady = companyStatus === "ready";
  const readyProfiles = profiles.filter((profile) => profile.status === "ready");

  useEffect(() => {
    let current = true;
    setConnections([]); setSelectedProfileId(""); setError(null); setNotice(null);
    if (!workspaceId || !companyId || !readable) return () => { current = false; };
    setLoading(true);
    void atlasApi.listWebChatConnections(workspaceId, companyId)
      .then((value) => { if (current) setConnections(value); })
      .catch((cause: unknown) => { if (current) setError(errorMessage(cause, t("webChat.unavailable"))); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [workspaceId, companyId, readable]);

  const create = async (): Promise<void> => {
    if (!workspaceId || !companyId || !companyReady || !selectedProfileId || submitting || createInFlight.current) return;
    createInFlight.current = true;
    setSubmitting(true); setError(null); setNotice(null);
    try {
      await atlasApi.createWebChatConnection(csrf, workspaceId, companyId, selectedProfileId);
      const refreshed = await atlasApi.listWebChatConnections(workspaceId, companyId);
      setConnections(refreshed); setSelectedProfileId(""); setNotice(t("webChat.create"));
    } catch (cause: unknown) { setError(errorMessage(cause, t("webChat.unavailable"))); }
    finally { createInFlight.current = false; setSubmitting(false); }
  };

  const setStatus = async (connection: WebChatConnection, status: WebChatConnectionStatus): Promise<void> => {
    if (!workspaceId || !companyId || submitting) return;
    setSubmitting(true); setError(null); setNotice(null);
    try {
      const updated = await atlasApi.updateWebChatConnectionStatus(csrf, workspaceId, companyId, connection.id, status);
      setConnections((current) => current.map((value) => value.id === updated.id ? updated : value));
    } catch (cause: unknown) { setError(errorMessage(cause, t("webChat.unavailable"))); }
    finally { setSubmitting(false); }
  };

  const copy = async (url: string): Promise<void> => {
    try { await navigator.clipboard.writeText(url); setNotice(t("webChat.copied")); }
    catch { setError(t("webChat.copyError")); }
  };

  if (!workspaceId || !companyId) return <section className="authenticated-section"><h2>{t("webChat.title")}</h2><p className="state-copy">{t("webChat.companyRequired")}</p></section>;
  if (!readable) return null;

  return <Surface className="web-chat-connections" aria-busy={loading || submitting} aria-labelledby="web-chat-title">
    <div className="section-heading web-chat-connections__header"><div><p className="eyebrow">{t("channels.webChat")}</p><h1 id="web-chat-title">{t("webChat.title")}</h1><p>{t("webChat.description")}</p></div></div>
    {error && <Alert tone="danger">{error}</Alert>}
    {notice && <Alert tone="success">{notice}</Alert>}
    {manageable && <Surface className="web-chat-connections__create" tone="subtle"><div><h3>{t("webChat.create")}</h3><p>{t("webChat.description")}</p></div>{readyProfiles.length>0?<><label className="ds-field"><span className="ds-field__label">{t("webChat.profile")}</span><Select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)} disabled={submitting}><option value="">{t("webChat.profilePlaceholder")}</option>{readyProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</Select></label><div className="action-row"><Button onClick={() => void create()} disabled={!companyReady || !selectedProfileId || submitting}>{submitting ? t("common.saving") : t("webChat.create")}</Button></div></>:<div className="web-chat-connections__prerequisite"><p>{t("webChat.profileRequired")}</p>{companyId&&<a className="ds-button ds-button--secondary ds-button--md" href={`/companies/${companyId}/assistant`} onClick={(event)=>{if(onNavigate){event.preventDefault();onNavigate(`/companies/${companyId}/assistant`);}}}>{t("responsibility.prepare")}</a>}</div>}{!companyReady && <p className="supporting-copy">{t("webChat.notReady")}</p>}</Surface>}
    {loading && <p role="status">{t("webChat.loading")}</p>}
    {!loading && connections.length === 0 && <EmptyExperience title={t("webChat.emptyTitle")} description={t("webChat.emptyDescription")}/>}
    <div className="web-chat-connections__list">{connections.map((connection) => {
      const url = publicUrl(connection.publicId), profile = profiles.find((value) => value.id === connection.assistantProfileId);
        return <Surface className="web-chat-connection" key={connection.id}><div className="web-chat-connection__identity"><StatusBadge tone={connection.status === "active" ? "success" : "warning"}>{connection.status === "active" ? t("webChat.active") : t("webChat.inactive")}</StatusBadge><h3>{profile?.name ?? t("webChat.profileUnavailable")}</h3><a href={url} target="_blank" rel="noreferrer">{url}</a><small>{t("webChat.updated")} {formatDate(connection.updatedAt)}</small></div><div className="action-row web-chat-connection__actions"><Button variant="secondary" onClick={() => void copy(url)}>{t("webChat.copy")}</Button><Button variant="secondary" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>{t("webChat.open")}</Button>{manageable && <Button variant="secondary" disabled={submitting} onClick={() => void setStatus(connection, connection.status === "active" ? "inactive" : "active")}>{connection.status === "active" ? t("webChat.deactivate") : t("webChat.activate")}</Button>}</div></Surface>;
    })}</div>
  </Surface>;
}
