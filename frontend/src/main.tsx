import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import "./index.css";
// The console design system. Namespaced under `.console`, so it applies only
// where a screen opts in and cannot disturb the existing theme. Loaded after
// index.css so its tokens win where both would apply.
import "./styles/console.css";
// Side-effect import: registers dark-theme defaults for every Chart.js chart.
import "./utils/chartDefaults";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container missing in index.html");
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
