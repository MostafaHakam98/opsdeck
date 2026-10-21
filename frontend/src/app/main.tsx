import React, { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SignIn } from "./SignIn";
import { WorkspaceBoundary } from "./WorkspaceBoundary";
import "./styles.css";
import { applyTheme, storedTheme } from "../components/ThemeToggle";
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
        if (!controller.signal.aborted) setError((err as Error).message);
      });
    return () => controller.abort();
  }, [retry]);
  if (!mode)
    return (
      <main className="login">
        <p>{error || "Connecting to OpsDeck..."}</p>
        {error && (
          <button
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
        <main className="login">
          <p>Opening OpsDeck…</p>
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
