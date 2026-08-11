import { useEffect } from "react";
import { useI18n } from "../i18n/I18nContext";
import { useRouter } from "../routing/RouterProvider";
import { resolveGuidedSetupRoute, type GuidedSetupGuardState } from "../routing/guidedSetupRoutes";
import { useAuthentication } from "../state/AuthenticationContext";
import { AuthenticatedPortalProvider, useAuthenticatedPortal } from "../state/AuthenticatedPortalProvider";
import { GuidedAssistantSetup } from "./GuidedAssistantSetup";
import { GuidedRegistration } from "./GuidedRegistration";
import { GuidedSignIn } from "./GuidedSignIn";
import { ActivationPending } from "./ActivationPending";
import { GuidedForgotPassword } from "./GuidedForgotPassword";
import { GuidedResetPassword } from "./GuidedResetPassword";
import { Button, Container, Stack, Surface } from "../design-system/primitives";
import { AuthLayout } from "./AuthLayout";
import { StartupState } from "./StartupState";
import { StepList } from "../design-system/product";
import { resolveAuthenticatedOnboardingProgress, type AuthenticatedOnboardingProgress } from "../routing/onboardingProgress";

const pageKeys = {
  landing: { title: "guided.landing.title", description: "guided.landing.description" }, register: { title: "guided.register.title", description: "guided.register.description" }, "verify-email": { title: "guided.verify.title", description: "guided.verify.description" }, "sign-in": { title: "guided.signIn.title", description: "guided.signIn.description" }, "forgot-password": { title: "guided.forgot.title", description: "guided.forgot.description" }, "reset-password": { title: "guided.reset.title", description: "guided.reset.description" },
} as const;

type OnboardingStep = "workspace" | "company" | "setup";
export function GuidedSetupProgress({ current }: { readonly current: OnboardingStep }): React.JSX.Element { const { t } = useI18n(); const steps: ReadonlyArray<{ readonly id: OnboardingStep; readonly key: "assistantSetup.progress.workspace" | "assistantSetup.progress.company" | "assistantSetup.progress.configuration" }> = [{ id: "workspace", key: "assistantSetup.progress.workspace" }, { id: "company", key: "assistantSetup.progress.company" }, { id: "setup", key: "assistantSetup.progress.configuration" }]; const currentIndex = steps.findIndex((step) => step.id === current); return <nav aria-label={t("guided.progress.label")}><StepList className="onboarding-progress">{steps.map((step, index) => <li key={step.id} aria-current={step.id === current ? "step" : undefined} data-state={index < currentIndex ? "complete" : step.id === current ? "active" : "upcoming"}>{t(step.key)}</li>)}</StepList></nav>; }
export function PublicLayout({ children }: { readonly children: React.ReactNode }): React.JSX.Element { return <main id="main-content"><Container size="wide"><Stack gap="6"><header><strong>ATLAS</strong></header>{children}</Stack></Container></main>; }
export function AccountLayout({ children }: { readonly children: React.ReactNode }): React.JSX.Element { return <AuthLayout>{children}</AuthLayout>; }
export function OnboardingLayout({ children, step }: { readonly children: React.ReactNode; readonly step: OnboardingStep }): React.JSX.Element { return <main className="onboarding-shell" id="main-content"><Container size="narrow"><Stack gap="6"><header className="onboarding-brand"><strong>ATLAS</strong></header><GuidedSetupProgress current={step}/>{children}</Stack></Container></main>; }

export function GuidedSetupFoundation(): React.JSX.Element {
  const { state: auth, bootstrap } = useAuthentication(); const { t } = useI18n();
  if (auth.status === "booting") return <StartupState />;
  if (auth.status === "retryable-error") return <StartupState unavailable onRetry={() => void bootstrap()} />;
  if (auth.status !== "authenticated") return <GuidedSetupContent guardState="unauthenticated" />;
  if (auth.identity.isPlatformAdmin) return <GuidedSetupContent guardState="authenticated-ready" isPlatformAdmin />;
  return <AuthenticatedPortalProvider csrf={auth.csrfToken}><AuthenticatedGuidedSetup /></AuthenticatedPortalProvider>;
}

