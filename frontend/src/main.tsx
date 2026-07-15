import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n/I18nContext";
import "./styles/tokens.css";
import "./styles/reset.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";

createRoot(document.getElementById("root")!).render(<StrictMode><I18nProvider><App /></I18nProvider></StrictMode>);
