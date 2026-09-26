import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n/I18nContext";
import type { Company, CompanyInput, WorkspaceSummary } from "../types/api";
import type { PortalRoute } from "../routing/routes";
import { ThemeSelector } from "./ThemeSelector";
import { AuthenticatedCompanySelector } from "./AuthenticatedCompanySelector";
import { createPortal } from "react-dom";
import { Button, PageHeader as DesignSystemPageHeader } from "../design-system/primitives";
import { AtlasGlyph } from "./AtlasGlyph";
import {
  IconHome,
  IconAssistant,
  IconKnowledge,
  IconChannels,
  IconConversations,
  IconSettings,
} from "./ShellIcons";
import { AtlasAtmosphere } from "./AtlasAtmosphere";

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
  readonly companyAutoSelecting?: boolean;
  readonly bootstrapping?: boolean;
  readonly email: string;
  readonly isPlatformAdmin?: boolean;
  readonly onNavigate: Navigate;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  readonly onSelectCompany: (companyId: number) => void;
  readonly onCreateCompany: (input: CompanyInput) => Promise<boolean>;
  readonly onRetryCompanies: () => void;
  readonly onPassword: () => void;
  readonly onLogout: () => Promise<void> | void;
  readonly logoutPending?: boolean | undefined;
  readonly logoutError?: string | undefined;
  readonly children: ReactNode;
}

type Responsibility = { readonly key: "today" | "prepare" | "teach" | "places" | "conversations"; readonly path: string };
function responsibilities(companyId: number | null): readonly Responsibility[] {
  const base = companyId ? `/companies/${companyId}` : "/dashboard";
  return [
    { key: "today", path: base },
    { key: "prepare", path: companyId ? `${base}/assistant` : "/dashboard" },
    { key: "teach", path: companyId ? `${base}/knowledge` : "/dashboard" },
    { key: "places", path: companyId ? `${base}/channels` : "/dashboard" },
    { key: "conversations", path: "/conversations" },
  ];
}

const itemIcons: Record<Responsibility["key"], (props: { size?: number; className?: string }) => React.JSX.Element> = {
  today: IconHome,
  prepare: IconAssistant,
  teach: IconKnowledge,
  places: IconChannels,
  conversations: IconConversations,
};

function active(key: Responsibility["key"], route: PortalRoute): boolean {
  if (key === "today") return route.name === "dashboard" || route.name === "company-overview";
  if (key === "prepare") return route.name === "company-assistant" || route.name === "company-assistant-section";
  if (key === "teach") return route.name === "company-knowledge";
  if (key === "places") return route.name === "company-channels" || route.name === "company-whatsapp" || route.name === "company-web-chat";
  return route.name === "conversations";
}

export function SkipLink(): React.JSX.Element {
  const { t } = useI18n();
  return <a className="skip-link" href="#main-content">{t("shell.skipToContent")}</a>;
}

export function PageHeader({ title, description, trail }: { readonly title: string; readonly description?: string; readonly trail?: string }): React.JSX.Element {
  return (
    <div className="ds-page-header-with-trail">
      {trail && <p className="ds-page-header__trail">{trail}</p>}
      <DesignSystemPageHeader title={title} {...(description === undefined ? {} : { description })} />
    </div>
  );
}

