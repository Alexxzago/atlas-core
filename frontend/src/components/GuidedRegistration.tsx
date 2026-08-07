import { useEffect, useReducer, useRef, useState } from "react";
import { ApiError, atlasApi } from "../api/atlasApi";
import { Button, Skeleton, Stack, Surface } from "../design-system/primitives";
import { Field, fieldDescribedBy } from "../design-system/Field";
import { PasswordField } from "../design-system/PasswordField";
import { useI18n } from "../i18n/I18nContext";
import { useRouter } from "../routing/RouterProvider";

type Step = "form" | "requested" | "verified" | "invalid" | "unavailable";
interface State { step: Step; fullName: string; email: string; password: string; confirmation: string; loading: boolean; error: string | null; }
type Action = { type: "field"; field: "fullName" | "email" | "password" | "confirmation"; value: string } | { type: "error"; error: string } | { type: "requested" } | { type: "verified" | "invalid" | "unavailable" } | { type: "loading"; value: boolean };
const initialState: State = { step: "form", fullName: "", email: "", password: "", confirmation: "", loading: false, error: null };

function reducer(state: State, action: Action): State {
  if (action.type === "field") return { ...state, [action.field]: action.value, error: null };
  if (action.type === "error") return { ...state, error: action.error, loading: false };
  if (action.type === "loading") return { ...state, loading: action.value, error: null };
  if (action.type === "requested") return { ...state, step: "requested", loading: false, error: null };
  return { ...state, step: action.type, loading: false, error: null };
}

function registrationError(error: unknown, invalid: string, unavailable: string): string {
  return error instanceof ApiError && error.status === 400 ? invalid : unavailable;
}

