import { useEffect, useRef, useState } from "react";
import { atlasApi } from "../api/atlasApi";
import { useI18n } from "../i18n/I18nContext";
import { shouldApplyWorkspaceRefresh } from "../state/authenticatedPortalState";
import type { WorkspaceSummary } from "../types/api";

interface Member { id: string; userId: string; role: string; status: string }
interface Invitation { id: string; recipient: string; role: string; status: string; expiresAt: string }

interface Props {
  csrf: string;
  workspaces: WorkspaceSummary[];
  selectedWorkspace: WorkspaceSummary | null;
  pendingWorkspaceId: string | null;
  loading: boolean;
  error: boolean;
  onSelectWorkspace: (workspaceId: string) => void;
  onWorkspacesChanged: () => void;
  onActiveWorkspaceLeft: () => void;
}

export function WorkspaceMembershipPortal(props: Props): React.JSX.Element {
  const { locale, t } = useI18n();
  const es = locale === "es";
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [error, setError] = useState("");
  const selected = props.selectedWorkspace;
  const mounted = useRef(true);
  const activeWorkspaceId = useRef<string | null>(selected?.id ?? null);
  activeWorkspaceId.current = selected?.id ?? null;
  const activeRefreshId = useRef(0);
  const refreshAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; refreshAbort.current?.abort(); activeRefreshId.current += 1; };
  }, []);

  useEffect(() => {
    activeWorkspaceId.current = selected?.id ?? null;
    refreshAbort.current?.abort(); activeRefreshId.current += 1;
    if (!selected) { setMembers([]); setInvitations([]); return; }
    void refresh(selected.id);
  }, [selected?.id]);

  const refresh = async (workspaceId: string): Promise<void> => {
    if (activeWorkspaceId.current !== workspaceId || !mounted.current) return;
    refreshAbort.current?.abort(); const controller = new AbortController(); refreshAbort.current = controller;
    const requestId = ++activeRefreshId.current;
    try {
      const [nextMembers, nextInvitations] = await Promise.all([
        atlasApi.listMemberships(workspaceId, controller.signal), atlasApi.listInvitations(workspaceId, controller.signal),
      ]);
      if (!shouldApplyWorkspaceRefresh(activeWorkspaceId.current, workspaceId, activeRefreshId.current, requestId, mounted.current)) return;
      setMembers(nextMembers); setInvitations(nextInvitations);
    } catch (caught: unknown) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (!shouldApplyWorkspaceRefresh(activeWorkspaceId.current, workspaceId, activeRefreshId.current, requestId, mounted.current)) return;
      setMembers([]); setInvitations([]);
    }
  };

  const create = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault(); setError("");
    const form = event.currentTarget;
    try {
      const name = String(new FormData(form).get("name") ?? "");
      await atlasApi.createWorkspace(props.csrf, name); props.onWorkspacesChanged(); form.reset();
    } catch { setError(t("portal.workspaceCreateError")); }
  };

  const invite = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault(); if (!selected) return;
    const data = new FormData(event.currentTarget);
    await atlasApi.inviteMember(props.csrf, selected.id, String(data.get("email") ?? ""), String(data.get("role") ?? "viewer"));
    await refresh(selected.id);
  };

  return <section className="workspace-admin authenticated-section">
    <h2>{es ? "Espacios de trabajo" : "Workspaces"}</h2>
    {(props.error || error) && <p className="inline-message inline-message--error" role="alert">{error || (es ? "No pudimos cargar los espacios." : "Unable to load Workspaces.")}</p>}
    <form className="workspace-create-row" onSubmit={(event) => void create(event)}>
      <label className="form-field"><span>{es ? "Nombre" : "Name"}</span><input name="name" required /></label>
      <button className="button button--secondary">{es ? "Crear espacio" : "Create Workspace"}</button>
    </form>
    <label className="form-field">
      <span>{t("portal.workspaceSelect")}</span>
      <select disabled={props.loading || props.pendingWorkspaceId !== null} value={selected?.id ?? ""}
        onChange={(event) => { if (event.target.value) props.onSelectWorkspace(event.target.value); }}>
        <option value="">{props.loading ? t("portal.workspacesLoading") : t("portal.workspaceNone")}</option>
        {props.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select>
    </label>
    {props.pendingWorkspaceId && <p role="status">{t("portal.workspaceValidating")}</p>}
    {selected && <div className="workspace-administration">
      <h3>{selected.name}</h3><p>{es ? "Rol actual" : "Current role"}: {selected.role}</p>
      <button className="button button--danger-quiet" onClick={() => void atlasApi.leaveWorkspace(props.csrf, selected.id).then(() => { props.onActiveWorkspaceLeft(); props.onWorkspacesChanged(); })}>{es ? "Salir del espacio" : "Leave Workspace"}</button>
      <h3>{es ? "Miembros" : "Members"}</h3>
      <ul>{members.map((member) => <li key={member.id}>{member.userId} — {member.role} — {member.status} <select aria-label={es ? "Cambiar rol" : "Change role"} value={member.role} onChange={(event) => void atlasApi.changeMembershipRole(props.csrf, selected.id, member.id, event.target.value).then(() => refresh(selected.id))}><option value="owner">Owner</option><option value="administrator">Administrator</option><option value="operator">Operator</option><option value="viewer">Viewer</option></select>{member.status === "active" ? <button onClick={() => void atlasApi.changeMembershipStatus(props.csrf, selected.id, member.id, "suspend").then(() => refresh(selected.id))}>{es ? "Suspender" : "Suspend"}</button> : member.status === "suspended" ? <button onClick={() => void atlasApi.changeMembershipStatus(props.csrf, selected.id, member.id, "reactivate").then(() => refresh(selected.id))}>{es ? "Reactivar" : "Reactivate"}</button> : null}<button onClick={() => void atlasApi.changeMembershipStatus(props.csrf, selected.id, member.id, "remove").then(() => refresh(selected.id))}>{es ? "Eliminar" : "Remove"}</button><button onClick={() => void atlasApi.transferOwnership(props.csrf, selected.id, member.id, "administrator").then(() => refresh(selected.id))}>{es ? "Transferir propiedad" : "Transfer ownership"}</button></li>)}</ul>
      <h3>{es ? "Invitaciones" : "Invitations"}</h3>
      <form onSubmit={(event) => void invite(event)}><input name="email" type="email" required placeholder={es ? "correo@ejemplo.com" : "email@example.com"}/><select name="role"><option value="administrator">Administrator</option><option value="operator">Operator</option><option value="viewer">Viewer</option></select><button>{es ? "Invitar" : "Invite"}</button></form>
      <ul>{invitations.map((invitation) => <li key={invitation.id}>{invitation.recipient} — {invitation.role} — {invitation.status}{invitation.status === "pending" && <button onClick={() => void atlasApi.revokeInvitation(props.csrf, selected.id, invitation.id).then(() => refresh(selected.id))}>{es ? "Revocar" : "Revoke"}</button>}</li>)}</ul>
    </div>}
  </section>;
}
