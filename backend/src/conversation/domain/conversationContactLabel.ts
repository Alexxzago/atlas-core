const whatsappFallback = "Cliente de WhatsApp";

export function whatsappContactLabel(profileName: string | null, reference: string | null): string {
  const profile = safeProfileName(profileName);
  if (profile !== null) return profile;
  const phone = safePhoneReference(reference);
  return phone === null ? whatsappFallback : `+${phone.slice(0, 3)} *** ${phone.slice(-4)}`;
}

function safeProfileName(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || Array.from(normalized).length > 160 || normalized.toLocaleLowerCase() === "masked" || normalized.toLocaleLowerCase() === "unknown") return null;
  return normalized;
}

function safePhoneReference(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.normalize("NFKC").trim();
  return /^[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}
