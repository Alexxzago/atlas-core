import { useEffect, useRef, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import type { AssistantProfile, CompanyStatus, Permission, WebChatConnection, WebChatConnectionStatus } from "../types/api";

interface Props {
  readonly csrf: string;
  readonly workspaceId: string | null;
  readonly companyId: number | null;
  readonly companyStatus: CompanyStatus | null;
  readonly profiles: readonly AssistantProfile[];
  readonly capabilities: readonly Permission[];
}

function publicUrl(publicId: string): string {
  return new URL(`/chat/${publicId}`, window.location.origin).href;
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Web Chat Connections are temporarily unavailable.";
}

export function WebChatConnectionsPanel({ csrf, workspaceId, companyId, companyStatus, profiles, capabilities }: Props): React.JSX.Element | null {
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
      .catch((cause: unknown) => { if (current) setError(errorMessage(cause)); })
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
      setConnections(refreshed); setSelectedProfileId(""); setNotice("Web Chat Connection created.");
    } catch (cause: unknown) { setError(errorMessage(cause)); }
    finally { createInFlight.current = false; setSubmitting(false); }
  };

  const setStatus = async (connection: WebChatConnection, status: WebChatConnectionStatus): Promise<void> => {
    if (!workspaceId || !companyId || submitting) return;
    setSubmitting(true); setError(null); setNotice(null);
    try {
      const updated = await atlasApi.updateWebChatConnectionStatus(csrf, workspaceId, companyId, connection.id, status);
      setConnections((current) => current.map((value) => value.id === updated.id ? updated : value));
    } catch (cause: unknown) { setError(errorMessage(cause)); }
    finally { setSubmitting(false); }
  };

  const copy = async (url: string): Promise<void> => {
    try { await navigator.clipboard.writeText(url); setNotice("Public chat URL copied."); }
    catch { setError("Unable to copy the public chat URL."); }
  };

  if (!workspaceId || !companyId) return <section className="authenticated-section"><h2>Web Chat Connections</h2><p className="state-copy">Select a company to manage its public chat.</p></section>;
  if (!readable) return null;

  return <section className="authenticated-section" aria-busy={loading || submitting}>
    <div className="section-heading"><div><h2>Web Chat Connections</h2><p>Create a public chat URL for a ready Assistant Profile.</p></div></div>
    {error && <div className="inline-message inline-message--error" role="alert">{error}</div>}
    {notice && <div className="inline-message inline-message--success" role="status">{notice}</div>}
    {manageable && <div className="edit-form"><label className="form-field"><span>Ready Assistant Profile</span><select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)} disabled={submitting}><option value="">Select a profile</option>{readyProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><div className="action-row"><button className="button button--primary" type="button" onClick={() => void create()} disabled={!companyReady || !selectedProfileId || submitting || readyProfiles.length === 0}>{submitting ? "Saving..." : "Crear conexión"}</button></div>{!companyReady && <p className="supporting-copy">La empresa todavía no está lista. Incorporá y publicá conocimiento antes de crear una conexión de chat.</p>}{readyProfiles.length === 0 && <p className="supporting-copy">A ready Assistant Profile is required.</p>}</div>}
    {loading && <p role="status">Loading Web Chat Connections...</p>}
    {!loading && connections.length === 0 && <div className="state-block"><strong>No Web Chat Connections yet</strong><p>Create one to share a public chat URL.</p></div>}
    <div className="assistant-profile-layout">{connections.map((connection) => {
      const url = publicUrl(connection.publicId), profile = profiles.find((value) => value.id === connection.assistantProfileId);
      return <article className="assistant-profile-detail" key={connection.id}><div className="workspace-title-row"><div><h3>Public Web Chat</h3><p>{connection.status === "active" ? "Active" : "Inactive"}</p></div></div><dl className="assistant-profile-summary"><div><dt>Public ID</dt><dd>{connection.publicId}</dd></div><div><dt>Assistant Profile</dt><dd>{profile?.name ?? "Unavailable profile"}</dd></div><div><dt>Updated</dt><dd>{new Date(connection.updatedAt).toLocaleString()}</dd></div><div><dt>Public URL</dt><dd>{url}</dd></div></dl><div className="action-row"><button className="button button--secondary" type="button" onClick={() => void copy(url)}>Copy URL</button><button className="button button--secondary" type="button" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>Open Chat</button>{manageable && <button className="button button--secondary" type="button" disabled={submitting} onClick={() => void setStatus(connection, connection.status === "active" ? "inactive" : "active")}>{connection.status === "active" ? "Deactivate" : "Activate"}</button>}</div></article>;
    })}</div>
  </section>;
}
