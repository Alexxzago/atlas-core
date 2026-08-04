import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n/I18nContext";
import type { Company, CompanyInput, WorkspaceSummary } from "../types/api";
import type { PortalRoute } from "../routing/routes";
import { ThemeSelector } from "./ThemeSelector";
import { AuthenticatedCompanySelector } from "./AuthenticatedCompanySelector";

type Navigate = (path: string) => void;
interface AppShellProps {
  readonly route: PortalRoute;
  readonly workspace: WorkspaceSummary | null;
  readonly workspaces: readonly WorkspaceSummary[];
  readonly companies: readonly Company[];
  readonly selectedCompany: Company | null;
  readonly companiesLoading: boolean;
  readonly companyError: boolean;
  readonly companyCreating: boolean;
  readonly companyTransitioning: boolean;
  readonly email: string;
  readonly onNavigate: Navigate;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  readonly onSelectCompany: (companyId: number) => void;
  readonly onCreateCompany: (input: CompanyInput) => Promise<boolean>;
  readonly onRetryCompanies: () => void;
  readonly onPassword: () => void;
  readonly onLogout: () => void;
  readonly children: ReactNode;
}

type Responsibility = { readonly key: "today" | "prepare" | "teach" | "places" | "conversations"; readonly path: string };
function responsibilities(companyId: number): readonly Responsibility[] { return [
  { key: "today", path: `/companies/${companyId}` }, { key: "prepare", path: `/companies/${companyId}/assistant` }, { key: "teach", path: `/companies/${companyId}/knowledge` }, { key: "places", path: `/companies/${companyId}/channels` }, { key: "conversations", path: "/conversations" },
]; }
function active(key: Responsibility["key"], route: PortalRoute): boolean {
  if (key === "today") return route.name === "dashboard" || route.name === "company-overview";
  if (key === "prepare") return route.name === "company-assistant";
  if (key === "teach") return route.name === "company-knowledge";
  if (key === "places") return route.name === "company-channels" || route.name === "company-whatsapp" || route.name === "company-web-chat";
  return route.name === "conversations";
}

export function SkipLink(): React.JSX.Element { const { t } = useI18n(); return <a className="skip-link" href="#main-content">{t("shell.skipToContent")}</a>; }
export function PageHeader({ title, description, trail }: { readonly title: string; readonly description?: string; readonly trail?: string }): React.JSX.Element { return <header className="work-anchor work-anchor--route">{trail && <p className="work-anchor__context">{trail}</p>}<h1 tabIndex={-1}>{title}</h1>{description && <p className="work-anchor__lead">{description}</p>}</header>; }