export function AppShell(props: AppShellProps): React.JSX.Element {
  const { t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(props.route.name === "companies" && !props.companyAutoSelecting && !props.bootstrapping);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountPosition, setAccountPosition] = useState<React.CSSProperties>({});
  const [flyoutExpanded, setFlyoutExpanded] = useState(false);

  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const companyTrigger = useRef<HTMLButtonElement>(null);
  const accountMenu = useRef<HTMLDivElement>(null);
  const accountTrigger = useRef<HTMLButtonElement | null>(null);
  const flyoutTimer = useRef<number | null>(null);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
    window.setTimeout(() => mobileTrigger.current?.focus(), 0);
  }, []);

  const closeChooser = useCallback(() => {
    setChooserOpen(false);
    window.setTimeout(() => companyTrigger.current?.focus(), 0);
  }, []);

  const dismissChooser = useCallback(() => {
    closeChooser();
    if (props.route.name === "companies") props.onNavigate("/dashboard");
  }, [closeChooser, props.onNavigate, props.route.name]);

  const navigate = useCallback((path: string) => {
    props.onNavigate(path);
    setMobileOpen(false);
    setAccountOpen(false);
    setFlyoutExpanded(false);
  }, [props.onNavigate]);

  const handleRailEnter = (): void => {
    if (flyoutTimer.current !== null) {
      window.clearTimeout(flyoutTimer.current);
      flyoutTimer.current = null;
    }
    setFlyoutExpanded(true);
  };

  const handleRailLeave = (): void => {
    if (flyoutTimer.current !== null) window.clearTimeout(flyoutTimer.current);
    flyoutTimer.current = window.setTimeout(() => {
      setFlyoutExpanded(false);
      flyoutTimer.current = null;
    }, 120);
  };

  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
    if (props.bootstrapping || props.companyAutoSelecting || props.route.name !== "companies") {
      setChooserOpen(false);
    } else {
      setChooserOpen(true);
    }
    document.getElementById("main-content")?.focus();
  }, [props.bootstrapping, props.companyAutoSelecting, props.route]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); closeMobile(); return; }
      if (event.key !== "Tab") return;
      const items = drawer.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]");
      if (!items?.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keydown);
    drawer.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      window.removeEventListener("keydown", keydown);
      document.body.style.overflow = previous;
    };
  }, [closeMobile, mobileOpen]);

  useEffect(() => {
    if (!accountOpen) return;
    const position = (): void => {
      const trigger = accountTrigger.current;
      if (!trigger) return;
      if (window.matchMedia?.("(max-width: 767px)").matches) { setAccountPosition({}); return; }
      const bounds = trigger.getBoundingClientRect(), width = 280, gutter = 16;
      const left = Math.max(gutter, Math.min(bounds.left, window.innerWidth - width - gutter));
      const bottomSpace = window.innerHeight - bounds.bottom;
      setAccountPosition(bottomSpace >= 360 ? { position: "fixed", left, top: bounds.bottom + 8, width } : { position: "fixed", left, bottom: window.innerHeight - bounds.top + 8, width });
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const dismiss = (event: MouseEvent): void => {
      if (accountMenu.current?.contains(event.target as Node) || accountTrigger.current?.contains(event.target as Node)) return;
      setAccountOpen(false);
      accountTrigger.current?.focus();
    };
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); setAccountOpen(false); accountTrigger.current?.focus(); return; }
      if (event.key !== "Tab" || !window.matchMedia?.("(max-width: 767px)").matches) return;
      const items = accountMenu.current?.querySelectorAll<HTMLElement>("button:not(:disabled),select:not(:disabled),a[href]");
      if (!items?.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [accountOpen]);

  useEffect(() => {
    if (accountOpen) accountMenu.current?.querySelector<HTMLElement>("button,select")?.focus();
  }, [accountOpen]);

  const companyId = props.selectedCompany?.id ?? null;
  const items = responsibilities(companyId);

  const companyName = props.selectedCompany?.name ?? t("shell.chooseCompany");
  const companyContext = (
    <button
      ref={companyTrigger}
      className={`company-context-button${props.companyTransitioning ? " is-transitioning" : ""}`}
      type="button"
      title={companyName}
      aria-label={`${t("shell.companyContext")}: ${companyName}`}
      aria-haspopup="dialog"
      aria-expanded={chooserOpen}
      onClick={() => setChooserOpen(true)}
      disabled={!props.workspace || props.companiesLoading}
    >
      <span>{t("shell.companyContext")}</span>
      <span className="company-context-button__value">
        <strong>{props.companyTransitioning ? t("shell.changingCompany") : companyName}</strong>
        {props.companyTransitioning ? (
          <span className="company-context-button__progress" role="status" aria-label={t("shell.changingCompany")} />
        ) : (
          <span className="company-context-button__chevron" aria-hidden="true">⌄</span>
        )}
      </span>
    </button>
  );

  const userInitials = (props.email || "A").slice(0, 2).toUpperCase();

  return (
    <div className={`app-shell authenticated-portal${props.selectedCompany ? " has-company" : " no-company"}`}>
      <AtlasAtmosphere />
      <SkipLink />

      {/* Rail de navegación colapsado de 68px */}
      <aside
        className="app-sidebar-rail"
        aria-label={t("shell.applicationNavigation")}
        onMouseEnter={handleRailEnter}
        onMouseLeave={handleRailLeave}
        onFocus={handleRailEnter}
        onBlur={handleRailLeave}
      >
        <div className="app-rail__brand">
          <AtlasGlyph size={28} />
        </div>

        <nav className="app-rail__nav" aria-label={t("shell.primaryNavigation")}>
          {items.map((item) => {
            const Icon = itemIcons[item.key];
            const isItemActive = active(item.key, props.route);
            return (
              <a
                href={item.path}
                key={item.key}
                className={`app-rail__item${isItemActive ? " is-active" : ""}`}
                aria-current={isItemActive ? "page" : undefined}
                title={t(`responsibility.${item.key}`)}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(item.path);
                }}
              >
                <Icon size={20} className="app-rail__icon" />
              </a>
            );
          })}
        </nav>

        <div className="app-rail__footer">
          <button
            type="button"
            className="app-rail__item app-rail__settings-trigger"
            aria-label={t("shell.workspaceSettings")}
            title={t("shell.workspaceSettings")}
            onClick={() => navigate("/settings")}
          >
            <IconSettings size={20} className="app-rail__icon" />
          </button>
        </div>

        {/* Panel expandido (Flyout Overlay flotante sin mover workspace) */}
        <div
          className={`app-sidebar-flyout${flyoutExpanded ? " is-expanded" : ""}`}
          aria-hidden={!flyoutExpanded}
        >
          <div className="app-flyout__header">
            <AtlasGlyph size={24} />
            <strong className="app-flyout__title">ATLAS</strong>
          </div>

          <div className="app-flyout__context">
            {companyContext}
            {props.workspace && <p className="workspace-context">{props.workspace.name}</p>}
          </div>

          <nav className="app-flyout__nav">
            {items.map((item) => {
              const Icon = itemIcons[item.key];
              const isItemActive = active(item.key, props.route);
              return (
                <a
                  href={item.path}
                  key={item.key}
                  className={`app-flyout__link${isItemActive ? " is-active" : ""}`}
                  aria-current={isItemActive ? "page" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(item.path);
                  }}
                >
                  <Icon size={18} className="app-flyout__icon" />
                  <span>{t(`responsibility.${item.key}`)}</span>
                </a>
              );
            })}
          </nav>

          <div className="app-flyout__footer">
            <Button
              className="workspace-menu-trigger"
              variant="quiet"
              aria-expanded={accountOpen}
              onClick={(event) => {
                accountTrigger.current = event.currentTarget;
                setAccountOpen((val) => !val);
              }}
            >
              {t("shell.workspaceMenu")}
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="mobile-context-bar">
        <Button
          ref={mobileTrigger}
          className="mobile-navigation-trigger"
          variant="secondary"
          aria-expanded={mobileOpen}
          aria-controls="mobile-navigation"
          onClick={() => setMobileOpen(true)}
        >
          {t("shell.openNavigation")}
        </Button>
        {companyContext}
        <Button
          className="mobile-account-trigger"
          variant="secondary"
          aria-label={t("shell.workspaceMenu")}
          onClick={(event) => {
            accountTrigger.current = event.currentTarget;
            setAccountOpen((val) => !val);
          }}
        >
          •••
        </Button>
      </header>

      {accountOpen &&
        createPortal(
          <>
            <div className="workspace-menu-backdrop" aria-hidden="true" />
            <AccountMenu ref={accountMenu} {...props} navigate={navigate} style={accountPosition} />
          </>,
          document.body
        )}

      {mobileOpen && (
        <>
          <div className="mobile-navigation-backdrop" onMouseDown={closeMobile} aria-hidden="true" />
          <aside ref={drawer} id="mobile-navigation" className="mobile-navigation" aria-label={t("shell.mobileNavigation")}>
            <div className="mobile-navigation__header">
              <div className="mobile-navigation__brand">
                <AtlasGlyph size={24} />
                <strong>ATLAS</strong>
              </div>
              <Button variant="quiet" onClick={closeMobile}>{t("shell.closeNavigation")}</Button>
            </div>
            {props.selectedCompany && <p className="mobile-navigation__company">{props.selectedCompany.name}</p>}
            <nav className="responsibility-navigation">
              {items.map((item) => (
                <a
                  href={item.path}
                  key={item.key}
                  aria-current={active(item.key, props.route) ? "page" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(item.path);
                  }}
                >
                  <span className="responsibility-navigation__label">{t(`responsibility.${item.key}`)}</span>
                </a>
              ))}
            </nav>
          </aside>
        </>
      )}

      {/* Main Workspace with Integrated Topbar */}
      <div className="app-workspace-container">
        <header className="app-topbar">
          <div className="app-topbar__context">
            {props.workspace && (
              <span className="app-topbar__workspace-name">{props.workspace.name}</span>
            )}
            {props.selectedCompany && (
              <>
                <span className="app-topbar__context-separator">/</span>
                <span className="app-topbar__company-name">{props.selectedCompany.name}</span>
              </>
            )}
          </div>

          <div className="app-topbar__user">
            <button
              type="button"
              className="app-topbar__user-btn"
              onClick={(event) => {
                accountTrigger.current = event.currentTarget;
                setAccountOpen((val) => !val);
              }}
              aria-expanded={accountOpen}
              aria-label={t("shell.workspaceMenu")}
            >
              <span className="app-topbar__avatar">{userInitials}</span>
              <span className="app-topbar__user-info">
                <strong className="app-topbar__user-name">{props.email}</strong>
                <small className="app-topbar__user-company">{props.selectedCompany?.name ?? props.workspace?.name ?? "Atlas"}</small>
              </span>
              <span className="app-topbar__chevron" aria-hidden="true">⌄</span>
            </button>
          </div>
        </header>

        <main id="main-content" className="app-main" tabIndex={-1}>
          <div className="route-transition" key={`${props.route.name}-${"companyId" in props.route ? props.route.companyId : "global"}`}>
            {props.children}
          </div>
        </main>
      </div>

      <AuthenticatedCompanySelector
        open={!props.bootstrapping && chooserOpen}
        companies={props.companies}
        selectedCompanyId={props.selectedCompany?.id ?? null}
        workspaceSelected={props.workspace !== null}
        loading={props.companiesLoading}
        error={props.companyError}
        creating={props.companyCreating}
        onCreate={props.onCreateCompany}
        onCompanySelected={(id) => {
          closeChooser();
          props.onSelectCompany(id);
        }}
        onRetry={props.onRetryCompanies}
        onClose={dismissChooser}
      />
    </div>
  );
}

