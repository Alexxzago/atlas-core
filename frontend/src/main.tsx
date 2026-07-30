import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n/I18nContext";
import { ThemeProvider } from "./design-system/theme";
import "./styles/tokens.css";
import "./styles/reset.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./design-system/foundations.css";
import "./styles/dashboard.css";

createRoot(document.getElementById("root")!).render(<StrictMode><ThemeProvider><I18nProvider><App /></I18nProvider></ThemeProvider></StrictMode>);
