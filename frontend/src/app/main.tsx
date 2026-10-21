import React, { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SignIn } from "./SignIn";
import { WorkspaceBoundary } from "./WorkspaceBoundary";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/barlow-semi-condensed/latin-500.css";
import "@fontsource/barlow-semi-condensed/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./styles.css";
import { applyTheme, storedTheme } from "../components/ThemeToggle";
import { BrandMark } from "../components/AppSidebar";
applyTheme(storedTheme());
const FleetApp = lazy(() =>
  import("../features/fleet/FleetApp").then((module) => ({
    default: module.FleetApp,
  })),
);
const HostWorkspace = lazy(() =>
  import("./HostWorkspace").then((module) => ({
    default: module.HostWorkspace,
  })),
);

function Deployment() {
  const [mode, setMode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/healthz", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Server unavailable");
        return response.json();
      })
      .then((data) => setMode(data.mode || "standalone"))
      .catch((err) => {
        if (controller.signal.aborted) return;
        // Network failures and non-JSON replies (proxy error pages) read the same to an operator.
        setError(
          err instanceof TypeError || err instanceof SyntaxError
            ? "The OpsDeck server did not respond"
            : (err as Error).message,
        );
      });
    return () => controller.abort();
  }, [retry]);
  if (!mode)
    return (
      <main className="login" aria-busy={!error}>
        <div className="login-status">
          <BrandMark size={22} />
          <p role={error ? "alert" : "status"}>
            {error
              ? `${error.replace(/\.$/, "")}. Check that the OpsDeck server is running, then retry.`
              : "Connecting to OpsDeck..."}
          </p>
          {!error && <span className="skeleton" aria-hidden="true" />}
        </div>
        {error && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setError("");
              setRetry((value) => value + 1);
            }}
          >
            Retry connection
          </button>
        )}
      </main>
    );
  return (
    <Suspense
      fallback={
        <main className="login" aria-busy="true">
          <div className="login-status">
            <BrandMark size={22} />
            <p role="status">Opening OpsDeck…</p>
            <span className="skeleton" aria-hidden="true" />
          </div>
        </main>
      }
    >
      {mode === "central" ? (
        <FleetApp
          signIn={(callback) => <SignIn central onSignIn={callback} />}
        />
      ) : (
        <HostWorkspace />
      )}
    </Suspense>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkspaceBoundary>
      <Deployment />
    </WorkspaceBoundary>
  </React.StrictMode>,
);
