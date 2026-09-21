import { useEffect, useState } from "react";
import { atlasApi } from "../api/atlasApi";
import { Field } from "../design-system/Field";
import { Alert, Button, Input, Stack, Surface } from "../design-system/primitives";
import { useI18n } from "../i18n/I18nContext";
import { authenticatedDestination } from "../routing/authenticatedDestination";
import { useRouter } from "../routing/RouterProvider";
import { useAuthentication } from "../state/AuthenticationContext";
import { AuthLayout } from "./AuthLayout";
import { AuthenticatedCompanyPortal } from "./AuthenticatedCompanyPortal";
import { StartupState } from "./StartupState";

type View = "login" | "request" | "check" | "enroll" | "invitation" | "password";

export function AuthenticationPortal(): React.JSX.Element {
  const { locale } = useI18n();
  const { navigate, pathname, search, intentionalWorkspaceAccess } = useRouter();
  const { state: auth, bootstrap, login, logout, invalidate } = useAuthentication();
  const es = locale === "es";
  const invitationLink = pathname.includes("accept-invitation");
  const hasProof = new URLSearchParams(search).has("proof");
  const [view, setView] = useState<View>(hasProof && !invitationLink && pathname.includes("/enroll-credential") ? "enroll" : "login");
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState(""), [error, setError] = useState(""), [logoutPending, setLogoutPending] = useState(false), [logoutError, setLogoutError] = useState("");
  const proof = (): string => new URLSearchParams(search).get("proof") ?? "";
  const message = (): string => es ? "No pudimos completar la operación." : "We couldn't complete the operation.";
  const submit = async (action: () => Promise<void>): Promise<void> => { setError(""); try { await action(); } catch { setError(message()); } };
  const performLogout = async (): Promise<void> => { if (logoutPending) return; setLogoutPending(true); setLogoutError(""); try { await logout(); setView("login"); navigate("/sign-in", { replace: true }); } catch { setLogoutError(es ? "No pudimos cerrar sesión. Intentá nuevamente." : "We couldn't sign you out. Try again."); } finally { setLogoutPending(false); } };

  useEffect(() => { if (auth.status === "authenticated" && invitationLink) setView("invitation"); }, [auth.status, invitationLink]);
  useEffect(() => { if (auth.status === "unauthenticated" && !invitationLink && !hasProof) navigate("/sign-in", { replace: true }); }, [auth.status, hasProof, invitationLink, navigate]);
  useEffect(() => { if (auth.status === "authenticated" && auth.identity.isPlatformAdmin && !invitationLink && !intentionalWorkspaceAccess && pathname !== authenticatedDestination(true)) navigate(authenticatedDestination(true), { replace: true }); }, [auth, intentionalWorkspaceAccess, invitationLink, navigate, pathname]);

  if (auth.status === "booting") return <StartupState />;
  if (auth.status === "retryable-error") return <StartupState unavailable onRetry={() => void bootstrap()} />;
  if (auth.status === "authenticated") {
    if (auth.identity.isPlatformAdmin && !invitationLink && !intentionalWorkspaceAccess) return <StartupState />;
    if (view === "password") return <AuthForm title={es ? "Cambiar contraseña" : "Replace password"} error={error} onSubmit={(event) => { event.preventDefault(); void submit(async () => { await atlasApi.replacePassword(auth.csrfToken, String(new FormData(event.currentTarget).get("current") ?? ""), password, confirmation); invalidate(); setView("login"); }); }}><Password name="current" label={es ? "Contraseña actual" : "Current password"}/><Password value={password} onChange={setPassword} label={es ? "Nueva contraseña" : "New password"}/><Password value={confirmation} onChange={setConfirmation} label={es ? "Confirmación" : "Confirmation"}/><Button type="submit">{es ? "Cambiar contraseña" : "Replace password"}</Button></AuthForm>;
    if (invitationLink && view === "invitation") return <AuthCard title={es ? "Invitación al espacio" : "Workspace invitation"} error={error}><Button onClick={() => void submit(async () => { await atlasApi.acceptInvitation(auth.csrfToken, proof()); navigate("/", { replace: true }); setView("login"); })}>{es ? "Aceptar" : "Accept"}</Button><Button variant="secondary" onClick={() => void submit(async () => { await atlasApi.rejectInvitation(auth.csrfToken, proof()); navigate("/", { replace: true }); setView("login"); })}>{es ? "Rechazar" : "Reject"}</Button></AuthCard>;
    return <AuthenticatedCompanyPortal csrf={auth.csrfToken} email={auth.identity.email} isPlatformAdmin={auth.identity.isPlatformAdmin} logoutError={logoutError} logoutPending={logoutPending} onLogout={performLogout} onPassword={() => setView("password")}/>;
  }
  if (view === "check") return <AuthCard title={es ? "Revisá tu correo" : "Check your email"}><p>{es ? "Si la identidad es elegible, enviamos un enlace." : "If the identity is eligible, we sent a link."}</p><Button variant="secondary" onClick={() => setView("login")}>{es ? "Volver" : "Back"}</Button></AuthCard>;
  if (view === "enroll") return <AuthForm title={es ? "Crear contraseña" : "Create password"} error={error} onSubmit={(event) => { event.preventDefault(); void submit(async () => { await atlasApi.completeCredentialEnrollment(proof(), password, confirmation); navigate("/", { replace: true }); setView("login"); }); }}><Password value={password} onChange={setPassword} label={es ? "Contraseña" : "Password"}/><Password value={confirmation} onChange={setConfirmation} label={es ? "Confirmación" : "Confirmation"}/><Button type="submit">{es ? "Crear contraseña" : "Create password"}</Button></AuthForm>;
  if (view === "request") return <AuthForm title={es ? "Inscribir una contraseña" : "Enroll a password"} error={error} onSubmit={(event) => { event.preventDefault(); void submit(async () => { await atlasApi.requestCredentialEnrollment(email); setView("check"); }); }}><Field id="legacy-enrollment-email" label={es ? "Correo electrónico" : "Email"}><Input autoComplete="email" id="legacy-enrollment-email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)}/></Field><Button type="submit">{es ? "Enviar enlace" : "Send link"}</Button></AuthForm>;
  return <AuthForm title={es ? "Iniciar sesión" : "Log in"} error={error || auth.error || ""} onSubmit={(event) => { event.preventDefault(); void submit(async () => { await login(email, password); }); }}><Field id="legacy-login-email" label={es ? "Correo electrónico" : "Email"}><Input autoComplete="email" id="legacy-login-email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)}/></Field><Password value={password} onChange={setPassword} label={es ? "Contraseña" : "Password"}/><Button type="submit">{es ? "Ingresar" : "Log in"}</Button><Button type="button" variant="quiet" onClick={() => setView("request")}>{es ? "Crear contraseña" : "Enroll password"}</Button></AuthForm>;
}

