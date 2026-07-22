import { useState } from "react";
import { useI18n } from "../i18n/I18nContext";
import { markReadyDisabled, missingReadyFields, visibleTransitions, type FormMode, type ReadyAdvisoryField } from "../state/authenticatedPortalState";
import type { AssistantProfile, AssistantProfileStatus, CreateAssistantProfileInput, Permission, UpdateAssistantProfileInput } from "../types/api";
import { AssistantProfileForm } from "./AssistantProfileForm";
import { AssistantStatusBadge } from "./AssistantStatusBadge";
import { AssistantPreviewPanel } from "./AssistantPreviewPanel";
import { previewAllowed } from "../state/assistantPreviewState";
import { OperationalAssistantExecutionPanel } from "./OperationalAssistantExecutionPanel";

interface Props {
  csrf: string;
  workspaceId: string | null;
  workspaceRole: string | null;
  capabilities: Permission[];
  companyId: number | null;
  companyName: string | null;
  companySelected: boolean;
  profiles: AssistantProfile[];
  selectedProfile: AssistantProfile | null;
  transientArchivedProfile: AssistantProfile | null;
  loading: boolean;
  error: boolean;
  formMode: FormMode;
  submitting: boolean;
  transitionTarget: AssistantProfileStatus | null;
  onSelectProfile: (profileId: string) => void;
  onOpenCreate: () => void;
  onOpenEdit: () => void;
  onCloseForm: () => void;
  onSubmitForm: (input: CreateAssistantProfileInput | UpdateAssistantProfileInput) => void;
  onTransition: (profile: AssistantProfile, target: AssistantProfileStatus) => void;
  onRetry: () => void;
}

const fieldKeys: Record<ReadyAdvisoryField, Parameters<ReturnType<typeof useI18n>["t"]>[0]> = {
  name: "profiles.field.name", businessRole: "profiles.field.businessRole", objective: "profiles.field.objective",
  tone: "profiles.field.tone", assistantLanguage: "profiles.field.language",
  welcomeMessage: "profiles.field.welcomeMessage", fallbackMessage: "profiles.field.fallbackMessage",
};

