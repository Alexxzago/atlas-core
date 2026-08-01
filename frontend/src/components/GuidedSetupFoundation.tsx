import { useEffect } from "react";
import { Skeleton } from "../design-system/primitives";
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

const pageKeys = {
  landing: { title: "guided.landing.title", description: "guided.landing.description" }, register: { title: "guided.register.title", description: "guided.register.description" }, "verify-email": { title: "guided.verify.title", description: "guided.verify.description" }, "sign-in": { title: "guided.signIn.title", description: "guided.signIn.description" }, "forgot-password": { title: "guided.forgot.title", description: "guided.forgot.description" }, "reset-password": { title: "guided.reset.title", description: "guided.reset.description" },
} as const;

export function GuidedSetupProgress(): React.JSX.Element { const { t } = useI18n(); return <nav aria-label={t("guided.progress.label")}><ol>{["guided.progress.company", "guided.progress.knowledge", "guided.progress.test", "guided.progress.ready"].map((key, index) => <li key={key} aria-current={index === 0 ? "step" : undefined}>{t(key as "guided.progress.company")}</li>)}</ol></nav>; }
export function PublicLayout({ children }: { readonly children: React.ReactNode }): React.JSX.Element { return <main id="main-content"><Container size="wide"><Stack gap="6"><header><strong>ATLAS</strong></header>{children}</Stack></Container></main>; }
export function AccountLayout({ children }: { readonly children: React.ReactNode }): React.JSX.Element { return <PublicLayout><Container size="narrow">{children}</Container></PublicLayout>; }
export function OnboardingLayout({ children }: { readonly children: React.ReactNode }): React.JSX.Element { return <PublicLayout><GuidedSetupProgress />{children}</PublicLayout>; }

export function GuidedSetupFoundation(): React.JSX.Element {
  const { state: auth } = useAuthentication(); const { t } = useI18n();
  if (auth.status === "booting" || auth.status === "retryable-error") return <main><Skeleton label={t("guided.loading")} /></main>;
  if (auth.status !== "authenticated") return <GuidedSetupContent guardState="unauthenticated" />;
  return <AuthenticatedPortalProvider csrf={auth.csrfToken}><AuthenticatedGuidedSetup /></AuthenticatedPortalProvider>;
}

function AuthenticatedGuidedSetup(): React.JSX.Element {
  const { state, selectedWorkspace, selectedCompany } = useAuthenticatedPortal(); const { t } = useI18n();
  if (state.workspacesLoading || state.pendingWorkspaceId !== null || state.companiesLoading) return <main><Skeleton label={t("guided.loading")} /></main>;
  const activationPending = selectedCompany?.status === "processing" || (state.companies.length === 1 && state.companies[0]?.status === "processing");
  const guardState: GuidedSetupGuardState = !selectedWorkspace ? "authenticated-needs-workspace" : state.companies.length === 0 ? "authenticated-needs-company" : activationPending ? "authenticated-activation-pending" : "authenticated-ready";
  return <GuidedSetupContent guardState={guardState} />;
}

function GuidedSetupContent({ guardState }: { readonly guardState: GuidedSetupGuardState }): React.JSX.Element {
  const { t } = useI18n(); const { appRoute, search, navigate } = useRouter();
  const route = appRoute.kind === "public" && appRoute.name === "guided" ? appRoute.route : { name: "not-found" } as const;
  const resolved = resolveGuidedSetupRoute(route, guardState);
  const redirect = "redirect" in resolved ? resolved.redirect : null;
  useEffect(() => { if (redirect) navigate(redirect, { replace: true }); }, [navigate, redirect]);
  if (redirect) return <main><Skeleton label={t("guided.loading")} /></main>;
  const pageRoute = resolved as Exclude<typeof resolved, { readonly redirect: string }>;
  if (pageRoute.name === "not-found") return <PublicLayout><Surface><h1>{t("guided.notFound.title")}</h1><Button onClick={() => navigate("/")}>{t("guided.notFound.action")}</Button></Surface></PublicLayout>;
  if (pageRoute.name === "register") return <AccountLayout><GuidedRegistration /></AccountLayout>;
  if (pageRoute.name === "verify-email") return <AccountLayout><GuidedRegistration verificationProof={new URLSearchParams(search).get("proof") ?? ""} onContinue={() => navigate("/sign-in")} /></AccountLayout>;
  if (pageRoute.name === "sign-in") return <AccountLayout><GuidedSignIn /></AccountLayout>;
  if (pageRoute.name === "forgot-password") return <AccountLayout><GuidedForgotPassword onSignIn={() => navigate("/sign-in")} /></AccountLayout>;
  if (pageRoute.name === "reset-password") return <AccountLayout><GuidedResetPassword proof={new URLSearchParams(search).get("proof") ?? ""} onSignIn={() => navigate("/sign-in")} /></AccountLayout>;
  if (pageRoute.name === "workspace-setup" || pageRoute.name === "company-setup") return <OnboardingLayout><GuidedAssistantSetup /></OnboardingLayout>;
  if (pageRoute.name === "activation-pending") return <OnboardingLayout><ActivationPending /></OnboardingLayout>;
  const page = pageKeys.landing;
  return <PublicLayout><Surface tone="raised"><Stack gap="4"><h1 tabIndex={-1}>{t(page.title)}</h1><p>{t(page.description)}</p><Button onClick={() => navigate("/register")}>{t("guided.action")}</Button><Skeleton label={t("guided.loading")} /></Stack></Surface></PublicLayout>;
}
