import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import RouterApp from "./RouterApp";

function installGlobalErrorHandlers() {
  const report = (title: string, detail: string) => {
    // eslint-disable-next-line no-console
    console.error(title, detail);
    try {
      const existing = document.getElementById("fatal-error-overlay");
      if (existing) existing.remove();

      const el = document.createElement("div");
      el.id = "fatal-error-overlay";
      el.style.position = "fixed";
      el.style.inset = "0";
      el.style.zIndex = "999999";
      el.style.background = "#0b0d12";
      el.style.color = "#e8eaf0";
      el.style.padding = "20px";
      el.style.fontFamily =
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
      el.style.overflow = "auto";
      el.innerHTML = `
        <div style="max-width: 980px; margin: 0 auto;">
          <div style="font-size: 14px; opacity: 0.85;">manifold frontend crashed</div>
          <div style="font-size: 18px; font-weight: 700; margin-top: 6px;">${title}</div>
          <pre style="white-space: pre-wrap; line-height: 1.35; margin-top: 12px; background: rgba(255,255,255,0.06); padding: 12px; border-radius: 10px;">${detail}</pre>
          <div style="margin-top: 12px; font-size: 12px; opacity: 0.8;">
            This overlay is shown to avoid a blank window. Check the devtools console for full logs.
          </div>
        </div>
      `;
      document.body.appendChild(el);
    } catch {
      // ignore secondary failures
    }
  };

  window.addEventListener("error", (e) => {
    const detail =
      e.error instanceof Error
        ? `${e.error.name}: ${e.error.message}\n${e.error.stack ?? ""}`
        : `${String(e.message)}\n${String((e as unknown as { filename?: string }).filename ?? "")}`;
    report("Uncaught error", detail);
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = (e as PromiseRejectionEvent).reason;
    const detail =
      reason instanceof Error
        ? `${reason.name}: ${reason.message}\n${reason.stack ?? ""}`
        : String(reason);
    report("Unhandled promise rejection", detail);
  });
}

installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <TooltipProvider delayDuration={300}>
        <RouterApp />
      </TooltipProvider>
    </HashRouter>
  </React.StrictMode>,
);