export function AssistantProfilesPanel(props: Props): React.JSX.Element {
  const { t, formatDate } = useI18n(); const [confirmArchive, setConfirmArchive] = useState<AssistantProfile | null>(null);
  const selected = props.selectedProfile;
  const missing = selected ? missingReadyFields(selected) : [];
  const transition = (profile: AssistantProfile, target: AssistantProfileStatus): void => {
    if (target === "archived") { setConfirmArchive(profile); return; }
    props.onTransition(profile, target);
  };
  const transitionLabel = (target: AssistantProfileStatus): string => {
    if (target === "ready") return t("profiles.action.ready");
    if (target === "disabled") return t("profiles.action.disable");
    if (target === "archived") return t("profiles.action.archive");
    return selected?.status === "archived" ? t("profiles.action.restore") : t("profiles.action.draft");
  };

  if (!props.companySelected) return <section className="authenticated-section assistant-profiles"><h2>{t("profiles.title")}</h2><p className="state-copy">{t("profiles.companyRequired")}</p></section>;

  return <section className="authenticated-section assistant-profiles" aria-busy={props.loading}>
    <div className="section-heading"><div><h2>{t("profiles.title")}</h2><p>{t("profiles.description")}</p></div><button className="button button--primary" type="button" onClick={props.onOpenCreate}>+ {t("profiles.create")}</button></div>
    {props.loading && <p role="status">{t("profiles.loading")}</p>}
    {props.error && <div className="inline-message inline-message--error" role="alert"><p>{t("profiles.loadError")}</p><button className="button button--secondary" type="button" onClick={props.onRetry}>{t("common.retry")}</button></div>}
    {props.formMode === "create" && <AssistantProfileForm mode="create" submitting={props.submitting} onSubmit={props.onSubmitForm} onCancel={props.onCloseForm} />}
    {props.transientArchivedProfile && <div className="archived-recovery" role="status"><div><strong>{t("profiles.archivedTitle")}</strong><p>{t("profiles.archivedDescription", { profileName: props.transientArchivedProfile.name })}</p></div><button className="button button--secondary" disabled={props.transitionTarget !== null} onClick={() => props.onTransition(props.transientArchivedProfile!, "draft")}>{t("profiles.action.restore")}</button></div>}
    {!props.loading && !props.error && props.profiles.length === 0 && props.formMode !== "create" && !props.transientArchivedProfile && <div className="state-block"><strong>{t("profiles.emptyTitle")}</strong><p>{t("profiles.emptyDescription")}</p></div>}
    <div className="assistant-profile-layout">
      {props.profiles.length > 0 && <div className="assistant-profile-list" aria-label={t("profiles.listLabel")}>{props.profiles.map((profile) => <button type="button" key={profile.id} className={`assistant-profile-item${selected?.id === profile.id ? " is-selected" : ""}`} aria-current={selected?.id === profile.id ? "true" : undefined} onClick={() => props.onSelectProfile(profile.id)}><span><strong>{profile.name}</strong><small>{t(`profiles.tone.${profile.tone}`)} · {profile.assistantLanguage.toUpperCase()}</small></span><AssistantStatusBadge status={profile.status}/></button>)}</div>}
      {selected && <div className="assistant-profile-detail">
        <div className="workspace-title-row"><div><h3>{selected.name}</h3><p>{t("profiles.updatedAt", { date: formatDate(selected.updatedAt) })}</p></div><AssistantStatusBadge status={selected.status}/></div>
        {props.formMode === "edit" ? <AssistantProfileForm mode="edit" profile={selected} submitting={props.submitting} onSubmit={props.onSubmitForm} onCancel={props.onCloseForm}/> : <>
          <dl className="assistant-profile-summary"><div><dt>{t("profiles.field.businessRole")}</dt><dd>{selected.businessRole ?? t("profiles.notConfigured")}</dd></div><div><dt>{t("profiles.field.objective")}</dt><dd>{selected.objective ?? t("profiles.notConfigured")}</dd></div><div><dt>{t("profiles.field.audience")}</dt><dd>{selected.audience ?? t("profiles.notConfigured")}</dd></div><div><dt>{t("profiles.field.language")}</dt><dd>{selected.assistantLanguage.toUpperCase()}</dd></div><div><dt>{t("profiles.field.tone")}</dt><dd>{t(`profiles.tone.${selected.tone}`)}</dd></div><div><dt>{t("profiles.field.welcomeMessage")}</dt><dd>{selected.welcomeMessage ?? t("profiles.notConfigured")}</dd></div><div><dt>{t("profiles.field.fallbackMessage")}</dt><dd>{selected.fallbackMessage}</dd></div></dl>
          {missing.length > 0 && <div className="inline-message inline-message--warning" role="status"><strong>{t("profiles.readyWarning")}</strong><ul>{missing.map((field) => <li key={field}>{t(fieldKeys[field])}</li>)}</ul></div>}
          <div className="action-row"><button className="button button--secondary" type="button" disabled={selected.status === "archived" || props.submitting} onClick={props.onOpenEdit}>{t("common.edit")}</button>{visibleTransitions(selected.status).map((target) => <button key={target} className={`button ${target === "archived" ? "button--danger-quiet" : target === "ready" && missing.length === 0 ? "button--primary" : "button--secondary"}`} type="button" disabled={target === "ready" ? markReadyDisabled(selected, props.transitionTarget !== null) : props.transitionTarget !== null} onClick={() => transition(selected, target)}>{props.transitionTarget === target ? t("profiles.transitioning") : transitionLabel(target)}</button>)}</div>
           {props.workspaceId && props.companyId && props.companyName && <AssistantPreviewPanel csrf={props.csrf} workspaceId={props.workspaceId} companyId={props.companyId} companyName={props.companyName} profile={selected} allowed={previewAllowed(props.workspaceRole)}/>}
           {props.workspaceId && props.companyId && props.companyName && <OperationalAssistantExecutionPanel csrf={props.csrf} workspaceId={props.workspaceId} companyId={props.companyId} companyName={props.companyName} profile={selected} capabilities={props.capabilities}/>}
        </>}
      </div>}
    </div>
    {confirmArchive && <div className="confirm-panel" role="group" aria-labelledby="archive-profile-title"><h3 id="archive-profile-title">{t("profiles.archiveConfirmTitle")}</h3><p>{t("profiles.archiveConfirm", { profileName: confirmArchive.name })}</p><div className="action-row"><button className="button button--danger" disabled={props.transitionTarget !== null} onClick={() => { props.onTransition(confirmArchive, "archived"); setConfirmArchive(null); }}>{t("common.confirm")}</button><button className="button button--secondary" disabled={props.transitionTarget !== null} onClick={() => setConfirmArchive(null)}>{t("common.cancel")}</button></div></div>}
  </section>;
}
