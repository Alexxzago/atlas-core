export type EmailDeliveryMode = "development" | "smtp" | "resend" | "google_apps_script";

export function emailDeliveryMode(value: string | undefined, production: boolean, environment: NodeJS.ProcessEnv = process.env): EmailDeliveryMode {
  const mode = (value ?? environment.EMAIL_PROVIDER ?? environment.ATLAS_VERIFICATION_DELIVERY)?.trim().toLowerCase();
  if (!mode && !production) return "development";
  if (!mode || mode === "smtp") return "smtp";
  if (mode === "resend") return "resend";
  if (mode === "google_apps_script") return "google_apps_script";
  throw new Error("EMAIL_PROVIDER/ATLAS_VERIFICATION_DELIVERY must be smtp, resend, or google_apps_script.");
}
