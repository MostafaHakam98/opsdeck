import React, { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SignIn } from "./SignIn";
import { WorkspaceBoundary } from "./WorkspaceBoundary";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./styles.css";
import { applyTheme, storedTheme } from "../components/ThemeToggle";
import { BrandMark } from "../components/AppSidebar";
import { requestJson } from "../lib/request";
import { LoadingState } from "../components/LoadingState";
applyTheme(storedTheme());
const loadFleet = () => import("../features/fleet/FleetApp");
const loadWorkspace = () => import("./HostWorkspace");
const FleetApp = lazy(() =>
  loadFleet().then((module) => ({ default: module.FleetApp })),
);
const HostWorkspace = lazy(() =>
  loadWorkspace().then((module) => ({ default: module.HostWorkspace })),
);
const MODE_KEY = "opsdeck.mode";
// Start the mode check and the likely workspace chunks together instead of one after another.
let modeRequest: Promise<string> | null = requestMode();
// The effect below reports failures; this only keeps an early rejection from being logged as unhandled.
modeRequest.catch(() => undefined);
preload(rememberedMode());

function requestMode() {
  return requestJson<{ mode?: string }>("/healthz").then((data) =>
    String(data.mode || "standalone"),
  );
}
function rememberedMode() {
  try {
    return localStorage.getItem(MODE_KEY);
  } catch {
    return null;
  }
}
function preload(mode: string | null) {
  if (mode === "central") {
    void loadFleet().catch(() => undefined);
    const params = new URLSearchParams(window.location.search);
    if (params.has("node")) void loadWorkspace().catch(() => undefined);
  } else if (mode === "standalone") void loadWorkspace().catch(() => undefined);
}

function Deployment() {
  const [mode, setMode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const request = modeRequest || requestMode();
    modeRequest = null;
    request
      .then((value) => {
        if (controller.signal.aborted) return;
        try {
          localStorage.setItem(MODE_KEY, value);
        } catch {
          // Private windows may refuse storage; the next visit simply preloads less.
        }
        preload(value);
        setMode(value);
      })
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
          {error && (
            <p role="alert">
              {error.replace(/\.$/, "")}. Check that the OpsDeck server is
              running, then retry.
            </p>
          )}
          {!error && (
            <LoadingState
              title="Connecting to OpsDeck…"
              detail="Checking the connection and preparing your workspace."
              skeleton={false}
            />
          )}
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
