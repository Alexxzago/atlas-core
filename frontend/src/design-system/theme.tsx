import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
interface ThemeContextValue { readonly theme: Theme; readonly resolvedTheme: "light" | "dark"; setTheme(theme: Theme): void; }
const ThemeContext = createContext<ThemeContextValue | null>(null);
const storageKey = "atlas-theme";

function resolve(theme: Theme): "light" | "dark" { return theme === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" : theme; }

export function ThemeProvider({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>(() => { const stored = window.localStorage.getItem(storageKey); return stored === "light" || stored === "dark" || stored === "system" ? stored : "system"; });
  const resolvedTheme = resolve(theme);
  useEffect(() => { document.documentElement.dataset.theme = resolvedTheme; document.documentElement.style.colorScheme = resolvedTheme; window.localStorage.setItem(storageKey, theme); }, [resolvedTheme, theme]);
  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue { const value = useContext(ThemeContext); if (!value) throw new Error("useTheme must be used within ThemeProvider."); return value; }
