export type EmailDeliveryMode = "development" | "smtp" | "resend";

export function emailDeliveryMode(value: string | undefined, production: boolean): EmailDeliveryMode {
  const mode = value?.trim().toLowerCase();
  if (!mode && !production) return "development";
  if (!mode || mode === "smtp") return "smtp";
  if (mode === "resend") return "resend";
  throw new Error("ATLAS_VERIFICATION_DELIVERY must be smtp or resend.");
}
