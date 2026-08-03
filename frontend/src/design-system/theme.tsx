import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
interface ThemeContextValue { readonly theme: Theme; readonly resolvedTheme: "light" | "dark"; setTheme(theme: Theme): void; }
const ThemeContext = createContext<ThemeContextValue | null>(null);
export const THEME_STORAGE_KEY = "atlas-theme";

function systemMedia(): MediaQueryList {
  if (typeof window.matchMedia === "function") return window.matchMedia("(prefers-color-scheme: dark)");
  return { matches: false, media: "(prefers-color-scheme: dark)", onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false };
}

export function storedTheme(storage: Pick<Storage, "getItem"> = window.localStorage): Theme {
  const value = storage.getItem(THEME_STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveTheme(theme: Theme, media = systemMedia()): "light" | "dark" {
  return theme === "system" ? media.matches ? "dark" : "light" : theme;
}

export function applyResolvedTheme(theme: "light" | "dark", documentElement = document.documentElement): void {
  documentElement.dataset.theme = theme;
  documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#101827" : "#f4f2ee");
}

export function ThemeProvider({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [theme, setThemeState] = useState<Theme>(storedTheme);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => resolveTheme(storedTheme()));

  useEffect(() => {
    const media = systemMedia();
    const apply = (): void => {
      const resolved = resolveTheme(theme, media);
      setResolvedTheme(resolved);
      applyResolvedTheme(resolved);
    };
    apply();
    if (theme !== "system") return;
    const onSystemChange = (event: MediaQueryListEvent): void => {
      const resolved = event.matches ? "dark" : "light";
      setResolvedTheme(resolved);
      applyResolvedTheme(resolved);
    };
    media.addEventListener("change", onSystemChange);
    return () => media.removeEventListener("change", onSystemChange);
  }, [theme]);

  const setTheme = (nextTheme: Theme): void => {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    setThemeState(nextTheme);
  };

  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue { const value = useContext(ThemeContext); if (!value) throw new Error("useTheme must be used within ThemeProvider."); return value; }