export function GuidedRegistration({ verificationProof, onContinue }: { readonly verificationProof?: string; readonly onContinue?: () => void }): React.JSX.Element {
  const { locale, t } = useI18n();
  const { navigate } = useRouter();
  const [state, dispatch] = useReducer(reducer, verificationProof === undefined ? initialState : { ...initialState, step: "form", loading: true });
  const heading = useRef<HTMLHeadingElement>(null);

  const [proofValue] = useState(verificationProof);
  useEffect(() => { if (proofValue) window.history.replaceState(window.history.state, "", "/verify-email"); }, [proofValue]);

  useEffect(() => { heading.current?.focus(); }, [state.step]);

  useEffect(() => {
    if (verificationProof === undefined) return;
    void atlasApi.verifyEmail(verificationProof)
      .then((result) => dispatch({ type: result.status === "verified" ? "verified" : "invalid" }))
      .catch(() => dispatch({ type: "unavailable" }));
  }, [verificationProof]);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const cleanName = state.fullName.trim();
    const cleanEmail = state.email.trim();

    if (!cleanName || !cleanEmail || !state.password || !state.confirmation) {
      dispatch({ type: "error", error: t("registration.error.invalid") });
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      dispatch({ type: "error", error: t("registration.error.email") });
      return;
    }
    const length = Array.from(state.password).length;
    if (length < 15) {
      dispatch({ type: "error", error: t("registration.error.invalid") });
      return;
    }
    if (state.password !== state.confirmation) {
      dispatch({ type: "error", error: t("registration.validation.match") });
      return;
    }

    dispatch({ type: "loading", value: true });
    try {
      await atlasApi.register({
        fullName: cleanName,
        email: cleanEmail,
        password: state.password,
        confirmation: state.confirmation,
        locale,
      });
      dispatch({ type: "requested" });
    } catch (error: unknown) {
      dispatch({
        type: "error",
        error: registrationError(
          error,
          t("registration.error.invalid"),
          t("registration.error.unavailable")
        ),
      });
    }
  };

  const resend = async (): Promise<void> => {
    dispatch({ type: "loading", value: true });
    try {
      await atlasApi.resendVerification(state.email.trim(), locale);
      dispatch({ type: "loading", value: false });
    } catch (error: unknown) {
      dispatch({
        type: "error",
        error: registrationError(
          error,
          t("registration.error.email"),
          t("registration.error.unavailable")
        ),
      });
    }
  };

  const linkToSignIn = (event: React.MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    navigate("/sign-in");
  };

  if (verificationProof !== undefined) {
    return (
      <Surface className="auth-card" key={state.step} tone="raised">
        <Stack gap="4">
          <div className="auth-card__header">
            <h1 ref={heading} tabIndex={-1}>
              {t(`registration.verify.${state.step}` as "registration.verify.verified")}
            </h1>
          </div>
          {state.loading ? (
            <Skeleton label={t("registration.loading")} />
          ) : (
            <p role="status" aria-live="polite">
              {t(`registration.verify.${state.step}.description` as "registration.verify.verified.description")}
            </p>
          )}
          {state.step === "verified" && (
            <Button className="auth-card__submit" onClick={onContinue ?? (() => navigate("/sign-in"))}>
              {t("guided.signIn.title")}
            </Button>
          )}
        </Stack>
      </Surface>
    );
  }

  if (state.step === "requested") {
    return (
      <Surface className="auth-card" key={state.step} tone="raised">
        <Stack gap="4">
          <div className="auth-card__header">
            <h1 ref={heading} tabIndex={-1}>{t("registration.requested.title")}</h1>
          </div>
          <p role="status" aria-live="polite">
            {t("registration.requested.description", { email: state.email })}
          </p>
          <Button className="auth-card__submit" disabled={state.loading} onClick={() => void resend()}>
            {t(state.loading ? "registration.resend.loading" : "registration.resend")}
          </Button>
          {state.error && <p role="alert">{state.error}</p>}
          <p className="auth-card__prompt">
            <a className="auth-card__link" href="/sign-in" onClick={linkToSignIn}>
              {t("guided.signIn.title")}
            </a>
          </p>
        </Stack>
      </Surface>
    );
  }

  return (
    <Surface className="auth-card" tone="raised">
      <form noValidate onSubmit={(event) => void submit(event)}>
        <div className="auth-card__header">
          <h1 ref={heading} tabIndex={-1}>
            {t("guided.register.title")}
          </h1>
          <p>{t("guided.register.description")}</p>
        </div>

        <Stack gap="4">
          <Field id="guided-registration-fullName" label={t("registration.field.fullName")}>
            <input
              autoComplete="name"
              autoFocus
              className="ds-control"
              id="guided-registration-fullName"
              name="fullName"
              required
              type="text"
              value={state.fullName}
              onChange={(e) => dispatch({ type: "field", field: "fullName", value: e.target.value })}
            />
          </Field>

          <Field id="guided-registration-email" label={t("registration.field.email")}>
            <input
              autoComplete="email"
              className="ds-control"
              id="guided-registration-email"
              name="email"
              required
              type="email"
              value={state.email}
              onChange={(e) => dispatch({ type: "field", field: "email", value: e.target.value })}
            />
          </Field>

          <PasswordField
            autoComplete="new-password"
            id="guided-registration-password"
            label={t("registration.field.password")}
            minLength={15}
            name="password"
            required
            showLabel={t("auth.password.show")}
            hideLabel={t("auth.password.hide")}
            value={state.password}
            onChange={(e) => dispatch({ type: "field", field: "password", value: e.target.value })}
          />

          <PasswordField
            autoComplete="new-password"
            id="guided-registration-confirmation"
            label={t("registration.field.confirmation")}
            minLength={15}
            name="confirmation"
            required
            showLabel={t("auth.password.show")}
            hideLabel={t("auth.password.hide")}
            value={state.confirmation}
            onChange={(e) => dispatch({ type: "field", field: "confirmation", value: e.target.value })}
          />

          {state.error && <p className="auth-card__alert" role="alert">{state.error}</p>}

          <div className="auth-card__actions">
            <Button className="auth-card__submit" type="submit" disabled={state.loading}>
              {t(state.loading ? "registration.loading" : "guided.register.title")}
            </Button>

            <p className="auth-card__prompt">
              {t("auth.signIn.createPrompt")}{" "}
              <a className="auth-card__link" href="/sign-in" onClick={linkToSignIn}>
                {t("guided.signIn.title")}
              </a>
            </p>
          </div>
        </Stack>
      </form>
    </Surface>
  );
}
