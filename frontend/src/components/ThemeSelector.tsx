import { useTheme } from "../design-system/theme";
import { useI18n } from "../i18n/I18nContext";

function ThemeIcon({ nextTheme }: { readonly nextTheme: "light" | "dark" }): React.JSX.Element {
  return nextTheme === "dark" ? <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.4 15.2A8.5 8.5 0 0 1 8.8 3.6 8.5 8.5 0 1 0 20.4 15.2Z" /></svg> : <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>;
}

export function ThemeSelector(): React.JSX.Element {
  const { t } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const nextTheme = resolvedTheme === "light" ? "dark" : "light";
  const toggle = (): void => setTheme(nextTheme);
  return <button aria-label={t("theme.changeAppearance")} className="theme-selector" title={t("theme.changeAppearance")} type="button" onClick={toggle} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } }}>
    <ThemeIcon nextTheme={nextTheme} />
  </button>;
}
