import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { localeMetadata, translations, type Locale, type TranslationKey } from "./translations";

const STORAGE_KEY = "atlas.locale";

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
  formatDate: (value: string | Date) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function detectLocale(): Locale {
  const persisted = window.localStorage.getItem(STORAGE_KEY);
  if (persisted === "es" || persisted === "en") return persisted;
  for (const browserLocale of navigator.languages) {
    const language = browserLocale.toLowerCase().split("-")[0];
    if (language === "es") return "es";
    if (language === "en") return "en";
  }
  return "en";
}

export function I18nProvider({ children }: { children: ReactNode }): ReactNode {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const setLocale = (nextLocale: Locale): void => {
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
    setLocaleState(nextLocale);
  };

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeMetadata[locale].direction;
    document.title = translations[locale]["app.title"];
  }, [locale]);

  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale,
    t: (key, variables) => {
      let message = translations[locale][key] ?? translations.en[key];
      if (variables) {
        for (const [name, replacement] of Object.entries(variables)) {
          message = message.replaceAll(`{${name}}`, String(replacement));
        }
      }
      return message;
    },
    formatDate: (value) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(value)),
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