function AuthenticatedGuidedSetup(): React.JSX.Element {
  const { state, selectedWorkspace, refresh, refreshCompanies } = useAuthenticatedPortal(); const { t } = useI18n();
  const progress = resolveAuthenticatedOnboardingProgress({ workspacesLoading: state.workspacesLoading, workspaceError: state.workspaceError, initialWorkspaceResolved: state.initialWorkspaceResolved, pendingWorkspaceId: state.pendingWorkspaceId, selectedWorkspaceId: selectedWorkspace?.id ?? null, workspaceCount: state.workspaces.length, companiesLoading: state.companiesLoading, companyError: state.companyError, companies: state.companies });
  if (progress === "loading") return <StartupState />;
  if (progress === "error") return <OnboardingLoadFailure message={t(selectedWorkspace ? "portal.companiesError" : "assistantSetup.error.unavailable")} onRetry={selectedWorkspace ? refreshCompanies : () => void refresh()} />;
  const guardState: GuidedSetupGuardState = guidedGuardState(progress);
  return <GuidedSetupContent guardState={guardState} />;
}

function guidedGuardState(progress: AuthenticatedOnboardingProgress): GuidedSetupGuardState {
  if (progress === "needs-workspace" || progress === "needs-workspace-selection") return "authenticated-needs-workspace";
  if (progress === "needs-company") return "authenticated-needs-company";
  if (progress === "activation-pending") return "authenticated-activation-pending";
  return "authenticated-ready";
}

function OnboardingLoadFailure({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }): React.JSX.Element {
  const { t } = useI18n();
  return <OnboardingLayout step="workspace"><Surface tone="raised"><Stack gap="4"><p role="alert">{message}</p><Button onClick={onRetry}>{t("common.retry")}</Button></Stack></Surface></OnboardingLayout>;
}

function GuidedSetupContent({ guardState, isPlatformAdmin = false }: { readonly guardState: GuidedSetupGuardState; readonly isPlatformAdmin?: boolean }): React.JSX.Element {
  const { t } = useI18n(); const { appRoute, search, navigate, pathname } = useRouter();
  const route = appRoute.kind === "public" && appRoute.name === "guided" ? appRoute.route : { name: "not-found" } as const;
  const resolved = resolveGuidedSetupRoute(route, guardState, isPlatformAdmin);
  const redirect = "redirect" in resolved ? resolved.redirect : null;
  useEffect(() => {
    if (pathname === "/identity/verify-email") {
      navigate(`/verify-email${search}`, { replace: true });
    }
  }, [pathname, search, navigate]);
  useEffect(() => { if (redirect) navigate(redirect, { replace: true }); }, [navigate, redirect]);
  if (redirect) return <StartupState />;
  const pageRoute = resolved as Exclude<typeof resolved, { readonly redirect: string }>;
  if (pageRoute.name === "not-found") return <PublicLayout><Surface><h1>{t("guided.notFound.title")}</h1><Button onClick={() => navigate("/")}>{t("guided.notFound.action")}</Button></Surface></PublicLayout>;
  if (pageRoute.name === "register") return <AccountLayout><GuidedRegistration /></AccountLayout>;
  if (pageRoute.name === "verify-email") return <AccountLayout><GuidedRegistration verificationProof={new URLSearchParams(search).get("proof") ?? ""} onContinue={() => navigate("/sign-in")} /></AccountLayout>;
  if (pageRoute.name === "sign-in") return <AccountLayout><GuidedSignIn /></AccountLayout>;
  if (pageRoute.name === "forgot-password") return <AccountLayout><GuidedForgotPassword onSignIn={() => navigate("/sign-in")} /></AccountLayout>;
  if (pageRoute.name === "reset-password") return <AccountLayout><GuidedResetPassword proof={new URLSearchParams(search).get("proof") ?? ""} onSignIn={() => navigate("/sign-in")} /></AccountLayout>;
  if (pageRoute.name === "workspace-setup") return <OnboardingLayout step="workspace"><GuidedAssistantSetup /></OnboardingLayout>;
  if (pageRoute.name === "company-setup") return <OnboardingLayout step="company"><GuidedAssistantSetup /></OnboardingLayout>;
  if (pageRoute.name === "activation-pending") return <OnboardingLayout step="setup"><ActivationPending /></OnboardingLayout>;
  const page = pageKeys.landing;
  return <PublicLayout><Surface tone="raised"><Stack gap="4"><h1 tabIndex={-1}>{t(page.title)}</h1><p>{t(page.description)}</p><Button onClick={() => navigate("/register")}>{t("guided.action")}</Button></Stack></Surface></PublicLayout>;
}
