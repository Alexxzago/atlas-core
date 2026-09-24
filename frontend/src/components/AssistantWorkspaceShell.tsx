import type { ReactNode } from "react";
import { useI18n } from "../i18n/I18nContext";
import type { AssistantProfile } from "../types/api";
import { ContextBackLink } from "./ContextBackLink";
import { AssistantStatusBadge } from "./AssistantStatusBadge";

interface Props {
  profile: AssistantProfile;
  companyId: number | null;
  isDefault: boolean;
  navigation: ReactNode;
  onBack: () => void;
}

export function AssistantWorkspaceShell({ profile, companyId, isDefault, navigation, onBack }: Props): React.JSX.Element {
  const { t, formatDate } = useI18n();
  return <><ContextBackLink href={`/companies/${companyId}`} label={t("profiles.back")} onNavigate={(event) => { event.preventDefault(); onBack(); }}/><section className="assistant-profile-detail" aria-label="Assistant context"><div className="assistant-profile-identity workspace-title-row"><div><h1>{profile.name}</h1><p>{t("profiles.updatedAt", { date: formatDate(profile.updatedAt) })}</p>{isDefault && <span className="assistant-profile-default-badge" role="status">{t("profiles.defaultBadge")}</span>}</div><AssistantStatusBadge status={profile.status}/></div>{navigation}</section></>;
}
