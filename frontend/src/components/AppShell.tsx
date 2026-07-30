import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n/I18nContext";
import type { Company, WorkspaceSummary } from "../types/api";
import type { PortalRoute } from "../routing/routes";

type Navigate = (path: string) => void;

interface AppShellProps {
  readonly route: PortalRoute;
  readonly workspace: WorkspaceSummary | null;
  readonly workspaces: readonly WorkspaceSummary[];
  readonly companies: readonly Company[];
  readonly selectedCompany: Company | null;
  readonly email: string;
  readonly onNavigate: Navigate;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  readonly onSelectCompany: (companyId: number) => void;
  readonly onPassword: () => void;
  readonly onLogout: () => void;
  readonly children: ReactNode;
}

type NavItem = { readonly key: "dashboard" | "companies" | "conversations" | "analytics" | "settings"; readonly path: string; };
const navItems: readonly NavItem[] = [
  { key: "dashboard", path: "/dashboard" }, { key: "companies", path: "/companies" },
  { key: "conversations", path: "/conversations" }, { key: "analytics", path: "/analytics" }, { key: "settings", path: "/settings" },
];

function isActive(item: NavItem, route: PortalRoute): boolean {
  return item.key === "companies" ? route.name.startsWith("company") || route.name === "companies" : route.name === item.key;
}

export function SkipLink(): React.JSX.Element {
  const { t } = useI18n();
  return <a className="skip-link" href="#main-content">{t("shell.skipToContent")}</a>;
}

export function WorkspaceSwitcher({ workspaces, workspace, onSelect, disabled }: { readonly workspaces: readonly WorkspaceSummary[]; readonly workspace: WorkspaceSummary | null; readonly onSelect: (id: string) => void; readonly disabled?: boolean }): React.JSX.Element {
  const { t } = useI18n();
  return <label className="shell-context"><span className="ds-visually-hidden">{t("shell.workspaceContext")}</span><select className="shell-context-button" value={workspace?.id ?? ""} disabled={disabled || workspaces.length === 0} onChange={(event) => { if (event.target.value) onSelect(event.target.value); }}><option value="">{t("shell.noWorkspace")}</option>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
}

export function CompanySwitcher({ companies, company, onSelect, disabled }: { readonly companies: readonly Company[]; readonly company: Company | null; readonly onSelect: (id: number) => void; readonly disabled?: boolean }): React.JSX.Element {
  const { t } = useI18n();
  return <label className="shell-context"><span className="ds-visually-hidden">{t("shell.companyContext")}</span><select className="shell-context-button" value={company?.id ?? ""} disabled={disabled || companies.length === 0} onChange={(event) => { const id = Number(event.target.value); if (Number.isSafeInteger(id) && id > 0) onSelect(id); }}><option value="">{t("shell.noCompany")}</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
}

export function CompanySubnav({ route, companyId, onNavigate }: { readonly route: PortalRoute; readonly companyId: number; readonly onNavigate: Navigate }): React.JSX.Element {
  const { t } = useI18n();
  const items = [
    ["company-overview", `/companies/${companyId}`, "companyNav.overview"], ["company-assistant", `/companies/${companyId}/assistant`, "companyNav.assistant"],
    ["company-knowledge", `/companies/${companyId}/knowledge`, "companyNav.knowledge"], ["company-channels", `/companies/${companyId}/channels`, "companyNav.channels"],
    ["company-whatsapp", `/companies/${companyId}/channels/whatsapp`, "companyNav.whatsapp"],
  ] as const;
  return <nav className="company-subnav" aria-label={t("shell.companyNavigation")}>{items.map(([name, path, key]) => <button className={route.name === name ? "is-active" : ""} type="button" key={name} aria-current={route.name === name ? "page" : undefined} onClick={() => onNavigate(path)}>{t(key)}</button>)}</nav>;
}

export function PageHeader({ title, description, trail }: { readonly title: string; readonly description?: string; readonly trail?: string }): React.JSX.Element {
  return <header className="page-header">{trail && <p className="page-header__trail">{trail}</p>}<h1 tabIndex={-1}>{title}</h1>{description && <p>{description}</p>}</header>;
}

export function AppShell(props: AppShellProps): React.JSX.Element {
  const { t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);

  const closeMobile = useCallback((): void => {
    setMobileOpen(false);
    window.setTimeout(() => trigger.current?.focus(), 0);
  }, []);
  const navigate = useCallback((path: string): void => {
    props.onNavigate(path);
    setMobileOpen(false);
  }, [props.onNavigate]);

  useEffect(() => {
    setMobileOpen(false);
    document.getElementById("main-content")?.focus();
  }, [props.route]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); closeMobile(); return; }
      if (event.key !== "Tab") return;
      const focusable = drawer.current?.querySelectorAll<HTMLElement>("button:not(:disabled)");
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    drawer.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeMobile, mobileOpen]);

  const navigation = <nav className="app-sidebar__navigation" aria-label={t("shell.primaryNavigation")}>
    {navItems.map((item) => <button type="button" key={item.key} className={isActive(item, props.route) ? "is-active" : ""} aria-current={isActive(item, props.route) ? "page" : undefined} onClick={() => navigate(item.path)}>{t(`nav.${item.key}`)}</button>)}
  </nav>;

  return <div className="app-shell"><SkipLink /><aside className="app-sidebar" aria-label={t("shell.applicationNavigation")}><div className="app-sidebar__brand">ATLAS</div>{navigation}</aside>
    <header className="app-topbar"><button ref={trigger} className="mobile-navigation-trigger" type="button" aria-expanded={mobileOpen} aria-controls="mobile-navigation" onClick={() => setMobileOpen(true)}>{t("shell.openNavigation")}</button><div className="app-topbar__context"><WorkspaceSwitcher workspaces={props.workspaces} workspace={props.workspace} onSelect={props.onSelectWorkspace} /><CompanySwitcher companies={props.companies} company={props.selectedCompany} onSelect={props.onSelectCompany} /></div><div className="app-topbar__account"><span>{props.email}</span><button className="button button--quiet" type="button" onClick={props.onPassword}>{t("portal.password")}</button><button className="button button--secondary" type="button" onClick={props.onLogout}>{t("portal.logout")}</button></div></header>
    {mobileOpen && <><div className="mobile-navigation-backdrop" onMouseDown={closeMobile} aria-hidden="true" /><aside ref={drawer} id="mobile-navigation" className="mobile-navigation is-open" aria-label={t("shell.mobileNavigation")}><div className="mobile-navigation__header"><strong>ATLAS</strong><button type="button" className="button button--quiet" onClick={closeMobile}>{t("shell.closeNavigation")}</button></div>{navigation}</aside></>}
    <main id="main-content" className="app-main" tabIndex={-1}>{props.children}</main>
  </div>;
}