export function AppShell(props: AppShellProps): React.JSX.Element {
  const { t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false), [chooserOpen, setChooserOpen] = useState(props.route.name === "companies"), [accountOpen, setAccountOpen] = useState(false);
  const mobileTrigger = useRef<HTMLButtonElement>(null), drawer = useRef<HTMLElement>(null), companyTrigger = useRef<HTMLButtonElement>(null), accountMenu = useRef<HTMLDivElement>(null), accountTrigger = useRef<HTMLButtonElement | null>(null);
  const closeMobile = useCallback(() => { setMobileOpen(false); window.setTimeout(() => mobileTrigger.current?.focus(), 0); }, []);
  const closeChooser = useCallback(() => { setChooserOpen(false); window.setTimeout(() => companyTrigger.current?.focus(), 0); }, []);
  const navigate = useCallback((path: string) => { props.onNavigate(path); setMobileOpen(false); setAccountOpen(false); }, [props.onNavigate]);

  useEffect(() => { setMobileOpen(false); setAccountOpen(false); if (props.route.name === "companies") setChooserOpen(true); document.getElementById("main-content")?.focus(); }, [props.route]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); closeMobile(); return; }
      if (event.key !== "Tab") return;
      const items = drawer.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'); if (!items?.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keydown); drawer.current?.querySelector<HTMLElement>("button")?.focus();
    return () => { window.removeEventListener("keydown", keydown); document.body.style.overflow = previous; };
  }, [closeMobile, mobileOpen]);
  useEffect(() => {
    if (!accountOpen) return;
    const dismiss = (event: MouseEvent): void => {
      if (accountMenu.current?.contains(event.target as Node) || accountTrigger.current?.contains(event.target as Node)) return;
      setAccountOpen(false); accountTrigger.current?.focus();
    };
    const keydown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault(); setAccountOpen(false); accountTrigger.current?.focus();
    };
    document.addEventListener("mousedown", dismiss); window.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("mousedown", dismiss); window.removeEventListener("keydown", keydown); };
  }, [accountOpen]);

  const companyId = props.selectedCompany?.id;
  const navigation = companyId ? <nav className="responsibility-navigation" aria-label={t("shell.primaryNavigation")}>{responsibilities(companyId).map((item) => <a href={item.path} key={item.key} aria-current={active(item.key, props.route) ? "page" : undefined} onClick={(event) => { event.preventDefault(); navigate(item.path); }}><span aria-hidden="true" className="responsibility-navigation__signal"/><span>{t(`responsibility.${item.key}`)}</span></a>)}</nav> : null;
  const companyContext = <button ref={companyTrigger} className="company-context-button" type="button" aria-haspopup="dialog" aria-expanded={chooserOpen} onClick={() => setChooserOpen(true)} disabled={!props.workspace || props.companiesLoading}><span>{t("shell.companyContext")}</span><strong>{props.companyTransitioning ? t("shell.changingCompany") : props.selectedCompany?.name ?? t("shell.chooseCompany")}</strong></button>;

  return <div className={`app-shell${props.selectedCompany ? " has-company" : " no-company"}`}><SkipLink />
    <aside className="app-sidebar" aria-label={t("shell.applicationNavigation")}><div className="app-sidebar__brand"><span aria-hidden="true"/><strong>ATLAS</strong></div>{companyContext}{props.workspace && <p className="workspace-context">{props.workspace.name}</p>}{navigation}<button className="workspace-menu-trigger" type="button" aria-expanded={accountOpen} onClick={(event) => { accountTrigger.current = event.currentTarget; setAccountOpen((value) => !value); }}>{t("shell.workspaceMenu")}</button></aside>
    <header className="mobile-context-bar"><button ref={mobileTrigger} className="mobile-navigation-trigger" type="button" aria-expanded={mobileOpen} aria-controls="mobile-navigation" onClick={() => setMobileOpen(true)}>{t("shell.openNavigation")}</button>{companyContext}<button className="mobile-account-trigger" type="button" aria-label={t("shell.workspaceMenu")} onClick={(event) => { accountTrigger.current = event.currentTarget; setAccountOpen((value) => !value); }}>•••</button></header>
    {accountOpen && <AccountMenu ref={accountMenu} {...props} navigate={navigate}/>}
    {mobileOpen && <><div className="mobile-navigation-backdrop" onMouseDown={closeMobile} aria-hidden="true"/><aside ref={drawer} id="mobile-navigation" className="mobile-navigation" aria-label={t("shell.mobileNavigation")}><div className="mobile-navigation__header"><strong>ATLAS</strong><button type="button" className="button button--quiet" onClick={closeMobile}>{t("shell.closeNavigation")}</button></div>{props.selectedCompany && <p className="mobile-navigation__company">{props.selectedCompany.name}</p>}{navigation}</aside></>}
    <main id="main-content" className="app-main" tabIndex={-1}>{props.children}</main>
    <AuthenticatedCompanySelector open={chooserOpen} companies={props.companies} selectedCompanyId={props.selectedCompany?.id ?? null} workspaceSelected={props.workspace !== null} loading={props.companiesLoading} error={props.companyError} creating={props.companyCreating} onCreate={props.onCreateCompany} onCompanySelected={(id) => { closeChooser(); props.onSelectCompany(id); }} onRetry={props.onRetryCompanies} onClose={closeChooser}/>
  </div>;
}

function AccountMenu({ ref, ...props }: AppShellProps & { readonly navigate: Navigate; readonly ref: React.Ref<HTMLDivElement> }): React.JSX.Element {
  const { t } = useI18n();
  return <div ref={ref} className="workspace-menu" role="group" aria-label={t("shell.workspaceMenu")}>
    <section><p>{t("shell.menu.workspace")}</p><strong>{props.workspace?.name ?? t("shell.noWorkspace")}</strong>{props.workspaces.length > 1 && <label><span>{t("shell.workspaceContext")}</span><select value={props.workspace?.id ?? ""} onChange={(event) => { if (event.target.value) props.onSelectWorkspace(event.target.value); }}>{props.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>}<button type="button" onClick={() => props.navigate("/settings")}>{t("shell.workspaceSettings")}</button></section>
    <section><p>{t("shell.menu.appearance")}</p><ThemeSelector/></section>
    <section><p>{t("shell.menu.account")}</p><small>{props.email}</small><button type="button" onClick={props.onPassword}>{t("portal.password")}</button><button type="button" onClick={props.onLogout}>{t("shell.signOut")}</button></section>
  </div>;
}