function AuthCard({ title, error, children }: { readonly title: string; readonly error?: string; readonly children: React.ReactNode }): React.JSX.Element { return <AuthLayout><Surface className="auth-card" tone="raised"><Stack gap="5"><div className="auth-card__header"><h1>{title}</h1></div>{error && <Alert tone="danger">{error}</Alert>}{children}</Stack></Surface></AuthLayout>; }
function AuthForm({ title, error, onSubmit, children }: { readonly title: string; readonly error: string; readonly onSubmit: React.FormEventHandler<HTMLFormElement>; readonly children: React.ReactNode }): React.JSX.Element { return <AuthLayout><Surface className="auth-card" tone="raised"><form onSubmit={onSubmit}><div className="auth-card__header"><h1>{title}</h1></div>{error && <Alert tone="danger">{error}</Alert>}{children}</form></Surface></AuthLayout>; }
function Password({ label, name = "password", value, onChange }: { readonly label: string; readonly name?: string; readonly value?: string; readonly onChange?: (value: string) => void }): React.JSX.Element { const id = `legacy-${name}`; return <Field id={id} label={label}><Input autoComplete={name === "current" ? "current-password" : "new-password"} id={id} name={name} required type="password" value={value} onChange={onChange ? (event) => onChange(event.target.value) : undefined}/></Field>; }