function AccountMenu({ ref, style, ...props }: AppShellProps & { readonly navigate: Navigate; readonly ref: React.Ref<HTMLDivElement>; readonly style: React.CSSProperties }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div ref={ref} style={style} className="workspace-menu" role="dialog" aria-modal="false" aria-label={t("shell.workspaceMenu")}>
      <section>
        <p>{t("shell.menu.workspace")}</p>
        <strong>{props.workspace?.name ?? t("shell.noWorkspace")}</strong>
        {props.workspaces.length > 1 && <Button variant="quiet" onClick={() => props.navigate("/settings")}>{t("shell.changeWorkspace")}</Button>}
        {props.companies.length > 1 && <Button variant="quiet" onClick={() => props.navigate("/companies")}>{t("shell.changeCompany")}</Button>}
        <Button variant="quiet" onClick={() => props.navigate("/billing")}>{t("billing.title")}</Button>
        <Button variant="quiet" onClick={() => props.navigate("/settings")}>{t("shell.workspaceSettings")}</Button>
        <Button variant="quiet" onClick={() => props.navigate("/dashboard")}>{t("shell.backToDashboard")}</Button>
      </section>
      <section>
        <p>{t("shell.menu.appearance")}</p>
        <ThemeSelector />
      </section>
      <LanguageControl />
      <section>
        <p>{t("shell.menu.account")}</p>
        <small>{props.email}</small>
        {props.isPlatformAdmin && <Button variant="quiet" onClick={() => props.navigate("/admin")}>Volver a Administración</Button>}
        <Button variant="quiet" disabled={props.logoutPending} onClick={props.onPassword}>{t("portal.password")}</Button>
        <Button variant="danger" disabled={props.logoutPending} aria-busy={props.logoutPending} onClick={() => void props.onLogout()}>
          {props.logoutPending ? "Cerrando sesión..." : t("shell.signOut")}
        </Button>
        {props.logoutError && <p className="inline-message inline-message--error" role="alert">{props.logoutError}</p>}
      </section>
    </div>
  );
}

function LanguageControl(): React.JSX.Element {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = (): void => {
    setOpen(false);
    window.setTimeout(() => trigger.current?.focus(), 0);
  };
  return (
    <section className="language-control" onKeyDown={(event) => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <p>{t("language.label")}</p>
      <button ref={trigger} className="language-control__trigger" type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((val) => !val)}>
        <span>{locale === "es" ? t("language.es") : t("language.en")}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="language-control__options" role="listbox" aria-label={t("language.label")}>
          {(["es", "en"] as const).map((option) => (
            <button key={option} type="button" role="option" aria-selected={locale === option} onClick={() => { setLocale(option); close(); }}>
              {option === "es" ? "Español" : "English"}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
