import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import "./styles.css";

// A browser has no Tauri host. In development one is installed that answers
// with a real conversion, so the workspace can be worked on without
// building the desktop shell. Never present in a packaged build.
if (import.meta.env.DEV) {
  const { installDevHost } = await import("./dev/host");
  installDevHost();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

