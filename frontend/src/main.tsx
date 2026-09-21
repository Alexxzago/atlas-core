import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n/I18nContext";
import { ThemeProvider } from "./design-system/theme";
import { AuthenticationProvider } from "./state/AuthenticationContext";
import { RouterProvider } from "./routing/RouterProvider";
import "./styles/tokens.css";
import "./styles/reset.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/auth.css";
import "./styles/dashboard.css";
import "./styles/workspace.css";
import "./styles/design-v2.css";
import "./styles/conversations.css";
import "./styles/product.css";
import "./styles/admin.css";
import "./styles/admin-plan-form.css";
import "./styles/automation-controls.css";
import "./styles/commercial-controls.css";
// Legacy styles load first; canonical Atlas primitives remain the final shared layer.
import "./design-system/foundations.css";

createRoot(document.getElementById("root")!).render(<StrictMode><ThemeProvider><I18nProvider><RouterProvider><AuthenticationProvider><App /></AuthenticationProvider></RouterProvider></I18nProvider></ThemeProvider></StrictMode>);
